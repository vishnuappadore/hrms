import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { Prisma } from "@prisma/client";
import * as argon2 from "argon2";
import {
  assertMinorUnits,
  ERROR_CODES,
  type AuthUser,
  type CreateEmployeeInput,
  type Employee as EmployeeResponse,
  type EmployeePayrollComponentInput,
  type ListUsersQuery,
  type Paginated,
  type PayrollComponentCategory,
  type UpdateEmployeeInput,
  type User as UserResponse,
  resolveComponentAmountMinor,
} from "@keystonehr/shared";
import { CLS_KEYS, getEffectiveBranchIds } from "../../common/request-context";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../audit/audit.service";

/** Selection shared by every read — passwordHash must never leave this service. */
const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  username: true,
  status: true,
  locale: true,
  allBranches: true,
  role: { select: { id: true, nameEn: true, nameAr: true } },
  branchAssignments: { select: { branchId: true } },
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
  employeeProfile: { select: { mobile: true } },
} satisfies Prisma.UserSelect;

type UserRow = Prisma.UserGetPayload<{ select: typeof USER_SELECT }>;

/** getById/create/update also need the employment + salary/commission profile. */
const EMPLOYEE_SELECT = {
  ...USER_SELECT,
  employeeProfile: {
    select: {
      mobile: true,
      gender: true,
      employeeStatus: true,
      primaryBranchId: true,
      employmentType: true,
      joiningDate: true,
      baseSalaryMinor: true,
      commissionEnabled: true,
      commissionRatePct: true,
      reportingManager: { select: { id: true, name: true } },
      payrollComponents: {
        select: {
          amountMinor: true,
          payrollComponent: {
            select: { id: true, category: true, nameEn: true, nameAr: true, basis: true, defaultRatePct: true },
          },
        },
      },
    },
  },
} satisfies Prisma.UserSelect;

type EmployeeRow = Prisma.UserGetPayload<{ select: typeof EMPLOYEE_SELECT }>;

/** Partial-update payloads only touch the employee profile when one of these keys is present. */
const EMPLOYEE_PROFILE_KEYS = [
  "mobile",
  "gender",
  "employeeStatus",
  "primaryBranchId",
  "employmentType",
  "joiningDate",
  "reportingManagerId",
  "baseSalaryMinor",
  "commissionEnabled",
  "commissionRatePct",
  "allowances",
  "deductions",
] as const satisfies readonly (keyof UpdateEmployeeInput)[];

@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly cls: ClsService,
  ) {}

  async getMe(userId: string): Promise<AuthUser> {
    const user = await this.prisma.client.user.findFirst({
      where: { id: userId, deletedAt: null },
      include: {
        role: {
          select: {
            nameEn: true,
            nameAr: true,
            permissions: { select: { permissionKey: true } },
          },
        },
        branchAssignments: { select: { branchId: true } },
      },
    });
    if (!user) {
      throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: "User not found" });
    }
    const company = await this.prisma.client.companySettings.findUnique({ where: { id: "default" } });
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      username: user.username,
      roleId: user.roleId,
      roleNameEn: user.role.nameEn,
      roleNameAr: user.role.nameAr,
      permissions: user.role.permissions.map((p) => p.permissionKey),
      allBranches: user.allBranches,
      branchIds: user.branchAssignments.map((a) => a.branchId),
      locale: user.locale === "ar" ? "ar" : "en",
      currency: company?.defaultCurrency ?? "AED",
    };
  }

  async list(query: ListUsersQuery): Promise<Paginated<UserResponse>> {
    const effective = getEffectiveBranchIds(this.cls);
    if (query.branchId && effective && !effective.includes(query.branchId)) {
      throw new ForbiddenException({
        code: ERROR_CODES.BRANCH_ACCESS_DENIED,
        message: "You do not have access to this branch",
      });
    }

    // Every OR-shaped condition goes into its own AND entry: spreading several `{ OR }` objects
    // into one where-clause makes the later key silently overwrite the earlier one (a search used
    // to replace the branch-scope OR, leaking employees from other branches).
    const and: Prisma.UserWhereInput[] = [];
    if (effective) {
      and.push({ OR: [{ allBranches: true }, { branchAssignments: { some: { branchId: { in: effective } } } }] });
    }
    if (query.branchId) {
      // All-branch employees (admins, HR managers) work at every branch, so a branch filter includes them.
      and.push({ OR: [{ allBranches: true }, { branchAssignments: { some: { branchId: query.branchId } } }] });
    }
    if (query.search) {
      and.push({
        OR: [
          { name: { contains: query.search, mode: "insensitive" } },
          { username: { contains: query.search, mode: "insensitive" } },
          { email: { contains: query.search, mode: "insensitive" } },
        ],
      });
    }

    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      ...(query.roleId ? { roleId: query.roleId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(and.length ? { AND: and } : {}),
    };

    const orderBy = parseSort(query.sort) ?? { createdAt: "asc" as const };
    const [total, data] = await Promise.all([
      this.prisma.client.user.count({ where }),
      this.prisma.client.user.findMany({
        where,
        select: USER_SELECT,
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    return {
      data: data.map(toUserResponse),
      meta: { page: query.page, pageSize: query.pageSize, total },
    };
  }

  async getById(id: string): Promise<EmployeeResponse> {
    const user = await this.prisma.client.user.findFirst({
      where: { id, deletedAt: null },
      select: EMPLOYEE_SELECT,
    });
    if (!user) {
      throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: "User not found" });
    }
    this.assertEmployeeBranchAccess(user);
    return toEmployeeResponse(user);
  }

  async create(input: CreateEmployeeInput): Promise<EmployeeResponse> {
    const branchIds = input.allBranches ? [] : input.branchIds;
    await this.assertRoleExists(input.roleId);
    await this.assertBranchesExist(branchIds);
    await this.assertNoConflict(input.username, input.email?.toLowerCase() ?? null);
    if (input.primaryBranchId) await this.assertBranchesExist([input.primaryBranchId]);
    if (input.reportingManagerId) {
      await this.assertReportingManagerValid(input.reportingManagerId);
    }
    await this.assertPayrollComponentsValid(input.allowances, "allowance");
    await this.assertPayrollComponentsValid(input.deductions, "deduction");

    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });

    try {
      return await this.prisma.client.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            name: input.name,
            username: input.username,
            email: input.email ? input.email.toLowerCase() : null,
            passwordHash,
            status: input.status,
            locale: input.locale,
            roleId: input.roleId,
            allBranches: input.allBranches,
            branchAssignments: {
              create: branchIds.map((branchId) => ({ branchId })),
            },
          },
        });

        const profile = await tx.employeeProfile.create({
          data: {
            userId: user.id,
            mobile: input.mobile ?? null,
            gender: input.gender ?? null,
            employeeStatus: input.employeeStatus,
            primaryBranchId: input.primaryBranchId ?? null,
            employmentType: input.employmentType ?? null,
            joiningDate: input.joiningDate ?? null,
            reportingManagerId: input.reportingManagerId ?? null,
            baseSalaryMinor: BigInt(input.baseSalaryMinor),
            commissionEnabled: input.commissionEnabled,
            commissionRatePct: input.commissionRatePct ?? null,
          },
        });
        await this.createPayrollComponentRows(tx, profile.id, [...input.allowances, ...input.deductions]);

        const full = await tx.user.findUniqueOrThrow({
          where: { id: user.id },
          select: EMPLOYEE_SELECT,
        });
        const response = toEmployeeResponse(full);
        await this.audit.log(
          { action: "user.created", entityType: "user", entityId: user.id, after: response },
          tx,
        );
        return response;
      });
    } catch (err) {
      throw mapUniqueViolation(err);
    }
  }

  async update(id: string, input: UpdateEmployeeInput): Promise<EmployeeResponse> {
    const before = await this.getById(id);
    const currentUserId = this.cls.get(CLS_KEYS.userId) as string;

    // Lockout prevention: nobody deactivates or re-roles their own account.
    if (
      id === currentUserId &&
      ((input.status !== undefined && input.status !== before.status) ||
        (input.roleId !== undefined && input.roleId !== before.role.id))
    ) {
      throw new ForbiddenException({
        code: ERROR_CODES.CANNOT_MODIFY_SELF,
        message: "You cannot change your own status or role",
      });
    }

    if (input.roleId !== undefined) await this.assertRoleExists(input.roleId);
    if (input.username !== undefined || input.email !== undefined) {
      await this.assertNoConflict(
        input.username !== undefined && input.username !== before.username
          ? input.username
          : undefined,
        input.email !== undefined ? (input.email?.toLowerCase() ?? null) : undefined,
        id,
      );
    }

    // Branch access invariant is on the FINAL state (payload may be partial).
    const finalAllBranches = input.allBranches ?? before.allBranches;
    const finalBranchIds = input.branchIds ?? before.branchIds;
    if (!finalAllBranches && finalBranchIds.length === 0) {
      throw new BadRequestException({
        code: ERROR_CODES.VALIDATION_FAILED,
        message: "Assign at least one branch, or grant all-branches access",
      });
    }
    const replaceAssignments = input.allBranches !== undefined || input.branchIds !== undefined;
    const nextBranchIds = finalAllBranches ? [] : finalBranchIds;
    if (replaceAssignments) await this.assertBranchesExist(nextBranchIds);

    // Primary branch is distinct from Assigned Branches but must always be one of them.
    const finalPrimaryBranchId = input.primaryBranchId ?? before.primaryBranchId;
    if (!finalAllBranches && finalPrimaryBranchId && !nextBranchIds.includes(finalPrimaryBranchId)) {
      throw new BadRequestException({
        code: ERROR_CODES.VALIDATION_FAILED,
        message: "Primary branch must be included in assigned branches",
      });
    }

    if (input.primaryBranchId) await this.assertBranchesExist([input.primaryBranchId]);
    if (input.reportingManagerId !== undefined && input.reportingManagerId !== null) {
      if (input.reportingManagerId === id) {
        throw new BadRequestException({
          code: ERROR_CODES.VALIDATION_FAILED,
          message: "An employee cannot report to themselves",
        });
      }
      await this.assertReportingManagerValid(input.reportingManagerId);
    }
    if (input.allowances !== undefined) {
      await this.assertPayrollComponentsValid(input.allowances, "allowance");
    }
    if (input.deductions !== undefined) {
      await this.assertPayrollComponentsValid(input.deductions, "deduction");
    }

    const deactivating = input.status === "inactive" && before.status !== "inactive";
    const touchesProfile = EMPLOYEE_PROFILE_KEYS.some((key) => input[key] !== undefined);

    try {
      return await this.prisma.client.$transaction(async (tx) => {
        await tx.user.update({
          where: { id },
          data: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.username !== undefined ? { username: input.username } : {}),
            ...(input.email !== undefined
              ? { email: input.email ? input.email.toLowerCase() : null }
              : {}),
            ...(input.status !== undefined ? { status: input.status } : {}),
            ...(input.locale !== undefined ? { locale: input.locale } : {}),
            ...(input.roleId !== undefined ? { roleId: input.roleId } : {}),
            ...(input.allBranches !== undefined ? { allBranches: input.allBranches } : {}),
            ...(replaceAssignments
              ? {
                  branchAssignments: {
                    deleteMany: {},
                    create: nextBranchIds.map((branchId) => ({ branchId })),
                  },
                }
              : {}),
          },
        });

        if (touchesProfile) {
          const profile = await tx.employeeProfile.upsert({
            where: { userId: id },
            create: {
              userId: id,
              mobile: input.mobile ?? null,
              gender: input.gender ?? null,
              employeeStatus: input.employeeStatus ?? "active",
              primaryBranchId: input.primaryBranchId ?? null,
              employmentType: input.employmentType ?? null,
              joiningDate: input.joiningDate ?? null,
              reportingManagerId: input.reportingManagerId ?? null,
              baseSalaryMinor: BigInt(input.baseSalaryMinor ?? 0),
              commissionEnabled: input.commissionEnabled ?? false,
              commissionRatePct: input.commissionRatePct ?? null,
            },
            update: {
              ...(input.mobile !== undefined ? { mobile: input.mobile } : {}),
              ...(input.gender !== undefined ? { gender: input.gender } : {}),
              ...(input.employeeStatus !== undefined ? { employeeStatus: input.employeeStatus } : {}),
              ...(input.primaryBranchId !== undefined
                ? { primaryBranchId: input.primaryBranchId }
                : {}),
              ...(input.employmentType !== undefined
                ? { employmentType: input.employmentType }
                : {}),
              ...(input.joiningDate !== undefined ? { joiningDate: input.joiningDate } : {}),
              ...(input.reportingManagerId !== undefined
                ? { reportingManagerId: input.reportingManagerId }
                : {}),
              ...(input.baseSalaryMinor !== undefined
                ? { baseSalaryMinor: BigInt(input.baseSalaryMinor) }
                : {}),
              ...(input.commissionEnabled !== undefined
                ? { commissionEnabled: input.commissionEnabled }
                : {}),
              ...(input.commissionRatePct !== undefined
                ? { commissionRatePct: input.commissionRatePct }
                : {}),
            },
          });

          if (input.allowances !== undefined) {
            await this.replacePayrollComponentRows(tx, profile.id, "allowance", input.allowances);
          }
          if (input.deductions !== undefined) {
            await this.replacePayrollComponentRows(tx, profile.id, "deduction", input.deductions);
          }
        }

        // A deactivated user must not outlive their access token: kill refresh.
        if (deactivating) {
          await tx.refreshToken.updateMany({
            where: { userId: id, revokedAt: null },
            data: { revokedAt: new Date() },
          });
        }

        const full = await tx.user.findUniqueOrThrow({ where: { id }, select: EMPLOYEE_SELECT });
        const response = toEmployeeResponse(full);
        await this.audit.log(
          { action: "user.updated", entityType: "user", entityId: id, before, after: response },
          tx,
        );
        return response;
      });
    } catch (err) {
      throw mapUniqueViolation(err);
    }
  }

  async resetPassword(id: string, password: string): Promise<{ success: true }> {
    await this.getById(id); // 404 on unknown/deleted, branch access check
    await this.assertCanResetPassword(id);
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

    await this.prisma.client.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { passwordHash } });
      await tx.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.log({ action: "user.password_reset", entityType: "user", entityId: id }, tx);
    });
    return { success: true };
  }

  /**
   * Resetting a password is an account takeover, so `employee.update` alone is not enough when
   * the target outranks the actor: only a Super Admin may reset a Super Admin's password, and a
   * branch-scoped actor may not reset an all-branches account (assertEmployeeBranchAccess lets
   * those through for reads). Resetting your own password is always allowed.
   */
  private async assertCanResetPassword(targetId: string): Promise<void> {
    const actorId = this.cls.get(CLS_KEYS.userId) as string;
    if (targetId === actorId) return;
    const [actor, target] = await Promise.all([
      this.prisma.client.user.findFirst({
        where: { id: actorId },
        select: { allBranches: true, role: { select: { isSuperAdmin: true } } },
      }),
      this.prisma.client.user.findFirst({
        where: { id: targetId },
        select: { allBranches: true, role: { select: { isSuperAdmin: true } } },
      }),
    ]);
    if (actor?.role.isSuperAdmin) return;
    if (!actor || !target || target.role.isSuperAdmin || (target.allBranches && !actor.allBranches)) {
      throw new ForbiddenException({
        code: ERROR_CODES.PERMISSION_DENIED,
        message: "You cannot reset this user's password",
      });
    }
  }

  private async assertRoleExists(roleId: string): Promise<void> {
    const role = await this.prisma.client.role.findFirst({ where: { id: roleId } });
    if (!role) {
      throw new BadRequestException({
        code: ERROR_CODES.VALIDATION_FAILED,
        message: "Unknown role",
      });
    }
  }

  /**
   * Deterministic conflict codes; the P2002 mapping stays as a race backstop.
   * Soft-deleted users still hold the unique constraints, so no deletedAt filter.
   */
  private async assertNoConflict(
    username: string | undefined,
    email: string | null | undefined,
    excludeUserId?: string,
  ): Promise<void> {
    if (username !== undefined) {
      const clash = await this.prisma.client.user.findFirst({
        where: { username, ...(excludeUserId ? { id: { not: excludeUserId } } : {}) },
        select: { id: true },
      });
      if (clash) {
        throw new ConflictException({
          code: ERROR_CODES.USERNAME_EXISTS,
          message: "A user with this username already exists",
        });
      }
    }
    if (email) {
      const clash = await this.prisma.client.user.findFirst({
        where: { email, ...(excludeUserId ? { id: { not: excludeUserId } } : {}) },
        select: { id: true },
      });
      if (clash) {
        throw new ConflictException({
          code: ERROR_CODES.EMAIL_EXISTS,
          message: "A user with this email already exists",
        });
      }
    }
  }

  private assertEmployeeBranchAccess(user: { allBranches: boolean; branchAssignments: { branchId: string }[] }): void {
    const effective = getEffectiveBranchIds(this.cls);
    if (!effective || user.allBranches) return;
    const allowed = user.branchAssignments.some((a) => effective.includes(a.branchId));
    if (!allowed) {
      throw new ForbiddenException({
        code: ERROR_CODES.BRANCH_ACCESS_DENIED,
        message: "You do not have access to this employee",
      });
    }
  }

  private async assertBranchesExist(branchIds: string[]): Promise<void> {
    if (branchIds.length === 0) return;
    const count = await this.prisma.client.branch.count({ where: { id: { in: branchIds } } });
    if (count !== branchIds.length) {
      throw new BadRequestException({
        code: ERROR_CODES.VALIDATION_FAILED,
        message: "One or more branches do not exist",
      });
    }
  }

  private async assertReportingManagerValid(userId: string): Promise<void> {
    const manager = await this.prisma.client.user.findFirst({
      where: { id: userId, deletedAt: null },
    });
    if (!manager) {
      throw new BadRequestException({
        code: ERROR_CODES.VALIDATION_FAILED,
        message: "Unknown reporting manager",
      });
    }
  }

  private async assertPayrollComponentsValid(
    items: EmployeePayrollComponentInput[],
    expectedCategory: PayrollComponentCategory,
  ): Promise<void> {
    if (items.length === 0) return;
    const ids = items.map((i) => i.payrollComponentId);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException({
        code: ERROR_CODES.VALIDATION_FAILED,
        message: "Duplicate payroll component selected",
      });
    }
    const components = await this.prisma.client.payrollComponent.findMany({
      where: { id: { in: ids } },
    });
    if (components.length !== ids.length) {
      throw new BadRequestException({
        code: ERROR_CODES.VALIDATION_FAILED,
        message: "One or more payroll components do not exist",
      });
    }
    if (components.some((c) => c.category !== expectedCategory)) {
      throw new BadRequestException({
        code: ERROR_CODES.VALIDATION_FAILED,
        message: `All items must be ${expectedCategory} components`,
      });
    }
  }

  private async createPayrollComponentRows(
    tx: Prisma.TransactionClient,
    employeeProfileId: string,
    items: EmployeePayrollComponentInput[],
  ): Promise<void> {
    if (items.length === 0) return;
    await tx.employeePayrollComponent.createMany({
      data: items.map((item) => ({
        employeeProfileId,
        payrollComponentId: item.payrollComponentId,
        amountMinor: BigInt(item.amountMinor),
      })),
    });
  }

  /** Replaces only the rows for one category, leaving the other list untouched. */
  private async replacePayrollComponentRows(
    tx: Prisma.TransactionClient,
    employeeProfileId: string,
    category: PayrollComponentCategory,
    items: EmployeePayrollComponentInput[],
  ): Promise<void> {
    await tx.employeePayrollComponent.deleteMany({
      where: { employeeProfileId, payrollComponent: { category } },
    });
    await this.createPayrollComponentRows(tx, employeeProfileId, items);
  }
}

function toUserResponse(user: UserRow): UserResponse {
  const { branchAssignments, employeeProfile, ...rest } = user;
  return {
    ...rest,
    locale: rest.locale === "ar" ? "ar" : "en",
    branchIds: branchAssignments.map((a) => a.branchId),
    mobile: employeeProfile?.mobile ?? null,
  };
}

function toEmployeeResponse(user: EmployeeRow): EmployeeResponse {
  const { branchAssignments, employeeProfile, ...rest } = user;
  const baseSalaryMinor = employeeProfile ? Number(employeeProfile.baseSalaryMinor) : 0;
  const line = (pc: EmployeeComponentRow) => toComponentLine(pc, baseSalaryMinor);
  const allowances = (employeeProfile?.payrollComponents ?? [])
    .filter((pc) => pc.payrollComponent.category === "allowance")
    .map(line);
  const deductions = (employeeProfile?.payrollComponents ?? [])
    .filter((pc) => pc.payrollComponent.category === "deduction")
    .map(line);

  const allowancesTotal = allowances.reduce((sum, a) => sum + a.amountMinor, 0);
  const deductionsTotal = deductions.reduce((sum, d) => sum + d.amountMinor, 0);
  const grossSalaryMinor = baseSalaryMinor + allowancesTotal;
  assertMinorUnits(grossSalaryMinor);
  const netSalaryMinor = grossSalaryMinor - deductionsTotal;

  return {
    ...rest,
    locale: rest.locale === "ar" ? "ar" : "en",
    branchIds: branchAssignments.map((a) => a.branchId),
    mobile: employeeProfile?.mobile ?? null,
    gender: employeeProfile?.gender ?? null,
    employeeStatus: employeeProfile?.employeeStatus ?? "active",
    primaryBranchId: employeeProfile?.primaryBranchId ?? null,
    employmentType: employeeProfile?.employmentType ?? null,
    joiningDate: employeeProfile?.joiningDate ?? null,
    reportingManager: employeeProfile?.reportingManager ?? null,
    baseSalaryMinor,
    commissionEnabled: employeeProfile?.commissionEnabled ?? false,
    commissionRatePct:
      employeeProfile?.commissionRatePct != null ? Number(employeeProfile.commissionRatePct) : null,
    allowances,
    deductions,
    grossSalaryMinor,
    netSalaryMinor,
  };
}

interface EmployeeComponentRow {
  amountMinor: bigint;
  payrollComponent: {
    id: string;
    nameEn: string;
    nameAr: string;
    basis: string;
    defaultRatePct: Prisma.Decimal | null;
  };
}

function toComponentLine(pc: EmployeeComponentRow, baseSalaryMinor: number) {
  return {
    payrollComponentId: pc.payrollComponent.id,
    nameEn: pc.payrollComponent.nameEn,
    nameAr: pc.payrollComponent.nameAr,
    // Same resolver as payroll generation, so the Employees screen and the payslip always agree.
    amountMinor: resolveComponentAmountMinor(
      {
        basis: pc.payrollComponent.basis,
        defaultRatePct: pc.payrollComponent.defaultRatePct != null ? Number(pc.payrollComponent.defaultRatePct) : null,
      },
      baseSalaryMinor,
      Number(pc.amountMinor),
    ),
  };
}

function mapUniqueViolation(err: unknown): unknown {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    const target = String(err.meta?.target ?? "");
    if (target.includes("email")) {
      return new ConflictException({
        code: ERROR_CODES.EMAIL_EXISTS,
        message: "A user with this email already exists",
      });
    }
    return new ConflictException({
      code: ERROR_CODES.USERNAME_EXISTS,
      message: "A user with this username already exists",
    });
  }
  return err;
}

function parseSort(sort?: string): Record<string, "asc" | "desc"> | undefined {
  if (!sort) return undefined;
  const desc = sort.startsWith("-");
  const field = desc ? sort.slice(1) : sort;
  const allowed = new Set(["name", "username", "createdAt", "lastLoginAt", "status"]);
  if (!allowed.has(field)) return undefined;
  return { [field]: desc ? "desc" : "asc" };
}

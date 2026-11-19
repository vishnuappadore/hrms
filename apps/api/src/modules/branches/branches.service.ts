import { Injectable, NotFoundException } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { Prisma } from "@prisma/client";
import {
  ERROR_CODES,
  type BranchStats,
  type CreateBranchInput,
  type ListBranchesQuery,
  type Paginated,
  type UpdateBranchInput,
} from "@keystonehr/shared";
import { CLS_KEYS, getEffectiveBranchIds } from "../../common/request-context";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../audit/audit.service";

@Injectable()
export class BranchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly cls: ClsService,
  ) {}

  async list(query: ListBranchesQuery): Promise<Paginated<unknown>> {
    const effectiveBranchIds = getEffectiveBranchIds(this.cls);
    const where: Prisma.BranchWhereInput = {
      ...(effectiveBranchIds ? { id: { in: effectiveBranchIds } } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.city ? { city: { equals: query.city, mode: "insensitive" } } : {}),
      ...(query.search
        ? {
            OR: [
              { nameEn: { contains: query.search, mode: "insensitive" } },
              { nameAr: { contains: query.search, mode: "insensitive" } },
              { code: { contains: query.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const orderBy = parseSort(query.sort) ?? { createdAt: "desc" as const };
    const [total, data] = await Promise.all([
      this.prisma.client.branch.count({ where }),
      this.prisma.client.branch.findMany({
        where,
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          manager: { select: { id: true, name: true } },
          _count: { select: { userAssignments: true } },
        },
      }),
    ]);

    return {
      data: data.map(({ _count, ...branch }) => ({
        ...branch,
        employeeCount: _count.userAssignments,
      })),
      meta: { page: query.page, pageSize: query.pageSize, total },
    };
  }

  /** KPI cards for the branch list — scoped like list() so managers see their slice. */
  async stats(): Promise<BranchStats> {
    const effectiveBranchIds = getEffectiveBranchIds(this.cls);
    const branchWhere: Prisma.BranchWhereInput = effectiveBranchIds
      ? { id: { in: effectiveBranchIds } }
      : {};

    const [total, active, employees] = await Promise.all([
      this.prisma.client.branch.count({ where: branchWhere }),
      this.prisma.client.branch.count({ where: { ...branchWhere, status: "active" } }),
      this.prisma.client.user.count({
        where: {
          deletedAt: null,
          status: "active",
          branchAssignments: {
            some: effectiveBranchIds ? { branchId: { in: effectiveBranchIds } } : {},
          },
        },
      }),
    ]);

    return { total, active, inactive: total - active, employees };
  }

  async getById(id: string) {
    const branch = await this.prisma.client.branch.findUnique({
      where: { id },
      include: {
        manager: { select: { id: true, name: true } },
      },
    });
    if (!branch) {
      throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: "Branch not found" });
    }
    return branch;
  }

  async create(input: CreateBranchInput) {
    const userId = this.cls.get(CLS_KEYS.userId) as string;

    return this.prisma.client.$transaction(async (tx) => {
      const code = await this.nextBranchCode(tx);
      const { workingHours, currency, ...rest } = input;

      // currency inherits the company default unless explicitly set
      const resolvedCurrency =
        currency ?? (await tx.companySettings.findUniqueOrThrow({ where: { id: "default" } })).defaultCurrency;

      const branch = await tx.branch.create({
        data: {
          ...rest,
          code,
          currency: resolvedCurrency,
          workingHours: workingHours as object,
          createdBy: userId,
        },
      });
      await this.audit.log(
        { action: "branch.created", entityType: "branch", entityId: branch.id, after: branch },
        tx,
      );
      return branch;
    });
  }

  async update(id: string, input: UpdateBranchInput) {
    const before = await this.getById(id);
    const userId = this.cls.get(CLS_KEYS.userId) as string;

    return this.prisma.client.$transaction(async (tx) => {
      const { workingHours, ...rest } = input;

      const branch = await tx.branch.update({
        where: { id },
        data: {
          ...rest,
          ...(workingHours ? { workingHours: workingHours as object } : {}),
          updatedBy: userId,
        },
      });
      await this.audit.log(
        { action: "branch.updated", entityType: "branch", entityId: id, before, after: branch },
        tx,
      );
      return branch;
    });
  }

  /** Store IDs are immutable, human-readable, sequential: BR-0001 */
  private async nextBranchCode(tx: { branch: { count: () => Promise<number> } }): Promise<string> {
    const count = await tx.branch.count();
    return `BR-${String(count + 1).padStart(4, "0")}`;
  }
}

function parseSort(sort?: string): Record<string, "asc" | "desc"> | undefined {
  if (!sort) return undefined;
  const desc = sort.startsWith("-");
  const field = desc ? sort.slice(1) : sort;
  const allowed = new Set(["createdAt", "nameEn", "city", "code", "status"]);
  if (!allowed.has(field)) return undefined;
  return { [field]: desc ? "desc" : "asc" };
}

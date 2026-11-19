import { Injectable, NotFoundException } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { Prisma } from "@prisma/client";
import {
  ERROR_CODES,
  type BranchStats,
  type CreateBranchInput,
  type ListBranchesQuery,
  type ListFranchiseOwnersQuery,
  type Paginated,
  type UpdateBranchInput,
} from "@keystonehr/shared";
import { CLS_KEYS, getEffectiveBranchIds } from "../../common/request-context";
import { PrismaService, type TxClient } from "../../database/prisma.service";
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
      ...(query.type ? { type: query.type } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.franchiseOwnerId
        ? { franchiseDetails: { franchiseOwnerId: query.franchiseOwnerId } }
        : {}),
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
        staffCount: _count.userAssignments,
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

    const [total, active, staff] = await Promise.all([
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

    // Revenue joins when the POS/finance module lands; until then the KPI is an
    // explicit empty state rather than a fabricated figure (docs/MODULES/branches.md).
    return { total, active, inactive: total - active, staff, revenue: null, revenueCurrency: null };
  }

  async listFranchiseOwners(query: ListFranchiseOwnersQuery): Promise<Paginated<unknown>> {
    const where: Prisma.FranchiseOwnerWhereInput = query.search
      ? {
          OR: [
            { ownerName: { contains: query.search, mode: "insensitive" } },
            { companyName: { contains: query.search, mode: "insensitive" } },
          ],
        }
      : {};

    const [total, data] = await Promise.all([
      this.prisma.client.franchiseOwner.count({ where }),
      this.prisma.client.franchiseOwner.findMany({
        where,
        select: { id: true, ownerName: true, companyName: true, commercialRegistrationNo: true },
        orderBy: { ownerName: "asc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    return { data, meta: { page: query.page, pageSize: query.pageSize, total } };
  }

  async getById(id: string) {
    const branch = await this.prisma.client.branch.findUnique({
      where: { id },
      include: {
        manager: { select: { id: true, name: true } },
        franchiseDetails: { include: { owner: true } },
        taxProfile: { include: { components: { orderBy: { sortOrder: "asc" } } } },
        branchServices: { select: { serviceId: true, isAvailable: true } },
      },
    });
    if (!branch) {
      throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: "Branch not found" });
    }
    return branch;
  }

  async create(input: CreateBranchInput) {
    const tenantId = this.cls.get(CLS_KEYS.tenantId) as string;
    const userId = this.cls.get(CLS_KEYS.userId) as string;

    return this.prisma.withTenantTx(async (tx) => {
      const code = await this.nextBranchCode(tx, tenantId);
      const { franchiseDetails, workingHours, currency, taxProfileId, serviceIds, ...rest } =
        input;

      // currency inherits the tenant default unless explicitly set
      const resolvedCurrency =
        currency ??
        (await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } })).defaultCurrency;

      // tax profile: omitted → tenant default; explicit null → tax-free branch
      const resolvedTaxProfileId =
        taxProfileId !== undefined
          ? taxProfileId
          : ((await tx.taxProfile.findFirst({ where: { isDefault: true } }))?.id ?? null);

      // one franchise partner can hold many branches: reuse or create inline
      let franchiseOwnerId: string | undefined;
      if (input.type === "franchise" && franchiseDetails) {
        franchiseOwnerId =
          franchiseDetails.franchiseOwnerId ??
          (
            await tx.franchiseOwner.create({
              data: { ...franchiseDetails.newOwner!, tenantId },
            })
          ).id;
      }

      const branch = await tx.branch.create({
        data: {
          ...rest,
          tenantId,
          code,
          currency: resolvedCurrency,
          taxProfileId: resolvedTaxProfileId,
          workingHours: workingHours as object,
          createdBy: userId,
          ...(franchiseOwnerId
            ? {
                franchiseDetails: {
                  create: {
                    tenantId,
                    franchiseOwnerId,
                    agreementStartDate: franchiseDetails!.agreementStartDate,
                    agreementExpiryDate: franchiseDetails!.agreementExpiryDate,
                  },
                },
              }
            : {}),
        },
        include: { franchiseDetails: { include: { owner: true } } },
      });
      if (serviceIds !== undefined) {
        await this.syncBranchServices(tx, tenantId, branch.id, serviceIds);
      }
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
    const tenantId = this.cls.get(CLS_KEYS.tenantId) as string;

    return this.prisma.withTenantTx(async (tx) => {
      const { franchiseDetails, workingHours, serviceIds, ...rest } = input;

      let franchiseLink;
      if (franchiseDetails) {
        const franchiseOwnerId =
          franchiseDetails.franchiseOwnerId ??
          (
            await tx.franchiseOwner.create({
              data: { ...franchiseDetails.newOwner!, tenantId },
            })
          ).id;
        const link = {
          franchiseOwnerId,
          agreementStartDate: franchiseDetails.agreementStartDate,
          agreementExpiryDate: franchiseDetails.agreementExpiryDate,
        };
        franchiseLink = {
          franchiseDetails: {
            upsert: { create: { ...link, tenantId }, update: link },
          },
        };
      }

      const branch = await tx.branch.update({
        where: { id },
        data: {
          ...rest,
          ...(workingHours ? { workingHours: workingHours as object } : {}),
          updatedBy: userId,
          ...(franchiseLink ?? {}),
        },
        include: { franchiseDetails: { include: { owner: true } } },
      });
      if (serviceIds !== undefined) {
        await this.syncBranchServices(tx, tenantId, id, serviceIds);
      }
      await this.audit.log(
        { action: "branch.updated", entityType: "branch", entityId: id, before, after: branch },
        tx,
      );
      return branch;
    });
  }

  /**
   * Branch-side service toggle: flips `isAvailable` only. Never delete-then-
   * recreate by branchId — that would also destroy `priceOverrideMinor` set
   * on this branch's OTHER services via the Services module (branchOverrides
   * there deletes are scoped per-service, not per-branch).
   */
  private async syncBranchServices(
    tx: TxClient,
    tenantId: string,
    branchId: string,
    selectedIds: string[],
  ): Promise<void> {
    const active = await tx.service.findMany({
      where: { tenantId, status: "active", deletedAt: null },
      select: { id: true },
    });
    const selected = new Set(selectedIds);

    await Promise.all(
      active.map(({ id: serviceId }) =>
        selected.has(serviceId)
          ? tx.branchService.updateMany({
              where: { serviceId, branchId, isAvailable: false },
              data: { isAvailable: true },
            })
          : tx.branchService.upsert({
              where: { serviceId_branchId: { serviceId, branchId } },
              create: { tenantId, serviceId, branchId, isAvailable: false },
              update: { isAvailable: false },
            }),
      ),
    );
  }

  /** Store IDs are immutable, human-readable, sequential per tenant: BR-0001 */
  private async nextBranchCode(
    tx: { branch: { count: (args: { where: { tenantId: string } }) => Promise<number> } },
    tenantId: string,
  ): Promise<string> {
    const count = await tx.branch.count({ where: { tenantId } });
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

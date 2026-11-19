import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { Prisma } from "@prisma/client";
import {
  ERROR_CODES,
  type CreateServiceCategoryInput,
  type CreateServiceInput,
  type ListServicesQuery,
  type Paginated,
  type Service as ServiceResponse,
  type ServiceCategory as CategoryResponse,
  type UpdateServiceCategoryInput,
  type UpdateServiceInput,
} from "@keystonehr/shared";
import { CLS_KEYS } from "../../common/request-context";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../audit/audit.service";

const SERVICE_INCLUDE = {
  category: { select: { id: true, nameEn: true, nameAr: true } },
  branchOverrides: {
    select: { branchId: true, priceOverrideMinor: true, isAvailable: true },
  },
} satisfies Prisma.ServiceInclude;

type ServiceRow = Prisma.ServiceGetPayload<{ include: typeof SERVICE_INCLUDE }>;

@Injectable()
export class ServicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly cls: ClsService,
  ) {}

  /* ── Categories ─────────────────────────────────────────────────────── */

  async listCategories(): Promise<CategoryResponse[]> {
    const categories = await this.prisma.client.serviceCategory.findMany({
      include: { _count: { select: { services: { where: { deletedAt: null } } } } },
      orderBy: [{ sortOrder: "asc" }, { nameEn: "asc" }],
    });
    return categories.map(({ _count, ...c }) => ({ ...c, serviceCount: _count.services }));
  }

  async createCategory(input: CreateServiceCategoryInput): Promise<CategoryResponse> {
    const tenantId = this.cls.get(CLS_KEYS.tenantId) as string;
    await this.assertCategoryNameFree(input.nameEn);

    return this.prisma.withTenantTx(async (tx) => {
      const category = await tx.serviceCategory.create({ data: { ...input, tenantId } });
      await this.audit.log(
        {
          action: "service_category.created",
          entityType: "service_category",
          entityId: category.id,
          after: category,
        },
        tx,
      );
      return { ...category, serviceCount: 0 };
    });
  }

  async updateCategory(id: string, input: UpdateServiceCategoryInput): Promise<CategoryResponse> {
    const before = await this.prisma.client.serviceCategory.findFirst({ where: { id } });
    if (!before) {
      throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: "Category not found" });
    }
    if (input.nameEn !== undefined && input.nameEn !== before.nameEn) {
      await this.assertCategoryNameFree(input.nameEn, id);
    }

    return this.prisma.withTenantTx(async (tx) => {
      const category = await tx.serviceCategory.update({
        where: { id },
        data: input,
        include: { _count: { select: { services: { where: { deletedAt: null } } } } },
      });
      await this.audit.log(
        {
          action: "service_category.updated",
          entityType: "service_category",
          entityId: id,
          before,
          after: category,
        },
        tx,
      );
      const { _count, ...rest } = category;
      return { ...rest, serviceCount: _count.services };
    });
  }

  /* ── Services ───────────────────────────────────────────────────────── */

  async list(query: ListServicesQuery): Promise<Paginated<ServiceResponse>> {
    const where: Prisma.ServiceWhereInput = {
      deletedAt: null,
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.status ? { status: query.status } : {}),
      // offered at branch = no exception row switching it off there
      ...(query.branchId
        ? { NOT: { branchOverrides: { some: { branchId: query.branchId, isAvailable: false } } } }
        : {}),
      ...(query.search
        ? {
            OR: [
              { nameEn: { contains: query.search, mode: "insensitive" } },
              { nameAr: { contains: query.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const orderBy = parseSort(query.sort) ?? { createdAt: "desc" as const };
    const [total, data] = await Promise.all([
      this.prisma.client.service.count({ where }),
      this.prisma.client.service.findMany({
        where,
        include: SERVICE_INCLUDE,
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    return {
      data: data.map(toServiceResponse),
      meta: { page: query.page, pageSize: query.pageSize, total },
    };
  }

  async getById(id: string): Promise<ServiceResponse> {
    const service = await this.prisma.client.service.findFirst({
      where: { id, deletedAt: null },
      include: SERVICE_INCLUDE,
    });
    if (!service) {
      throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: "Service not found" });
    }
    return toServiceResponse(service);
  }

  async create(input: CreateServiceInput): Promise<ServiceResponse> {
    const tenantId = this.cls.get(CLS_KEYS.tenantId) as string;
    const userId = this.cls.get(CLS_KEYS.userId) as string;
    await this.assertCategoryExists(input.categoryId);
    await this.assertServiceNameFree(input.nameEn);
    await this.assertValidOverrides(input.branchOverrides);

    return this.prisma.withTenantTx(async (tx) => {
      const service = await tx.service.create({
        data: {
          tenantId,
          categoryId: input.categoryId,
          nameEn: input.nameEn,
          nameAr: input.nameAr,
          durationMinutes: input.durationMinutes,
          bufferMinutes: input.bufferMinutes,
          priceMinor: BigInt(input.priceMinor),
          status: input.status,
          createdBy: userId,
          branchOverrides: {
            create: input.branchOverrides.map((o) => ({
              tenantId,
              branchId: o.branchId,
              priceOverrideMinor: o.priceOverrideMinor != null ? BigInt(o.priceOverrideMinor) : null,
              isAvailable: o.isAvailable,
            })),
          },
        },
        include: SERVICE_INCLUDE,
      });
      const response = toServiceResponse(service);
      await this.audit.log(
        { action: "service.created", entityType: "service", entityId: service.id, after: response },
        tx,
      );
      return response;
    });
  }

  async update(id: string, input: UpdateServiceInput): Promise<ServiceResponse> {
    const before = await this.getById(id);
    const tenantId = this.cls.get(CLS_KEYS.tenantId) as string;
    const userId = this.cls.get(CLS_KEYS.userId) as string;
    if (input.categoryId !== undefined) await this.assertCategoryExists(input.categoryId);
    if (input.nameEn !== undefined && input.nameEn !== before.nameEn) {
      await this.assertServiceNameFree(input.nameEn, id);
    }
    if (input.branchOverrides !== undefined) await this.assertValidOverrides(input.branchOverrides);

    return this.prisma.withTenantTx(async (tx) => {
      const service = await tx.service.update({
        where: { id },
        data: {
          ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
          ...(input.nameEn !== undefined ? { nameEn: input.nameEn } : {}),
          ...(input.nameAr !== undefined ? { nameAr: input.nameAr } : {}),
          ...(input.durationMinutes !== undefined
            ? { durationMinutes: input.durationMinutes }
            : {}),
          ...(input.bufferMinutes !== undefined ? { bufferMinutes: input.bufferMinutes } : {}),
          ...(input.priceMinor !== undefined ? { priceMinor: BigInt(input.priceMinor) } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          updatedBy: userId,
          // overrides, when present, replace wholesale (taxes-module pattern)
          ...(input.branchOverrides !== undefined
            ? {
                branchOverrides: {
                  deleteMany: {},
                  create: input.branchOverrides.map((o) => ({
                    tenantId,
                    branchId: o.branchId,
                    priceOverrideMinor:
                      o.priceOverrideMinor != null ? BigInt(o.priceOverrideMinor) : null,
                    isAvailable: o.isAvailable,
                  })),
                },
              }
            : {}),
        },
        include: SERVICE_INCLUDE,
      });
      const response = toServiceResponse(service);
      await this.audit.log(
        { action: "service.updated", entityType: "service", entityId: id, before, after: response },
        tx,
      );
      return response;
    });
  }

  /* ── Guards ─────────────────────────────────────────────────────────── */

  private async assertCategoryExists(categoryId: string): Promise<void> {
    const category = await this.prisma.client.serviceCategory.findFirst({
      where: { id: categoryId },
    });
    if (!category) {
      throw new BadRequestException({
        code: ERROR_CODES.VALIDATION_FAILED,
        message: "Unknown service category",
      });
    }
  }

  private async assertCategoryNameFree(nameEn: string, excludeId?: string): Promise<void> {
    const clash = await this.prisma.client.serviceCategory.findFirst({
      where: { nameEn, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true },
    });
    if (clash) {
      throw new ConflictException({
        code: ERROR_CODES.NAME_EXISTS,
        message: "A category with this name already exists",
      });
    }
  }

  private async assertServiceNameFree(nameEn: string, excludeId?: string): Promise<void> {
    // Live services only — soft-deleted rows don't reserve the name. The DB carries a
    // full unique index today (no delete flow writes deleted_at); see schema.prisma.
    const clash = await this.prisma.client.service.findFirst({
      where: { nameEn, deletedAt: null, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true },
    });
    if (clash) {
      throw new ConflictException({
        code: ERROR_CODES.NAME_EXISTS,
        message: "A service with this name already exists",
      });
    }
  }

  private async assertValidOverrides(
    overrides: { branchId: string }[] | undefined,
  ): Promise<void> {
    if (!overrides || overrides.length === 0) return;
    const branchIds = overrides.map((o) => o.branchId);
    if (new Set(branchIds).size !== branchIds.length) {
      throw new BadRequestException({
        code: ERROR_CODES.VALIDATION_FAILED,
        message: "Duplicate branch in overrides",
      });
    }
    const count = await this.prisma.client.branch.count({ where: { id: { in: branchIds } } });
    if (count !== branchIds.length) {
      throw new BadRequestException({
        code: ERROR_CODES.VALIDATION_FAILED,
        message: "One or more branches do not exist",
      });
    }
  }
}

function toServiceResponse(service: ServiceRow): ServiceResponse {
  const { priceMinor, branchOverrides, deletedAt: _d, createdBy: _c, updatedBy: _u, ...rest } =
    service;
  return {
    ...rest,
    priceMinor: Number(priceMinor),
    branchOverrides: branchOverrides.map((o) => ({
      branchId: o.branchId,
      priceOverrideMinor: o.priceOverrideMinor != null ? Number(o.priceOverrideMinor) : null,
      isAvailable: o.isAvailable,
    })),
  };
}

function parseSort(sort?: string): Record<string, "asc" | "desc"> | undefined {
  if (!sort) return undefined;
  const desc = sort.startsWith("-");
  const field = desc ? sort.slice(1) : sort;
  const allowed = new Set(["nameEn", "createdAt", "priceMinor", "durationMinutes", "status"]);
  if (!allowed.has(field)) return undefined;
  return { [field]: desc ? "desc" : "asc" };
}

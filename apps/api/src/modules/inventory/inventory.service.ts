import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { Prisma } from "@prisma/client";
import {
  ERROR_CODES,
  type AdjustStockInput,
  type CreateProductInput,
  type ListProductsQuery,
  type Paginated,
  type Product as ProductResponse,
  type UpdateProductInput,
} from "@keystonehr/shared";
import { CLS_KEYS } from "../../common/request-context";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../audit/audit.service";

type ProductRow = Prisma.ProductGetPayload<{ include: { stockLevels: true } }>;

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly cls: ClsService,
  ) {}

  async list(query: ListProductsQuery): Promise<Paginated<ProductResponse>> {
    // Products are a tenant-wide master (not branch-scoped); stock is per branch.
    const where: Prisma.ProductWhereInput = {
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { nameEn: { contains: query.search, mode: "insensitive" } },
              { nameAr: { contains: query.search, mode: "insensitive" } },
              { sku: { contains: query.search, mode: "insensitive" } },
              { brand: { contains: query.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const orderBy = parseSort(query.sort) ?? { nameEn: "asc" as const };
    const [total, data] = await Promise.all([
      this.prisma.client.product.count({ where }),
      this.prisma.client.product.findMany({
        where,
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: query.branchId
          ? { stockLevels: { where: { branchId: query.branchId } } }
          : { stockLevels: false },
      }),
    ]);

    return {
      data: data.map((p) => toProductResponse(p, query.branchId)),
      meta: { page: query.page, pageSize: query.pageSize, total },
    };
  }

  async getById(id: string, branchId?: string): Promise<ProductResponse> {
    const product = await this.prisma.client.product.findFirst({
      where: { id, deletedAt: null },
      include: branchId ? { stockLevels: { where: { branchId } } } : { stockLevels: false },
    });
    if (!product) {
      throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: "Product not found" });
    }
    return toProductResponse(product, branchId);
  }

  async create(input: CreateProductInput): Promise<ProductResponse> {
    const tenantId = this.cls.get(CLS_KEYS.tenantId) as string;
    const userId = this.cls.get(CLS_KEYS.userId) as string;
    await this.assertSkuFree(input.sku);

    return this.prisma.withTenantTx(async (tx) => {
      const product = await tx.product.create({
        data: {
          tenantId,
          nameEn: input.nameEn,
          nameAr: input.nameAr ?? null,
          sku: input.sku,
          brand: input.brand ?? null,
          salePriceMinor: BigInt(input.salePriceMinor),
          costPriceMinor: BigInt(input.costPriceMinor),
          reorderLevel: input.reorderLevel,
          unit: input.unit,
          status: input.status,
          createdBy: userId,
        },
      });

      // optional opening stock per branch → StockLevel + an opening movement
      for (const { branchId, quantity } of input.openingStock ?? []) {
        if (quantity <= 0) continue;
        await tx.stockLevel.create({ data: { tenantId, branchId, productId: product.id, quantity } });
        await tx.stockMovement.create({
          data: {
            tenantId,
            branchId,
            productId: product.id,
            type: "adjustment",
            quantity,
            reason: "opening stock",
            createdBy: userId,
          },
        });
      }

      await this.audit.log(
        { action: "product.created", entityType: "product", entityId: product.id, after: { sku: product.sku } },
        tx,
      );
      return toProductResponse({ ...product, stockLevels: [] }, undefined);
    });
  }

  async update(id: string, input: UpdateProductInput): Promise<ProductResponse> {
    const existing = await this.prisma.client.product.findFirst({ where: { id, deletedAt: null } });
    if (!existing) {
      throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: "Product not found" });
    }
    const userId = this.cls.get(CLS_KEYS.userId) as string;
    if (input.sku !== undefined && input.sku !== existing.sku) await this.assertSkuFree(input.sku, id);

    const product = await this.prisma.client.product.update({
      where: { id },
      data: {
        ...(input.nameEn !== undefined ? { nameEn: input.nameEn } : {}),
        ...(input.nameAr !== undefined ? { nameAr: input.nameAr } : {}),
        ...(input.sku !== undefined ? { sku: input.sku } : {}),
        ...(input.brand !== undefined ? { brand: input.brand } : {}),
        ...(input.salePriceMinor !== undefined ? { salePriceMinor: BigInt(input.salePriceMinor) } : {}),
        ...(input.costPriceMinor !== undefined ? { costPriceMinor: BigInt(input.costPriceMinor) } : {}),
        ...(input.reorderLevel !== undefined ? { reorderLevel: input.reorderLevel } : {}),
        ...(input.unit !== undefined ? { unit: input.unit } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        updatedBy: userId,
      },
    });
    return toProductResponse({ ...product, stockLevels: [] }, undefined);
  }

  /** Manual stock adjustment — delta applied to the branch quantity (never below 0). */
  async adjustStock(productId: string, input: AdjustStockInput): Promise<ProductResponse> {
    const tenantId = this.cls.get(CLS_KEYS.tenantId) as string;
    const userId = this.cls.get(CLS_KEYS.userId) as string;

    return this.prisma.withTenantTx(async (tx) => {
      const product = await tx.product.findFirst({ where: { id: productId, deletedAt: null } });
      if (!product) {
        throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: "Product not found" });
      }
      const level = await tx.stockLevel.findUnique({
        where: { branchId_productId: { branchId: input.branchId, productId } },
      });
      const current = level?.quantity ?? 0;
      const next = current + input.delta;
      if (next < 0) {
        throw new BadRequestException({
          code: ERROR_CODES.VALIDATION_FAILED,
          message: "Adjustment would make stock negative",
        });
      }
      await tx.stockLevel.upsert({
        where: { branchId_productId: { branchId: input.branchId, productId } },
        create: { tenantId, branchId: input.branchId, productId, quantity: next },
        update: { quantity: next },
      });
      await tx.stockMovement.create({
        data: {
          tenantId,
          branchId: input.branchId,
          productId,
          type: "adjustment",
          quantity: input.delta,
          reason: input.reason ?? null,
          createdBy: userId,
        },
      });
      await this.audit.log(
        { action: "stock.adjusted", entityType: "product", entityId: productId, after: { branchId: input.branchId, delta: input.delta, quantity: next } },
        tx,
      );
      return toProductResponse(
        { ...product, stockLevels: [{ id: "", tenantId, branchId: input.branchId, productId, quantity: next, updatedAt: new Date() }] },
        input.branchId,
      );
    });
  }

  private async assertSkuFree(sku: string, excludeId?: string): Promise<void> {
    const clash = await this.prisma.client.product.findFirst({
      where: { sku, deletedAt: null, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true },
    });
    if (clash) {
      throw new ConflictException({ code: ERROR_CODES.NAME_EXISTS, message: "A product with this SKU already exists" });
    }
  }
}

function toProductResponse(p: ProductRow, branchId?: string): ProductResponse {
  const stockQuantity = branchId ? (p.stockLevels[0]?.quantity ?? 0) : null;
  return {
    id: p.id,
    nameEn: p.nameEn,
    nameAr: p.nameAr,
    sku: p.sku,
    brand: p.brand,
    salePriceMinor: Number(p.salePriceMinor),
    costPriceMinor: Number(p.costPriceMinor),
    reorderLevel: p.reorderLevel,
    unit: p.unit as ProductResponse["unit"],
    status: p.status,
    stockQuantity,
    lowStock: stockQuantity !== null && stockQuantity <= p.reorderLevel,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

function parseSort(sort?: string): Record<string, "asc" | "desc"> | undefined {
  if (!sort) return undefined;
  const desc = sort.startsWith("-");
  const field = desc ? sort.slice(1) : sort;
  const allowed = new Set(["nameEn", "sku", "salePriceMinor", "createdAt"]);
  if (!allowed.has(field)) return undefined;
  return { [field]: desc ? "desc" : "asc" };
}

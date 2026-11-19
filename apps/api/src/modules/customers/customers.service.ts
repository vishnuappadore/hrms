import { randomUUID } from "node:crypto";
import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { Prisma } from "@prisma/client";
import {
  ERROR_CODES,
  type CreateCustomerInput,
  type Customer as CustomerResponse,
  type ListCustomersQuery,
  type Paginated,
  type PresignCustomerPhotoInput,
  type PresignedUpload,
  type UpdateCustomerInput,
} from "@keystonehr/shared";
import { CLS_KEYS } from "../../common/request-context";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../audit/audit.service";
import { StorageService } from "../storage/storage.service";

type CustomerRow = Prisma.CustomerGetPayload<Record<string, never>>;

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly cls: ClsService,
    private readonly storage: StorageService,
  ) {}

  async presignPhotoUpload(input: PresignCustomerPhotoInput): Promise<PresignedUpload> {
    const tenantId = this.cls.get(CLS_KEYS.tenantId) as string;
    const key = `tenants/${tenantId}/customer-photo/${randomUUID()}-${input.fileName}`;
    const uploadUrl = await this.storage.getUploadUrl(key, input.contentType);
    return { uploadUrl, key };
  }

  async list(query: ListCustomersQuery): Promise<Paginated<CustomerResponse>> {
    const where: Prisma.CustomerWhereInput = {
      ...(query.tier ? { tier: query.tier } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: "insensitive" } },
              { mobile: { contains: query.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const orderBy = parseSort(query.sort) ?? { createdAt: "desc" as const };
    const [total, data, currency] = await Promise.all([
      this.prisma.client.customer.count({ where }),
      this.prisma.client.customer.findMany({
        where,
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.tenantCurrency(),
    ]);

    return {
      data: await Promise.all(data.map((c) => this.toCustomerResponse(c, currency))),
      meta: { page: query.page, pageSize: query.pageSize, total },
    };
  }

  async getById(id: string): Promise<CustomerResponse> {
    const [customer, currency] = await Promise.all([
      this.prisma.client.customer.findFirst({ where: { id } }),
      this.tenantCurrency(),
    ]);
    if (!customer) {
      throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: "Customer not found" });
    }
    return this.toCustomerResponse(customer, currency);
  }

  async create(input: CreateCustomerInput): Promise<CustomerResponse> {
    const tenantId = this.cls.get(CLS_KEYS.tenantId) as string;
    const userId = this.cls.get(CLS_KEYS.userId) as string;
    await this.assertMobileFree(input.mobile);
    if (input.email) await this.assertEmailFree(input.email);

    return this.prisma.withTenantTx(async (tx) => {
      const customer = await tx.customer.create({
        data: {
          tenantId,
          mobile: input.mobile,
          name: input.name,
          email: input.email ?? null,
          tier: input.tier,
          photoKey: input.photoKey ?? null,
          createdBy: userId,
        },
      });
      const currency = (
        await tx.tenant.findUniqueOrThrow({
          where: { id: tenantId },
          select: { defaultCurrency: true },
        })
      ).defaultCurrency;
      const response = await this.toCustomerResponse(customer, currency);
      await this.audit.log(
        { action: "customer.created", entityType: "customer", entityId: customer.id, after: response },
        tx,
      );
      return response;
    }).catch(mapUniqueViolation);
  }

  async update(id: string, input: UpdateCustomerInput): Promise<CustomerResponse> {
    const before = await this.getById(id);
    const tenantId = this.cls.get(CLS_KEYS.tenantId) as string;
    const userId = this.cls.get(CLS_KEYS.userId) as string;
    if (input.mobile !== undefined && input.mobile !== before.mobile) {
      await this.assertMobileFree(input.mobile, id);
    }
    if (input.email && input.email !== before.email) {
      await this.assertEmailFree(input.email, id);
    }

    return this.prisma.withTenantTx(async (tx) => {
      const customer = await tx.customer.update({
        where: { id },
        data: {
          ...(input.mobile !== undefined ? { mobile: input.mobile } : {}),
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.email !== undefined ? { email: input.email } : {}),
          ...(input.tier !== undefined ? { tier: input.tier } : {}),
          ...(input.photoKey !== undefined ? { photoKey: input.photoKey } : {}),
          updatedBy: userId,
        },
      });
      const currency = (
        await tx.tenant.findUniqueOrThrow({
          where: { id: tenantId },
          select: { defaultCurrency: true },
        })
      ).defaultCurrency;
      const response = await this.toCustomerResponse(customer, currency);
      await this.audit.log(
        { action: "customer.updated", entityType: "customer", entityId: id, before, after: response },
        tx,
      );
      return response;
    }).catch(mapUniqueViolation);
  }

  /* ── Guards / helpers ───────────────────────────────────────────────── */

  private async assertMobileFree(mobile: string, excludeId?: string): Promise<void> {
    const clash = await this.prisma.client.customer.findFirst({
      where: { mobile, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true },
    });
    if (clash) {
      throw new ConflictException({
        code: ERROR_CODES.CUSTOMER_MOBILE_EXISTS,
        message: "A customer with this mobile number already exists",
      });
    }
  }

  private async assertEmailFree(email: string, excludeId?: string): Promise<void> {
    const clash = await this.prisma.client.customer.findFirst({
      where: { email, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true },
    });
    if (clash) {
      throw new ConflictException({
        code: ERROR_CODES.CUSTOMER_EMAIL_EXISTS,
        message: "A customer with this email already exists",
      });
    }
  }

  /** Tenant default currency — used only to render the totalSpend column. */
  private async tenantCurrency(): Promise<string> {
    const tenantId = this.cls.get(CLS_KEYS.tenantId) as string;
    const tenant = await this.prisma.client.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { defaultCurrency: true },
    });
    return tenant.defaultCurrency;
  }

  private async toCustomerResponse(customer: CustomerRow, currency: string): Promise<CustomerResponse> {
    return {
      id: customer.id,
      mobile: customer.mobile,
      name: customer.name,
      email: customer.email,
      tier: customer.tier,
      visits: customer.visits,
      points: customer.points,
      totalSpendMinor: Number(customer.totalSpendMinor),
      currency,
      photoUrl: customer.photoKey ? await this.storage.getDownloadUrl(customer.photoKey) : null,
      createdAt: customer.createdAt,
      updatedAt: customer.updatedAt,
    };
  }
}

function parseSort(sort?: string): Record<string, "asc" | "desc"> | undefined {
  if (!sort) return undefined;
  const desc = sort.startsWith("-");
  const field = desc ? sort.slice(1) : sort;
  const allowed = new Set(["name", "createdAt", "visits", "points", "totalSpendMinor"]);
  if (!allowed.has(field)) return undefined;
  return { [field]: desc ? "desc" : "asc" };
}

/**
 * Race backstop for the check-then-write guards above: two concurrent writes can both pass
 * assertMobileFree/assertEmailFree, and the loser then hits the DB unique index (P2002). Map it to
 * the same stable codes instead of a raw 500.
 */
function mapUniqueViolation(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    const target = String(err.meta?.target ?? "");
    if (target.includes("email")) {
      throw new ConflictException({
        code: ERROR_CODES.CUSTOMER_EMAIL_EXISTS,
        message: "A customer with this email already exists",
      });
    }
    if (target.includes("mobile")) {
      throw new ConflictException({
        code: ERROR_CODES.CUSTOMER_MOBILE_EXISTS,
        message: "A customer with this mobile number already exists",
      });
    }
  }
  throw err;
}

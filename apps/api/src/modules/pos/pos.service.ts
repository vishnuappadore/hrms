import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { Prisma } from "@prisma/client";
import {
  computeInvoiceTotals,
  ERROR_CODES,
  type CheckoutInput,
  type Invoice as InvoiceResponse,
  type ListInvoicesQuery,
  type Paginated,
} from "@keystonehr/shared";
import { CLS_KEYS, getEffectiveBranchIds } from "../../common/request-context";
import { PrismaService, type TxClient } from "../../database/prisma.service";
import { RedisService } from "../../common/redis.service";
import { AuditService } from "../audit/audit.service";
import { TaxesService } from "../taxes/taxes.service";

const INVOICE_INCLUDE = {
  customer: { select: { id: true, name: true, mobile: true } },
  items: { orderBy: { id: "asc" as const } },
  payments: { orderBy: { createdAt: "asc" as const } },
} satisfies Prisma.InvoiceInclude;

type InvoiceRow = Prisma.InvoiceGetPayload<{ include: typeof INVOICE_INCLUDE }>;

/** A resolved, server-priced line ready to persist. */
interface ResolvedLine {
  itemType: "service" | "product";
  itemId: string;
  nameEn: string;
  nameAr: string | null;
  unitPriceMinor: number;
  quantity: number;
  lineTotalMinor: number;
  staffId: string | null;
}

const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;

@Injectable()
export class PosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly cls: ClsService,
    private readonly taxes: TaxesService,
    private readonly redis: RedisService,
  ) {}

  async checkout(input: CheckoutInput, idempotencyKey?: string): Promise<InvoiceResponse> {
    const tenantId = this.cls.get(CLS_KEYS.tenantId) as string;

    // Idempotency: first caller claims the key; a replay returns the original invoice.
    const idemKey = idempotencyKey ? `idemp:pos:${tenantId}:${idempotencyKey}` : null;
    if (idemKey) {
      const won = await this.redis.claim(idemKey, "pending", IDEMPOTENCY_TTL_SECONDS);
      if (!won) {
        const stored = await this.redis.get(idemKey);
        if (stored && stored !== "pending") return this.getById(stored);
        throw new ConflictException({
          code: ERROR_CODES.IDEMPOTENT_REPLAY,
          message: "A checkout with this Idempotency-Key is already in progress",
        });
      }
    }

    try {
      const invoice = await this.runCheckout(tenantId, input);
      if (idemKey) await this.redis.set(idemKey, invoice.id, IDEMPOTENCY_TTL_SECONDS);
      return invoice;
    } catch (err) {
      // release the claim so a corrected retry isn't wedged for 24h
      if (idemKey) await this.redis.client.del(idemKey).catch(() => undefined);
      throw err;
    }
  }

  private async runCheckout(tenantId: string, input: CheckoutInput): Promise<InvoiceResponse> {
    const userId = this.cls.get(CLS_KEYS.userId) as string;

    const branch = await this.prisma.client.branch.findUnique({
      where: { id: input.branchId },
      select: { id: true, currency: true },
    });
    if (!branch) {
      throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: "Branch not found" });
    }

    // resolve + server-price every line BEFORE opening the transaction (Risk #2)
    const lines = await this.resolveLines(input);
    const productNeeds = new Map<string, number>();
    for (const l of lines) {
      if (l.itemType === "product") {
        productNeeds.set(l.itemId, (productNeeds.get(l.itemId) ?? 0) + l.quantity);
      }
    }

    const taxComponents = await this.taxes.getComponentsForBranch(input.branchId);
    const totals = computeInvoiceTotals({
      lineTotalsMinor: lines.map((l) => l.lineTotalMinor),
      discountMinor: input.discountMinor,
      taxComponents,
    });
    if (input.discountMinor > totals.subtotalMinor) {
      throw new BadRequestException({
        code: ERROR_CODES.VALIDATION_FAILED,
        message: "Discount exceeds the sale subtotal",
      });
    }

    const paid = input.payments.reduce((sum, p) => sum + p.amountMinor, 0);
    if (paid !== totals.totalMinor) {
      throw new BadRequestException({
        code: ERROR_CODES.VALIDATION_FAILED,
        message: "Sum of payments must equal the total",
      });
    }

    // optional originating appointment must exist, be completed, be this branch's,
    // and not already have been checked out
    if (input.appointmentId) {
      const appt = await this.prisma.client.appointment.findFirst({
        where: { id: input.appointmentId, branchId: input.branchId },
        select: { status: true, invoiceId: true },
      });
      if (!appt) {
        throw new BadRequestException({
          code: ERROR_CODES.VALIDATION_FAILED,
          message: "Originating appointment not found at this branch",
        });
      }
      // Fail fast for the common stale-tab case; the conditional update inside the
      // transaction below is the race-safe check.
      if (appt.status !== "completed" || appt.invoiceId !== null) {
        throw new ConflictException({
          code: ERROR_CODES.INVALID_STATUS_TRANSITION,
          message: "This appointment has already been checked out",
        });
      }
    }

    // optional originating walk-in queue entry (entry point 3) must exist at this branch
    if (input.walkInId) {
      const walkIn = await this.prisma.client.walkInQueueEntry.findFirst({
        where: { id: input.walkInId, branchId: input.branchId },
        select: { id: true, status: true },
      });
      if (!walkIn) {
        throw new BadRequestException({
          code: ERROR_CODES.VALIDATION_FAILED,
          message: "Originating walk-in queue entry not found at this branch",
        });
      }
      // Fail fast for the common stale-tab case; the conditional update inside the
      // transaction below is the race-safe check.
      if (walkIn.status !== "serving") {
        throw new ConflictException({
          code: ERROR_CODES.INVALID_STATUS_TRANSITION,
          message: `Cannot check out a walk-in that is ${walkIn.status}`,
        });
      }
    }

    const invoice = await this.prisma.withTenantTx(async (tx) => {
      // 1. deduct product stock — lock rows in deterministic (product-id) order,
      //    hard-block negative stock. No slow I/O inside the tx (Risk #2).
      for (const productId of [...productNeeds.keys()].sort()) {
        const need = productNeeds.get(productId)!;
        const rows = await tx.$queryRaw<{ quantity: number }[]>`
          SELECT quantity FROM stock_levels
          WHERE branch_id = ${input.branchId}::uuid AND product_id = ${productId}::uuid
          FOR UPDATE`;
        const have = rows[0]?.quantity ?? 0;
        if (have < need) {
          throw new ConflictException({
            code: ERROR_CODES.VALIDATION_FAILED,
            message: "Insufficient stock for a product in the sale",
          });
        }
        await tx.stockLevel.update({
          where: { branchId_productId: { branchId: input.branchId, productId } },
          data: { quantity: have - need },
        });
        await tx.stockMovement.create({
          data: {
            tenantId,
            branchId: input.branchId,
            productId,
            type: "sale",
            quantity: -need,
            refType: "invoice",
            createdBy: userId,
          },
        });
      }

      // 2. invoice + items + payments
      const invoiceNo = await this.nextInvoiceNo(tx, tenantId);
      const created = await tx.invoice.create({
        data: {
          tenantId,
          branchId: input.branchId,
          invoiceNo,
          customerId: input.customerId ?? null,
          appointmentId: input.appointmentId ?? null,
          walkInQueueEntryId: input.walkInId ?? null,
          cashierId: userId,
          status: "paid",
          subtotalMinor: BigInt(totals.subtotalMinor),
          discountMinor: BigInt(totals.discountMinor),
          taxMinor: BigInt(totals.taxMinor),
          taxBreakdown: totals.taxBreakdown as unknown as Prisma.InputJsonValue,
          totalMinor: BigInt(totals.totalMinor),
          currency: branch.currency,
          notes: input.notes ?? null,
          items: {
            create: lines.map((l) => ({
              tenantId,
              itemType: l.itemType,
              itemId: l.itemId,
              nameEn: l.nameEn,
              nameAr: l.nameAr,
              unitPriceMinor: BigInt(l.unitPriceMinor),
              quantity: l.quantity,
              lineTotalMinor: BigInt(l.lineTotalMinor),
              staffId: l.staffId,
            })),
          },
          payments: {
            create: input.payments.map((p) => ({
              tenantId,
              method: p.method,
              amountMinor: BigInt(p.amountMinor),
              reference: p.reference ?? null,
            })),
          },
        },
        include: INVOICE_INCLUDE,
      });

      // 2b. mark the originating Walk-in Queue entry Completed (entry point 3 —
      // unlike appointments, the queue's Serving → Completed transition is only
      // ever reached via a successful checkout, per docs/MODULES/pos.md Part B)
      if (input.walkInId) {
        // Conditional on still being "serving" (WALKIN_TRANSITIONS: serving → completed only):
        // a cancelled / already-checked-out entry, or a concurrent second checkout, matches 0
        // rows and rolls back the whole sale instead of double-billing.
        const { count } = await tx.walkInQueueEntry.updateMany({
          where: { id: input.walkInId, status: "serving" },
          data: { status: "completed", completedAt: new Date(), invoiceId: created.id },
        });
        if (count !== 1) {
          throw new ConflictException({
            code: ERROR_CODES.INVALID_STATUS_TRANSITION,
            message: "Walk-in is no longer being served — it may already have been checked out",
          });
        }
      }

      // 2c. link the invoice back onto the originating Appointment, same race-safe
      // shape as 2b: conditional on still being completed and not yet invoiced, so a
      // concurrent second checkout matches 0 rows and rolls back the whole sale.
      if (input.appointmentId) {
        const { count } = await tx.appointment.updateMany({
          where: { id: input.appointmentId, status: "completed", invoiceId: null },
          data: { invoiceId: created.id },
        });
        if (count !== 1) {
          throw new ConflictException({
            code: ERROR_CODES.INVALID_STATUS_TRANSITION,
            message: "This appointment has already been checked out",
          });
        }
      }

      // 3. finance ledger — one sale_revenue row
      await tx.financeTransaction.create({
        data: {
          tenantId,
          branchId: input.branchId,
          direction: "in",
          category: "sale_revenue",
          amountMinor: BigInt(totals.totalMinor),
          currency: branch.currency,
          refType: "invoice",
          refId: created.id,
        },
      });

      // 4. customer counters (loyalty points deferred to Phase 5)
      if (input.customerId) {
        await tx.customer.update({
          where: { id: input.customerId },
          data: {
            visits: { increment: 1 },
            totalSpendMinor: { increment: BigInt(totals.totalMinor) },
          },
        });
      }

      await this.audit.log(
        {
          action: "pos.sale.completed",
          entityType: "invoice",
          entityId: created.id,
          after: { invoiceNo: created.invoiceNo, totalMinor: totals.totalMinor },
        },
        tx,
      );
      return created;
    });

    return toInvoiceResponse(invoice);
  }

  async list(query: ListInvoicesQuery): Promise<Paginated<InvoiceResponse>> {
    const effectiveBranchIds = getEffectiveBranchIds(this.cls);
    let branchIdFilter: Prisma.InvoiceWhereInput["branchId"];
    if (query.branchId) {
      branchIdFilter =
        effectiveBranchIds && !effectiveBranchIds.includes(query.branchId)
          ? { in: [] }
          : query.branchId;
    } else if (effectiveBranchIds) {
      branchIdFilter = { in: effectiveBranchIds };
    }

    const where: Prisma.InvoiceWhereInput = {
      ...(branchIdFilter !== undefined ? { branchId: branchIdFilter } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.from || query.to
        ? { createdAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } }
        : {}),
      ...(query.search
        ? {
            OR: [
              { invoiceNo: { contains: query.search, mode: "insensitive" } },
              { customer: { name: { contains: query.search, mode: "insensitive" } } },
              { customer: { mobile: { contains: query.search, mode: "insensitive" } } },
            ],
          }
        : {}),
    };

    const [total, data] = await Promise.all([
      this.prisma.client.invoice.count({ where }),
      this.prisma.client.invoice.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: INVOICE_INCLUDE,
      }),
    ]);
    return {
      data: data.map(toInvoiceResponse),
      meta: { page: query.page, pageSize: query.pageSize, total },
    };
  }

  async getById(id: string): Promise<InvoiceResponse> {
    const effectiveBranchIds = getEffectiveBranchIds(this.cls);
    const invoice = await this.prisma.client.invoice.findFirst({
      where: { id, ...(effectiveBranchIds ? { branchId: { in: effectiveBranchIds } } : {}) },
      include: INVOICE_INCLUDE,
    });
    if (!invoice) {
      throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: "Invoice not found" });
    }
    return toInvoiceResponse(invoice);
  }

  /* ── helpers ──────────────────────────────────────────────────────────── */

  /** Resolve every cart line to a server-priced line; reject anything invalid. */
  private async resolveLines(input: CheckoutInput): Promise<ResolvedLine[]> {
    const serviceIds = input.items.filter((i) => i.type === "service").map((i) => i.id);
    const productIds = input.items.filter((i) => i.type === "product").map((i) => i.id);
    const unsupported = input.items.find((i) => i.type !== "service" && i.type !== "product");
    if (unsupported) {
      throw new BadRequestException({
        code: ERROR_CODES.VALIDATION_FAILED,
        message: "Only service and product lines are supported in this checkout",
      });
    }

    const [services, products] = await Promise.all([
      serviceIds.length
        ? this.prisma.client.service.findMany({
            where: { id: { in: serviceIds }, status: "active", deletedAt: null },
            include: { branchOverrides: { where: { branchId: input.branchId } } },
          })
        : Promise.resolve([]),
      productIds.length
        ? this.prisma.client.product.findMany({
            where: { id: { in: productIds }, status: "active", deletedAt: null },
          })
        : Promise.resolve([]),
    ]);
    const serviceById = new Map(services.map((s) => [s.id, s]));
    const productById = new Map(products.map((p) => [p.id, p]));

    return input.items.map((item) => {
      if (item.type === "service") {
        const s = serviceById.get(item.id);
        if (!s) {
          throw new BadRequestException({
            code: ERROR_CODES.VALIDATION_FAILED,
            message: "A selected service is unavailable",
          });
        }
        const override = s.branchOverrides[0];
        if (override?.isAvailable === false) {
          throw new BadRequestException({
            code: ERROR_CODES.VALIDATION_FAILED,
            message: "A selected service is not offered at this branch",
          });
        }
        const unit = Number(override?.priceOverrideMinor ?? s.priceMinor);
        return {
          itemType: "service" as const,
          itemId: s.id,
          nameEn: s.nameEn,
          nameAr: s.nameAr,
          unitPriceMinor: unit,
          quantity: item.quantity,
          lineTotalMinor: unit * item.quantity,
          staffId: item.staffId ?? null,
        };
      }
      const p = productById.get(item.id);
      if (!p) {
        throw new BadRequestException({
          code: ERROR_CODES.VALIDATION_FAILED,
          message: "A selected product is unavailable",
        });
      }
      const unit = Number(p.salePriceMinor);
      return {
        itemType: "product" as const,
        itemId: p.id,
        nameEn: p.nameEn,
        nameAr: p.nameAr,
        unitPriceMinor: unit,
        quantity: item.quantity,
        lineTotalMinor: unit * item.quantity,
        staffId: item.staffId ?? null,
      };
    });
  }

  /** Unique per-tenant display ref: INV-<year>-<6 digits>. Count-based (see CLAUDE.md). */
  private async nextInvoiceNo(tx: TxClient, tenantId: string): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `INV-${year}-`;
    // Count-based numbering races: two concurrent checkouts both count N and both insert N+1, and
    // the loser hits the (tenant_id, invoice_no) unique index as a raw 500. A transaction-scoped
    // advisory lock per tenant serializes just this numbering step until the sale commits (released
    // automatically on commit/rollback) — negligible contention at salon scale.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"invoice_no:" + tenantId}))`;
    const count = await tx.invoice.count({ where: { tenantId, invoiceNo: { startsWith: prefix } } });
    return `${prefix}${String(count + 1).padStart(6, "0")}`;
  }
}

function toInvoiceResponse(row: InvoiceRow): InvoiceResponse {
  return {
    id: row.id,
    invoiceNo: row.invoiceNo,
    branchId: row.branchId,
    customerId: row.customerId,
    customer: row.customer,
    appointmentId: row.appointmentId,
    walkInId: row.walkInQueueEntryId,
    status: row.status,
    subtotalMinor: Number(row.subtotalMinor),
    discountMinor: Number(row.discountMinor),
    taxMinor: Number(row.taxMinor),
    taxBreakdown: (row.taxBreakdown as { name: string; ratePercent: number; amountMinor: number }[]) ?? [],
    totalMinor: Number(row.totalMinor),
    currency: row.currency,
    items: row.items.map((i) => ({
      type: i.itemType,
      itemId: i.itemId,
      nameEn: i.nameEn,
      nameAr: i.nameAr,
      unitPriceMinor: Number(i.unitPriceMinor),
      quantity: i.quantity,
      lineTotalMinor: Number(i.lineTotalMinor),
      staffId: i.staffId,
    })),
    payments: row.payments.map((p) => ({
      method: p.method,
      amountMinor: Number(p.amountMinor),
      reference: p.reference,
    })),
    notes: row.notes,
    createdAt: row.createdAt,
  };
}

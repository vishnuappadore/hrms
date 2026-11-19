import { z } from "zod";
import { PaginationQuerySchema } from "./common";
import { INVOICE_ITEM_TYPES, INVOICE_STATUSES, PAYMENT_METHODS } from "../enums";

/**
 * POS / Checkout contract (Core Checkout slice). Money is integer minor units of
 * the branch currency; the server ALWAYS recomputes prices and totals from the
 * catalogue — client-sent amounts are advisory only. Invariant (money.ts,
 * property-tested): sum(lines) − discount + VAT === total === sum(payments).
 *
 * Deferred (own phases): loyalty redeem/earn, packages, memberships,
 * commissions. The checkout only sells `service` and `product` lines; only
 * `product` lines deduct inventory.
 */

export const CheckoutLineSchema = z.object({
  /** this slice accepts service | product; package/membership rejected server-side */
  type: z.enum(INVOICE_ITEM_TYPES),
  /** serviceId or productId */
  id: z.string().uuid(),
  quantity: z.number().int().min(1).max(999).default(1),
  /** optional serving staff for this line (commission attribution, computed later) */
  staffId: z.string().uuid().nullable().optional(),
});
export type CheckoutLineInput = z.infer<typeof CheckoutLineSchema>;

export const CheckoutPaymentSchema = z.object({
  method: z.enum(PAYMENT_METHODS),
  /** amount tendered on this method, integer minor units; split = multiple rows */
  amountMinor: z.number().int().min(1),
  reference: z.string().max(100).nullable().optional(),
});
export type CheckoutPaymentInput = z.infer<typeof CheckoutPaymentSchema>;

export const CheckoutSchema = z.object({
  branchId: z.string().uuid(),
  /** existing customer; omit for an anonymous walk-in sale */
  customerId: z.string().uuid().nullable().optional(),
  /** originating completed appointment (entry point 2); linked + recorded on the invoice */
  appointmentId: z.string().uuid().nullable().optional(),
  /** originating Walk-in Queue entry (entry point 3); marked Completed on successful payment */
  walkInId: z.string().uuid().nullable().optional(),
  items: z.array(CheckoutLineSchema).min(1).max(100),
  /** single manual discount for the whole sale, integer minor units (applied pre-VAT) */
  discountMinor: z.number().int().min(0).default(0),
  payments: z.array(CheckoutPaymentSchema).min(1).max(10),
  notes: z.string().max(500).nullable().optional(),
});
export type CheckoutInput = z.infer<typeof CheckoutSchema>;

/* ── Responses ───────────────────────────────────────────────────────────── */

export const InvoiceItemSchema = z.object({
  type: z.enum(INVOICE_ITEM_TYPES),
  itemId: z.string().uuid(),
  nameEn: z.string(),
  nameAr: z.string().nullable(),
  unitPriceMinor: z.number().int(),
  quantity: z.number().int(),
  lineTotalMinor: z.number().int(),
  staffId: z.string().uuid().nullable(),
});
export type InvoiceItem = z.infer<typeof InvoiceItemSchema>;

export const InvoicePaymentSchema = z.object({
  method: z.enum(PAYMENT_METHODS),
  amountMinor: z.number().int(),
  reference: z.string().nullable(),
});
export type InvoicePayment = z.infer<typeof InvoicePaymentSchema>;

export const TaxLineSchema = z.object({
  name: z.string(),
  ratePercent: z.number(),
  amountMinor: z.number().int(),
});

export const InvoiceSchema = z.object({
  id: z.string().uuid(),
  invoiceNo: z.string(),
  branchId: z.string().uuid(),
  customerId: z.string().uuid().nullable(),
  customer: z.object({ id: z.string().uuid(), name: z.string(), mobile: z.string() }).nullable(),
  appointmentId: z.string().uuid().nullable(),
  walkInId: z.string().uuid().nullable(),
  status: z.enum(INVOICE_STATUSES),
  subtotalMinor: z.number().int(),
  discountMinor: z.number().int(),
  taxMinor: z.number().int(),
  taxBreakdown: z.array(TaxLineSchema),
  totalMinor: z.number().int(),
  currency: z.string(),
  items: z.array(InvoiceItemSchema),
  payments: z.array(InvoicePaymentSchema),
  notes: z.string().nullable(),
  createdAt: z.coerce.date(),
});
export type Invoice = z.infer<typeof InvoiceSchema>;

export const ListInvoicesQuerySchema = PaginationQuerySchema.extend({
  branchId: z.string().uuid().optional(),
  status: z.enum(INVOICE_STATUSES).optional(),
  /** matches invoiceNo + customer name + customer mobile */
  search: z.string().max(100).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type ListInvoicesQuery = z.infer<typeof ListInvoicesQuerySchema>;

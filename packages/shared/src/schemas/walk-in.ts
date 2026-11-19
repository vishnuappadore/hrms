import { z } from "zod";
import { MobileSchema, PaginationQuerySchema } from "./common";
import { WALKIN_STATUSES } from "../enums";

/**
 * Walk-in Queue — registration, the Waiting/Serving/Completed board, and the
 * status machine (docs/MODULES/pos.md Part B). Mirrors Appointments' shape:
 * a wizard-free single "Add Walk-in" drawer whose output is
 * CreateWalkInSchema, plus List/Board views over the SAME branch-scoped data.
 *
 * Money is integer minor units + ISO 4217 currency (money.ts); the total is
 * ALWAYS recomputed server-side from the selected services' branch prices —
 * the client never sends a total. Currency flows tenant default → branch.
 */

const WalkInStatusEnum = z.enum(WALKIN_STATUSES);

/**
 * Output of the Add Walk-in drawer. Customer identity is OPTIONAL, same as
 * Appointments:
 *  - `mobileNumber` (+ optional `customerName`) links-or-creates a Customer on
 *    save, OR
 *  - no mobile at all → an anonymous walk-in (`customer_id` null,
 *    `customerName` renders as "Walk-in Guest" client-side when blank).
 */
export const CreateWalkInSchema = z.object({
  branchId: z.string().uuid(),
  mobileNumber: MobileSchema.nullable().optional(),
  customerName: z.string().trim().min(1).max(200).nullable().optional(),
  serviceIds: z.array(z.string().uuid()).min(1).max(20),
  barberStaffId: z.string().uuid().nullable().optional(),
});
export type CreateWalkInInput = z.infer<typeof CreateWalkInSchema>;

/**
 * Edits entered details on an existing entry — customer identity + selected
 * services only. `branchId` isn't editable (it's the scoping key), and
 * `barberStaffId` stays on the dedicated AssignWalkInBarberSchema endpoint.
 * Server-side: only allowed while status is waiting/serving (WALKIN_NOT_EDITABLE
 * otherwise), and serviceIds always re-snapshot totalMinor from current prices.
 */
export const UpdateWalkInSchema = CreateWalkInSchema.omit({
  branchId: true,
  barberStaffId: true,
}).partial();
export type UpdateWalkInInput = z.infer<typeof UpdateWalkInSchema>;

export const ListWalkInsQuerySchema = PaginationQuerySchema.extend({
  branchId: z.string().uuid().optional(),
  status: WalkInStatusEnum.optional(),
  /** matches customer name + mobile + service name */
  search: z.string().max(100).optional(),
  /**
   * Board mode: every still-active entry (waiting/serving, ANY age — an active entry must never
   * drop off the board) plus entries completed at/after this instant (the client sends its local
   * start-of-day). Cancelled entries are excluded. Overrides `status`.
   */
  boardSince: z.coerce.date().optional(),
});
export type ListWalkInsQuery = z.infer<typeof ListWalkInsQuerySchema>;

export const AssignWalkInBarberSchema = z.object({
  barberStaffId: z.string().uuid().nullable(),
});
export type AssignWalkInBarberInput = z.infer<typeof AssignWalkInBarberSchema>;

/* ── Responses ───────────────────────────────────────────────────────────── */

export const WalkInServiceLineSchema = z.object({
  serviceId: z.string().uuid(),
  nameEn: z.string(),
  nameAr: z.string(),
  /** per-branch price at registration time, integer minor units */
  priceMinor: z.number().int(),
  durationMinutes: z.number().int(),
});
export type WalkInServiceLine = z.infer<typeof WalkInServiceLineSchema>;

export const WalkInSchema = z.object({
  id: z.string().uuid(),
  branchId: z.string().uuid(),
  branch: z.object({ id: z.string().uuid(), nameEn: z.string(), nameAr: z.string() }),
  customerId: z.string().uuid().nullable(),
  customer: z
    .object({ id: z.string().uuid(), name: z.string(), mobile: z.string() })
    .nullable(),
  /** denormalized display name — render "Walk-in Guest" client-side when blank */
  customerName: z.string().nullable(),
  mobileNumber: z.string().nullable(),
  barberStaffId: z.string().uuid().nullable(),
  barber: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
  status: WalkInStatusEnum,
  queuedAt: z.coerce.date(),
  servingStartedAt: z.coerce.date().nullable(),
  completedAt: z.coerce.date().nullable(),
  totalMinor: z.number().int(),
  currency: z.string(),
  services: z.array(WalkInServiceLineSchema),
  /** set by POS checkout (entry point 3) on successful payment */
  invoiceId: z.string().uuid().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type WalkIn = z.infer<typeof WalkInSchema>;

/** Dashboard KPI cards (In Queue / Serving Now / Done Today / Average Wait). */
export const WalkInStatsSchema = z.object({
  inQueue: z.number().int(),
  servingNow: z.number().int(),
  doneToday: z.number().int(),
  /**
   * Mean minutes of (servingStartedAt ?? completedAt − queuedAt) over today's
   * entries that have left Waiting. Null when no such entries exist yet.
   * Definition is an implementation choice — docs/MODULES/pos.md flags the
   * exact Average Wait computation as unconfirmed by the client.
   */
  avgWaitMinutes: z.number().nullable(),
});
export type WalkInStats = z.infer<typeof WalkInStatsSchema>;

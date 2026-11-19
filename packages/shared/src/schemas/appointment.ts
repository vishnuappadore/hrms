import { z } from "zod";
import { MobileSchema, PaginationQuerySchema } from "./common";
import { APPOINTMENT_STATUSES } from "../enums";

/**
 * Appointments — booking, viewing, and the status machine (Phase 3).
 * The 2026 requirement (docs/MODULES/appointments.md) reframes the module
 * around a 4-step wizard (Services → Barber → Date & Time → Confirm) whose
 * output is CreateAppointmentSchema, plus a dashboard with List / Kanban /
 * Calendar views over the SAME branch-scoped data.
 *
 * Money is integer minor units + ISO 4217 currency (money.ts); the total is
 * ALWAYS recomputed server-side from the selected services' branch prices —
 * the client never sends a total. Currency flows tenant default → branch.
 */

const AppointmentStatusEnum = z.enum(APPOINTMENT_STATUSES);

/**
 * Output of the booking wizard. Customer identity is OPTIONAL (2026 spec):
 *  - `customerId` links an existing customer, OR
 *  - `customerMobile` (+ optional `customerName`) links-or-creates on save, OR
 *  - none of them → an appointment with no customer (`customer_id` null).
 * `scheduledStart` is an absolute instant; `scheduledEnd` is derived
 * server-side from the sum of the selected services' duration + buffer.
 */
export const CreateAppointmentSchema = z.object({
  branchId: z.string().uuid(),
  barberId: z.string().uuid(),
  serviceIds: z.array(z.string().uuid()).min(1).max(20),
  scheduledStart: z.coerce.date(),
  customerId: z.string().uuid().nullable().optional(),
  customerMobile: MobileSchema.nullable().optional(),
  customerName: z.string().min(1).max(200).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
});
export type CreateAppointmentInput = z.infer<typeof CreateAppointmentSchema>;

/**
 * Edit an existing appointment — scoped to barber/services/schedule only
 * (customer identity isn't re-linkable after booking, same as today's create
 * flow has no "move to a different customer" concept). Only allowed while
 * the appointment is still `waiting`/`confirmed` (service-enforced). Any
 * provided field fully replaces its current value; `serviceIds` re-snapshots
 * prices/duration server-side exactly like `create()`.
 */
export const UpdateAppointmentSchema = z
  .object({
    barberId: z.string().uuid().optional(),
    serviceIds: z.array(z.string().uuid()).min(1).max(20).optional(),
    scheduledStart: z.coerce.date().optional(),
  })
  .refine((v) => v.barberId !== undefined || v.serviceIds !== undefined || v.scheduledStart !== undefined, {
    message: "Provide at least one field to update",
  });
export type UpdateAppointmentInput = z.infer<typeof UpdateAppointmentSchema>;

export const ListAppointmentsQuerySchema = PaginationQuerySchema.extend({
  branchId: z.string().uuid().optional(),
  status: AppointmentStatusEnum.optional(),
  barberId: z.string().uuid().optional(),
  /** a customer's visit history (Customer Details page) */
  customerId: z.string().uuid().optional(),
  /** matches appointmentNo + customer name + customer mobile + service name */
  search: z.string().max(100).optional(),
  /** inclusive lower/upper bound on scheduledStart (day/week/calendar scoping) */
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type ListAppointmentsQuery = z.infer<typeof ListAppointmentsQuerySchema>;

/** Drives the status machine; validated against APPOINTMENT_TRANSITIONS. */
export const TransitionAppointmentSchema = z.object({
  status: AppointmentStatusEnum,
});
export type TransitionAppointmentInput = z.infer<typeof TransitionAppointmentSchema>;

/* ── Responses ───────────────────────────────────────────────────────────── */

export const AppointmentServiceLineSchema = z.object({
  serviceId: z.string().uuid(),
  nameEn: z.string(),
  nameAr: z.string(),
  /** per-branch price at booking time, integer minor units */
  priceMinor: z.number().int(),
  durationMinutes: z.number().int(),
});
export type AppointmentServiceLine = z.infer<typeof AppointmentServiceLineSchema>;

export const AppointmentStatusHistoryEntrySchema = z.object({
  fromStatus: AppointmentStatusEnum.nullable(),
  toStatus: AppointmentStatusEnum,
  at: z.coerce.date(),
});
export type AppointmentStatusHistoryEntry = z.infer<typeof AppointmentStatusHistoryEntrySchema>;

export const AppointmentSchema = z.object({
  id: z.string().uuid(),
  /** unique display reference, e.g. APT-2026-001245 */
  appointmentNo: z.string(),
  branchId: z.string().uuid(),
  branch: z.object({ id: z.string().uuid(), nameEn: z.string(), nameAr: z.string() }),
  customerId: z.string().uuid().nullable(),
  customer: z
    .object({ id: z.string().uuid(), name: z.string(), mobile: z.string() })
    .nullable(),
  /** denormalized name for a name-only booking (no mobile given, so no Customer record
   *  exists); null whenever `customer` is set. */
  customerName: z.string().nullable(),
  barberId: z.string().uuid(),
  barber: z.object({ id: z.string().uuid(), name: z.string() }),
  status: AppointmentStatusEnum,
  scheduledStart: z.coerce.date(),
  scheduledEnd: z.coerce.date(),
  durationMinutes: z.number().int(),
  totalMinor: z.number().int(),
  currency: z.string(),
  services: z.array(AppointmentServiceLineSchema),
  notes: z.string().nullable(),
  /** set by POS checkout on successful payment; non-null once invoiced */
  invoiceId: z.string().uuid().nullable(),
  /** status-change timeline — populated by GET /appointments/:id (detail modal) */
  history: z.array(AppointmentStatusHistoryEntrySchema).optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Appointment = z.infer<typeof AppointmentSchema>;

/* ── Wizard helper endpoints ─────────────────────────────────────────────── */

/**
 * Step 2 barber cards. There is no staff-schedule model yet (Phase 7), so
 * barbers are Users with the "Barber" role assigned to the branch, and `busy`
 * is derived from whether they currently have an in-progress appointment.
 */
export const ListBarbersQuerySchema = z.object({
  branchId: z.string().uuid(),
});
export type ListBarbersQuery = z.infer<typeof ListBarbersQuerySchema>;

export const AppointmentBarberSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  busy: z.boolean(),
});
export type AppointmentBarber = z.infer<typeof AppointmentBarberSchema>;

/**
 * Step 3 time slots for one barber on one date. Slots are generated from the
 * branch's working hours; double-booking is allowed (2026 spec is silent), so
 * `taken` is informational — a slot the barber already has an appointment in.
 */
export const ListSlotsQuerySchema = z.object({
  branchId: z.string().uuid(),
  barberId: z.string().uuid(),
  /** local calendar date, YYYY-MM-DD */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** total appointment duration (sum of service durations + buffers) */
  durationMinutes: z.coerce.number().int().min(5).max(600),
  /** editing this appointment — exclude its own current slot from the "taken" overlap check */
  excludeAppointmentId: z.string().uuid().optional(),
});
export type ListSlotsQuery = z.infer<typeof ListSlotsQuerySchema>;

export const AppointmentSlotSchema = z.object({
  /** "HH:mm" start time */
  time: z.string(),
  /** absolute instant of the slot start */
  startsAt: z.coerce.date(),
  /** the barber already has an overlapping appointment (informational) */
  taken: z.boolean(),
});
export type AppointmentSlot = z.infer<typeof AppointmentSlotSchema>;

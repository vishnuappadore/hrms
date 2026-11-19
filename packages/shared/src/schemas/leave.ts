import { z } from "zod";
import { LEAVE_HALF_DAY_PERIODS, LEAVE_REQUEST_STATUSES, LEAVE_TABS } from "../enums";
import { PaginationQuerySchema } from "./common";

/**
 * Leave requests, approval, and balances (docs/MODULES/leave.md). Requests
 * reference a [leave type](./leave-settings.ts) catalog row; deeper business
 * validation (minimum notice, half-day allowed, supporting document
 * required — all leave-type-specific) happens server-side against that row,
 * not in this schema, which only validates request shape.
 */

export const LeaveRequestStatusSchema = z.enum(LEAVE_REQUEST_STATUSES);
export const LeaveTabSchema = z.enum(LEAVE_TABS);
export const LeaveHalfDayPeriodSchema = z.enum(LEAVE_HALF_DAY_PERIODS);

const CreateLeaveRequestFieldsSchema = z.object({
  leaveTypeId: z.string().uuid(),
  /** omitted → the caller's own employee profile (self-service request) */
  employeeProfileId: z.string().uuid().optional(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  /** range requests only (startDate !== endDate) — the start date is only a half day */
  startHalfDay: z.boolean().default(false),
  /** range requests only — the end date is only a half day */
  endHalfDay: z.boolean().default(false),
  /** single-day requests only (startDate === endDate) — which half is on leave */
  halfDayPeriod: LeaveHalfDayPeriodSchema.optional(),
  reason: z.string().min(1).max(500),
  /** S3 object key from the presign-upload step; required only when the leave type's
   *  requireSupportingDocument is on (checked server-side) */
  attachmentKey: z.string().optional(),
});

function assertDateRange(
  v: { startDate: Date; endDate: Date; startHalfDay: boolean; endHalfDay: boolean; halfDayPeriod?: string },
  ctx: z.RefinementCtx,
): void {
  if (v.endDate < v.startDate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["endDate"],
      message: "End date must be on or after the start date",
    });
  }
  const isSingleDay = v.startDate.getTime() === v.endDate.getTime();
  if (isSingleDay && (v.startHalfDay || v.endHalfDay)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["halfDayPeriod"],
      message: "A single-day half-day request must use halfDayPeriod, not startHalfDay/endHalfDay",
    });
  }
  if (!isSingleDay && v.halfDayPeriod) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["halfDayPeriod"],
      message: "halfDayPeriod only applies to a single-day request — use startHalfDay/endHalfDay for a range",
    });
  }
}

export const CreateLeaveRequestSchema = CreateLeaveRequestFieldsSchema.superRefine(assertDateRange);
export type CreateLeaveRequestInput = z.infer<typeof CreateLeaveRequestSchema>;

export const RejectLeaveRequestSchema = z.object({
  rejectionReason: z.string().min(1).max(500),
});
export type RejectLeaveRequestInput = z.infer<typeof RejectLeaveRequestSchema>;

export const CancelLeaveRequestSchema = z.object({
  cancellationReason: z.string().min(1).max(500),
});
export type CancelLeaveRequestInput = z.infer<typeof CancelLeaveRequestSchema>;

export const PresignLeaveAttachmentSchema = z.object({
  fileName: z.string().min(1).max(255),
  contentType: z.string().min(1).max(100),
});
export type PresignLeaveAttachmentInput = z.infer<typeof PresignLeaveAttachmentSchema>;

export const PresignedUploadSchema = z.object({
  uploadUrl: z.string().url(),
  key: z.string(),
});
export type PresignedUpload = z.infer<typeof PresignedUploadSchema>;

export const ListLeaveRequestsQuerySchema = PaginationQuerySchema.extend({
  tab: LeaveTabSchema.optional(),
  branchId: z.string().uuid().optional(),
  leaveTypeId: z.string().uuid().optional(),
  search: z.string().max(100).optional(),
});
export type ListLeaveRequestsQuery = z.infer<typeof ListLeaveRequestsQuerySchema>;

/** `GET /leave/requests/me` — self-scoped, so no branch/search filter is meaningful. */
export const ListMyLeaveRequestsQuerySchema = PaginationQuerySchema.extend({
  tab: LeaveTabSchema.optional(),
});
export type ListMyLeaveRequestsQuery = z.infer<typeof ListMyLeaveRequestsQuerySchema>;

export const LeaveKpisQuerySchema = z.object({
  branchId: z.string().uuid().optional(),
});
export type LeaveKpisQuery = z.infer<typeof LeaveKpisQuerySchema>;

/** `/leave` screen's KPI row. */
export const LeaveKpisSchema = z.object({
  pending: z.number().int(),
  approvedThisMonth: z.number().int(),
  onLeaveToday: z.number().int(),
  rejected: z.number().int(),
});
export type LeaveKpis = z.infer<typeof LeaveKpisSchema>;

const EmployeeRefSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  branchName: z.string().nullable(),
  /** the user's Role name — this codebase has no distinct "designation"/job-title field */
  role: z.string().nullable(),
});

const LeaveTypeRefSchema = z.object({
  id: z.string().uuid(),
  nameEn: z.string(),
  nameAr: z.string(),
  isPaid: z.boolean(),
});

export const LeaveRequestSummarySchema = z.object({
  id: z.string().uuid(),
  employee: EmployeeRefSchema,
  leaveType: LeaveTypeRefSchema,
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  startHalfDay: z.boolean(),
  endHalfDay: z.boolean(),
  halfDayPeriod: LeaveHalfDayPeriodSchema.nullable(),
  daysCount: z.number(),
  reason: z.string().nullable(),
  status: LeaveRequestStatusSchema,
  createdAt: z.coerce.date(),
});
export type LeaveRequestSummary = z.infer<typeof LeaveRequestSummarySchema>;

/** One step in a request's approval history — built from the audit log, not stored directly. */
export const LeaveHistoryEntrySchema = z.object({
  action: z.string(),
  actorUserId: z.string().uuid().nullable(),
  actorName: z.string().nullable(),
  at: z.coerce.date(),
  note: z.string().nullable(),
});
export type LeaveHistoryEntry = z.infer<typeof LeaveHistoryEntrySchema>;

export const LeaveRequestDetailSchema = LeaveRequestSummarySchema.extend({
  branchId: z.string().uuid(),
  firstApproverId: z.string().uuid().nullable(),
  firstApprovedAt: z.coerce.date().nullable(),
  approverUserId: z.string().uuid().nullable(),
  approvedAt: z.coerce.date().nullable(),
  rejectionReason: z.string().nullable(),
  createdByUserId: z.string().uuid(),
  attachmentKey: z.string().nullable(),
  history: z.array(LeaveHistoryEntrySchema),
});
export type LeaveRequestDetail = z.infer<typeof LeaveRequestDetailSchema>;

/**
 * One leave type's balance for an employee in one year. `closingBalance`
 * is computed on read (opening + accrued + carriedForward - used) — never
 * stored — same convention as Gross/Net salary and payroll batch aggregates.
 */
export const LeaveBalanceSchema = z.object({
  leaveTypeId: z.string().uuid(),
  leaveTypeNameEn: z.string(),
  leaveTypeNameAr: z.string(),
  year: z.number().int(),
  openingBalance: z.number(),
  accrued: z.number(),
  used: z.number(),
  carriedForward: z.number(),
  closingBalance: z.number(),
});
export type LeaveBalance = z.infer<typeof LeaveBalanceSchema>;

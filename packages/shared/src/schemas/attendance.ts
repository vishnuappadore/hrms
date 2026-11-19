import { z } from "zod";
import { ATTENDANCE_DAY_STATUSES, ATTENDANCE_SOURCES } from "../enums";
import { PaginationQuerySchema } from "./common";

/**
 * Check-in/check-out capture. Self check-in/check-out take no body — the
 * server resolves the caller's own employee profile and stamps `now()`.
 * Everything below is for the Today/Monthly views and admin correction of
 * another employee's day.
 */

export const AttendanceDayStatusSchema = z.enum(ATTENDANCE_DAY_STATUSES);
export const AttendanceSourceSchema = z.enum(ATTENDANCE_SOURCES);

/** Fixed v1 grace period for "late" (docs/MODULES/attendance.md "Open questions"). */
export const ATTENDANCE_LATE_GRACE_MINUTES = 15;

export const AttendanceScopeSchema = z.enum(["today", "monthly"]);
export type AttendanceScope = z.infer<typeof AttendanceScopeSchema>;

export const ListAttendanceQuerySchema = PaginationQuerySchema.extend({
  scope: AttendanceScopeSchema,
  /** required when scope = today, format YYYY-MM-DD */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** required when scope = monthly, format YYYY-MM */
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
  branchId: z.string().uuid().optional(),
  search: z.string().max(100).optional(),
});
export type ListAttendanceQuery = z.infer<typeof ListAttendanceQuerySchema>;

/** `GET /attendance/kpis` — same filters as the list, no pagination. */
export const AttendanceKpisQuerySchema = ListAttendanceQuerySchema.omit({
  page: true,
  pageSize: true,
  sort: true,
});
export type AttendanceKpisQuery = z.infer<typeof AttendanceKpisQuerySchema>;

/**
 * Today scope: counts of employees currently in each state. Monthly scope:
 * totals summed across every employee's month (same field names, different
 * grain — the web layer picks the label per scope, e.g. "Present Today" vs
 * "Present Days").
 */
export const AttendanceKpisSchema = z.object({
  present: z.number().int(),
  late: z.number().int(),
  onLeave: z.number().int(),
  absent: z.number().int(),
  attendanceRatePct: z.number(),
});
export type AttendanceKpis = z.infer<typeof AttendanceKpisSchema>;

const EmployeeRefSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  branchName: z.string().nullable(),
});

/** One row of the Today or Monthly attendance table. */
export const AttendanceDaySummarySchema = z.object({
  employee: EmployeeRefSchema,
  date: z.coerce.date(),
  status: AttendanceDayStatusSchema,
  firstInAt: z.coerce.date().nullable(),
  lastOutAt: z.coerce.date().nullable(),
  totalWorkedMinutes: z.number().int(),
  sessionCount: z.number().int(),
});
export type AttendanceDaySummary = z.infer<typeof AttendanceDaySummarySchema>;

/** Aggregate rollup for an employee across a month (Monthly-view row / detail header). */
export const AttendanceMonthlyAggregateSchema = z.object({
  employee: EmployeeRefSchema,
  month: z.string(),
  presentDays: z.number().int(),
  lateDays: z.number().int(),
  leaveDays: z.number().int(),
  absentDays: z.number().int(),
  totalWorkedMinutes: z.number().int(),
  /** 0-100, present+late over working (non-weekly-off) days */
  attendanceRatePct: z.number(),
});
export type AttendanceMonthlyAggregate = z.infer<typeof AttendanceMonthlyAggregateSchema>;

export const AttendanceSessionSchema = z.object({
  id: z.string().uuid(),
  checkInAt: z.coerce.date(),
  checkOutAt: z.coerce.date().nullable(),
  source: AttendanceSourceSchema,
  /** minutes since the previous session's check-out on the same day; null for the first session */
  breakMinutesBefore: z.number().int().nullable(),
});
export type AttendanceSession = z.infer<typeof AttendanceSessionSchema>;

/**
 * `POST /attendance/check-in`, `POST /attendance/check-out`, and
 * `GET /attendance/me/today` all return this same shape — the self-service
 * "am I checked in right now" contract the Dashboard widget reads. Neither
 * mutation takes a body; the server resolves the caller's own staff profile.
 */
export const MyAttendanceTodaySchema = z.object({
  isCheckedIn: z.boolean(),
  firstInAt: z.coerce.date().nullable(),
  lastOutAt: z.coerce.date().nullable(),
  totalWorkedMinutes: z.number().int(),
  sessions: z.array(AttendanceSessionSchema),
});
export type MyAttendanceToday = z.infer<typeof MyAttendanceTodaySchema>;

/** Check-in/out log dialog (one employee, one day). */
export const AttendanceDayDetailSchema = z.object({
  employee: EmployeeRefSchema,
  date: z.coerce.date(),
  status: AttendanceDayStatusSchema,
  firstInAt: z.coerce.date().nullable(),
  lastOutAt: z.coerce.date().nullable(),
  totalWorkedMinutes: z.number().int(),
  isManualEntry: z.boolean(),
  editedByUserId: z.string().uuid().nullable(),
  editedAt: z.coerce.date().nullable(),
  sessions: z.array(AttendanceSessionSchema),
});
export type AttendanceDayDetail = z.infer<typeof AttendanceDayDetailSchema>;

/** Per-employee daily breakdown for a month. */
export const AttendanceMonthlyDayRowSchema = z.object({
  date: z.coerce.date(),
  status: AttendanceDayStatusSchema,
  firstInAt: z.coerce.date().nullable(),
  lastOutAt: z.coerce.date().nullable(),
  totalWorkedMinutes: z.number().int(),
  sessionCount: z.number().int(),
});
export type AttendanceMonthlyDayRow = z.infer<typeof AttendanceMonthlyDayRowSchema>;

export const AttendanceMonthlyDetailSchema = z.object({
  summary: AttendanceMonthlyAggregateSchema,
  days: z.array(AttendanceMonthlyDayRowSchema),
});
export type AttendanceMonthlyDetail = z.infer<typeof AttendanceMonthlyDetailSchema>;

/**
 * Stable internal strings for the four session-ordering rules below — never
 * shown to a user as-is. The web layer compares a zod issue's `message`
 * against these to pick a localized `attendance.sessionDialog.validation.*`
 * key (same "never display raw zod text" rule the rest of the app follows).
 */
export const SESSION_VALIDATION_MESSAGES = {
  checkInRequired: "Check-in is required",
  checkoutBeforeCheckin: "Check-out must be after check-in",
  openMustBeLast: "Only the most recent session can be left open",
  overlap: "Sessions on the same day must not overlap",
  futureCheckIn: "Check-in cannot be in the future",
  futureCheckOut: "Check-out cannot be in the future",
} as const;

/** One admin-entered correction/manual session, used in the full-replace edit below. */
const ManualSessionInputSchema = z.object({
  checkInAt: z.coerce.date({ required_error: SESSION_VALIDATION_MESSAGES.checkInRequired }),
  checkOutAt: z.coerce.date().nullable(),
});

function assertSessionOrdering(v: { checkInAt: Date; checkOutAt: Date | null }[], ctx: z.RefinementCtx): void {
  // This is a correction tool for past activity, so no instant after "now" is ever valid — no
  // tolerance window (unlike self check-in/out, this always takes a client-supplied timestamp).
  const now = new Date();
  v.forEach((session, i) => {
    if (session.checkInAt > now) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sessions", i, "checkInAt"],
        message: SESSION_VALIDATION_MESSAGES.futureCheckIn,
      });
    }
    if (session.checkOutAt && session.checkOutAt > now) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sessions", i, "checkOutAt"],
        message: SESSION_VALIDATION_MESSAGES.futureCheckOut,
      });
    }
  });

  const indexed = v.map((session, originalIndex) => ({ ...session, originalIndex }));
  const sorted = [...indexed].sort((a, b) => a.checkInAt.getTime() - b.checkInAt.getTime());
  sorted.forEach((session, i) => {
    const isLast = i === sorted.length - 1;
    if (session.checkOutAt && session.checkOutAt <= session.checkInAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sessions", session.originalIndex, "checkOutAt"],
        message: SESSION_VALIDATION_MESSAGES.checkoutBeforeCheckin,
      });
    }
    if (!session.checkOutAt && !isLast) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sessions", session.originalIndex, "checkOutAt"],
        message: SESSION_VALIDATION_MESSAGES.openMustBeLast,
      });
    }
    const previous = sorted[i - 1];
    if (previous?.checkOutAt && session.checkInAt < previous.checkOutAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sessions", session.originalIndex, "checkInAt"],
        message: SESSION_VALIDATION_MESSAGES.overlap,
      });
    }
  });
}

/**
 * `PATCH /attendance/:employeeProfileId/days/:date` body — full-replace of
 * that day's sessions (same convention as `SavePayrollComponentsSchema`),
 * gated on `attendance.edit`. Sets `isManualEntry` and stamps
 * `editedByUserId`/`editedAt` on the recomputed day.
 */
export const UpdateAttendanceDaySchema = z.object({
  sessions: z.array(ManualSessionInputSchema).max(50),
}).superRefine((v, ctx) => assertSessionOrdering(v.sessions, ctx));
export type UpdateAttendanceDayInput = z.infer<typeof UpdateAttendanceDaySchema>;

export const LOCALES = ["en", "ar"] as const;
export type Locale = (typeof LOCALES)[number];

export const ENTITY_STATUSES = ["active", "inactive"] as const;
export type EntityStatus = (typeof ENTITY_STATUSES)[number];

export const EMPLOYMENT_TYPES = ["full_time", "part_time", "contract"] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

/**
 * Employee availability, distinct from a User's login-only account `status`
 * (active|inactive).
 */
export const EMPLOYEE_STATUSES = ["active", "on_leave", "inactive"] as const;
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];

/**
 * Attendance day status. `weekly_off` is derived from the branch's
 * `workingHours.weeklyOffDays`; `on_leave` is forced by an approved
 * LeaveRequest overlapping the date, regardless of session data. `holiday`
 * is reserved for a future holiday-calendar module — not produced anywhere
 * yet. `pending` is synthesized only (never persisted) for a date that
 * hasn't finished yet — today with no session so far, or a future date in a
 * Monthly calendar — so it's never counted as absent before the day is
 * actually over.
 */
export const ATTENDANCE_DAY_STATUSES = [
  "present",
  "late",
  "absent",
  "on_leave",
  "weekly_off",
  "holiday",
  "pending",
] as const;
export type AttendanceDayStatus = (typeof ATTENDANCE_DAY_STATUSES)[number];

/** Provenance of one check-in/check-out punch pair. */
export const ATTENDANCE_SOURCES = ["self", "manual"] as const;
export type AttendanceSource = (typeof ATTENDANCE_SOURCES)[number];

/** Whether a leave type's day-count spans every calendar day or skips the branch's weekly-off days. */
export const LEAVE_COUNT_MODES = ["all_days", "skip_weekly_off"] as const;
export type LeaveCountMode = (typeof LEAVE_COUNT_MODES)[number];

/**
 * When a leave type's balance is credited. `monthly` is kept for backward
 * compatibility with any row already using it, but is no longer offered as a
 * choice in the Leave Settings dialog — superseded by the more precise
 * `beginning_of_month`/`end_of_month`.
 */
export const LEAVE_CREDIT_POLICIES = [
  "beginning_of_year",
  "monthly",
  "beginning_of_month",
  "end_of_month",
  "anniversary",
] as const;
export type LeaveCreditPolicy = (typeof LEAVE_CREDIT_POLICIES)[number];

/**
 * Leave request lifecycle. `pending_second_approval` is only reachable when
 * the leave type's `requiresSecondApproval` is on — for single-step types
 * the request goes `pending -> approved` directly.
 */
export const LEAVE_REQUEST_STATUSES = [
  "pending",
  "pending_second_approval",
  "approved",
  "rejected",
  "cancelled",
] as const;
export type LeaveRequestStatus = (typeof LEAVE_REQUEST_STATUSES)[number];

/** Which tab a leave request status belongs to on the /leave approval console. */
export const LEAVE_TABS = ["pending", "approved", "rejected", "cancelled"] as const;
export type LeaveTab = (typeof LEAVE_TABS)[number];
export const LEAVE_TAB_STATUSES: Record<LeaveTab, readonly LeaveRequestStatus[]> = {
  pending: ["pending", "pending_second_approval"],
  approved: ["approved"],
  rejected: ["rejected"],
  cancelled: ["cancelled"],
};

/**
 * Only meaningful for a single-day request (startDate === endDate) — a date range has no
 * "other side" to imply which half, so it picks explicitly; a range's boundary half-days use
 * the separate startHalfDay/endHalfDay flags instead (packages/shared/src/schemas/leave.ts).
 */
export const LEAVE_HALF_DAY_PERIODS = ["first_half", "second_half"] as const;
export type LeaveHalfDayPeriod = (typeof LEAVE_HALF_DAY_PERIODS)[number];

/** Payroll item lifecycle. Commission is deliberately absent (no commission source module). */
export const PAYROLL_ITEM_STATUSES = ["pending", "approved", "rejected", "paid"] as const;
export type PayrollItemStatus = (typeof PAYROLL_ITEM_STATUSES)[number];

/** Allowed payroll item status transitions (state machine). Paid is terminal. */
export const PAYROLL_ITEM_TRANSITIONS: Record<PayrollItemStatus, readonly PayrollItemStatus[]> = {
  pending: ["approved", "rejected"],
  approved: ["pending", "paid", "rejected"],
  rejected: ["pending"],
  paid: [],
};

/** Which tab a status belongs to — Paid renders inside the Approved tab (no separate Paid tab). */
export const PAYROLL_TABS = ["pending", "approved", "rejected"] as const;
export type PayrollTab = (typeof PAYROLL_TABS)[number];
export const PAYROLL_TAB_STATUSES: Record<PayrollTab, readonly PayrollItemStatus[]> = {
  pending: ["pending"],
  approved: ["approved", "paid"],
  rejected: ["rejected"],
};

/** One row per approve/reject action (individual or bulk) — powers the Batch view. */
export const PAYROLL_BATCH_ACTIONS = ["approve", "reject"] as const;
export type PayrollBatchAction = (typeof PAYROLL_BATCH_ACTIONS)[number];

/** Ad-hoc payslip line items added during edit (bonus/overtime vs. advance/fine). */
export const PAYROLL_ADJUSTMENT_TYPES = ["addition", "deduction"] as const;
export type PayrollAdjustmentType = (typeof PAYROLL_ADJUSTMENT_TYPES)[number];

/**
 * Stable error codes returned by the API as `{ code }`.
 * The web app maps these to localized messages — never match on `message`.
 */
export const ERROR_CODES = {
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  ACCOUNT_INACTIVE: "ACCOUNT_INACTIVE",
  TOKEN_EXPIRED: "TOKEN_EXPIRED",
  TOKEN_INVALID: "TOKEN_INVALID",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  BRANCH_ACCESS_DENIED: "BRANCH_ACCESS_DENIED",
  EMAIL_EXISTS: "EMAIL_EXISTS",
  USERNAME_EXISTS: "USERNAME_EXISTS",
  NAME_EXISTS: "NAME_EXISTS",
  CANNOT_MODIFY_SELF: "CANNOT_MODIFY_SELF",
  VALIDATION_FAILED: "VALIDATION_FAILED",
  NOT_FOUND: "NOT_FOUND",
  IDEMPOTENT_REPLAY: "IDEMPOTENT_REPLAY",
  INVALID_STATUS_TRANSITION: "INVALID_STATUS_TRANSITION",
  PAYROLL_RUN_EXISTS: "PAYROLL_RUN_EXISTS",
  PAYROLL_ITEM_LOCKED: "PAYROLL_ITEM_LOCKED",
  PAYROLL_ITEM_NOT_PENDING: "PAYROLL_ITEM_NOT_PENDING",
  PAYROLL_INVALID_TRANSITION: "PAYROLL_INVALID_TRANSITION",
  PAYROLL_NO_ELIGIBLE_STAFF: "PAYROLL_NO_ELIGIBLE_STAFF",
  ATTENDANCE_ALREADY_CHECKED_IN: "ATTENDANCE_ALREADY_CHECKED_IN",
  ATTENDANCE_NOT_CHECKED_IN: "ATTENDANCE_NOT_CHECKED_IN",
  ATTENDANCE_NO_STAFF_PROFILE: "ATTENDANCE_NO_STAFF_PROFILE",
  LEAVE_MINIMUM_NOTICE_NOT_MET: "LEAVE_MINIMUM_NOTICE_NOT_MET",
  LEAVE_HALF_DAY_NOT_ALLOWED: "LEAVE_HALF_DAY_NOT_ALLOWED",
  LEAVE_SUPPORTING_DOCUMENT_REQUIRED: "LEAVE_SUPPORTING_DOCUMENT_REQUIRED",
  LEAVE_INSUFFICIENT_BALANCE: "LEAVE_INSUFFICIENT_BALANCE",
  LEAVE_REQUEST_NOT_PENDING: "LEAVE_REQUEST_NOT_PENDING",
  LEAVE_REQUEST_NOT_APPROVED: "LEAVE_REQUEST_NOT_APPROVED",
  LEAVE_DATE_CONFLICT: "LEAVE_DATE_CONFLICT",
  ROLE_IN_USE: "ROLE_IN_USE",
  ROLE_PROTECTED: "ROLE_PROTECTED",
} as const;
export type ErrorCode = keyof typeof ERROR_CODES;

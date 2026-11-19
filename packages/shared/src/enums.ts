export const LOCALES = ["en", "ar"] as const;
export type Locale = (typeof LOCALES)[number];

export const BRANCH_TYPES = ["corporate", "franchise"] as const;
export type BranchType = (typeof BRANCH_TYPES)[number];

export const ENTITY_STATUSES = ["active", "inactive"] as const;
export type EntityStatus = (typeof ENTITY_STATUSES)[number];

/**
 * Appointment lifecycle — the 5-status model per the 2026 client requirement
 * doc (docs/MODULES/appointments.md). `waiting` is the initial pre-service
 * state (was "booked"); `checked_in` and `no_show` from the prior model were
 * dropped. `completed` hands off to POS/Checkout.
 */
export const APPOINTMENT_STATUSES = [
  "waiting",
  "confirmed",
  "in_progress",
  "completed",
  "cancelled",
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

/** Allowed appointment status transitions (state machine). */
export const APPOINTMENT_TRANSITIONS: Record<AppointmentStatus, readonly AppointmentStatus[]> = {
  waiting: ["confirmed", "in_progress", "cancelled"],
  confirmed: ["in_progress", "cancelled"],
  in_progress: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

/**
 * Walk-in Queue lifecycle (docs/MODULES/pos.md Part B). Unlike Appointments,
 * Cancel is only reachable from `waiting` (the req's Waiting-only Cancel
 * action); `completed` is reached either via the direct Complete action or via
 * a successful POS checkout (entry point 3 — see pos.ts's `walkInId`).
 */
export const WALKIN_STATUSES = ["waiting", "serving", "completed", "cancelled"] as const;
export type WalkInStatus = (typeof WALKIN_STATUSES)[number];

/** Allowed walk-in queue status transitions (state machine). */
export const WALKIN_TRANSITIONS: Record<WalkInStatus, readonly WalkInStatus[]> = {
  waiting: ["serving", "cancelled"],
  serving: ["completed"],
  completed: [],
  cancelled: [],
};

export const PAYMENT_METHODS = ["cash", "card", "mada", "bank_transfer", "ewallet"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const INVOICE_STATUSES = ["paid", "partially_paid", "void"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/**
 * POS invoice line kinds. `package` and `membership` are defined for forward
 * compatibility (2026 req, deferred); the Core Checkout slice sells `service`
 * and `product` only. Only `product` lines deduct inventory.
 */
export const INVOICE_ITEM_TYPES = ["service", "product", "package", "membership"] as const;
export type InvoiceItemType = (typeof INVOICE_ITEM_TYPES)[number];

/** Unified finance ledger direction + category (minimal set; grows per module). */
export const FINANCE_DIRECTIONS = ["in", "out"] as const;
export type FinanceDirection = (typeof FINANCE_DIRECTIONS)[number];

export const FINANCE_CATEGORIES = ["sale_revenue", "refund", "payroll_expense"] as const;
export type FinanceCategory = (typeof FINANCE_CATEGORIES)[number];

export const LOYALTY_TIERS = ["bronze", "silver", "gold", "platinum"] as const;
export type LoyaltyTier = (typeof LOYALTY_TIERS)[number];

/**
 * Customer-facing loyalty tier ladder. Adds `new` (the default on registration)
 * ahead of the earn-based tiers. Distinct from LOYALTY_TIERS (which the Loyalty
 * module's earn/redeem mechanics use) — unify when the Loyalty module lands.
 */
export const CUSTOMER_TIERS = ["new", "bronze", "silver", "gold", "platinum"] as const;
export type CustomerTier = (typeof CUSTOMER_TIERS)[number];

export const LOYALTY_TRANSACTION_TYPES = ["earn", "redeem", "expire", "adjust"] as const;
export type LoyaltyTransactionType = (typeof LOYALTY_TRANSACTION_TYPES)[number];

export const EMPLOYMENT_TYPES = ["full_time", "part_time", "contract"] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

/**
 * Staff availability, distinct from a User's login-only account `status`
 * (active|inactive) — see docs/MODULES/staff.md.
 */
export const STAFF_STATUSES = ["active", "on_leave", "inactive"] as const;
export type StaffStatus = (typeof STAFF_STATUSES)[number];

export const STOCK_MOVEMENT_TYPES = [
  "sale",
  "consumption",
  "grn_receipt",
  "transfer_out",
  "transfer_in",
  "adjustment",
  "return",
] as const;
export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];

export const NOTIFICATION_CHANNELS = ["sms", "email", "whatsapp"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/**
 * Attendance day status (docs/MODULES/attendance.md). `weekly_off` is derived
 * from the branch's `workingHours.weeklyOffDays`; `on_leave` is forced by an
 * approved LeaveRequest overlapping the date, regardless of session data.
 * `holiday` is reserved for a future holiday-calendar module — not produced
 * anywhere yet. `pending` is synthesized only (never persisted) for a date
 * that hasn't finished yet — today with no session so far, or a future date
 * in a Monthly calendar — so it's never counted as absent before the day is
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
 * Leave request lifecycle (docs/MODULES/leave.md). `pending_second_approval`
 * is only reachable when the leave type's `requiresSecondApproval` is on —
 * for single-step types the request goes `pending -> approved` directly.
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

/**
 * Payroll item lifecycle. v1 scope (docs/MODULES/payroll.md): Commission is
 * still deliberately absent — commission_records (POS) doesn't exist yet.
 * Absence Deduction and unpaid-leave proration have landed (Attendance/Leave).
 */
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
  CUSTOMER_MOBILE_EXISTS: "CUSTOMER_MOBILE_EXISTS",
  CUSTOMER_EMAIL_EXISTS: "CUSTOMER_EMAIL_EXISTS",
  EMAIL_EXISTS: "EMAIL_EXISTS",
  USERNAME_EXISTS: "USERNAME_EXISTS",
  NAME_EXISTS: "NAME_EXISTS",
  CANNOT_MODIFY_SELF: "CANNOT_MODIFY_SELF",
  VALIDATION_FAILED: "VALIDATION_FAILED",
  NOT_FOUND: "NOT_FOUND",
  IDEMPOTENT_REPLAY: "IDEMPOTENT_REPLAY",
  INVALID_STATUS_TRANSITION: "INVALID_STATUS_TRANSITION",
  WALKIN_NOT_EDITABLE: "WALKIN_NOT_EDITABLE",
  APPOINTMENT_NOT_EDITABLE: "APPOINTMENT_NOT_EDITABLE",
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
  TENANT_CURRENCY_LOCKED: "TENANT_CURRENCY_LOCKED",
} as const;
export type ErrorCode = keyof typeof ERROR_CODES;

import { z } from "zod";
import { LEAVE_COUNT_MODES, LEAVE_CREDIT_POLICIES } from "../enums";
import { PaginationQuerySchema } from "./common";

/**
 * Settings > Leave Settings catalog (docs/MODULES/leave-settings.md).
 * [leave](./leave.ts) requests/balances reference a LeaveType by id — this
 * is the tenant-configured catalog they draw from, same "catalog vs.
 * instance" split as PayrollComponent/StaffPayrollComponent.
 */

export const LeaveCountModeSchema = z.enum(LEAVE_COUNT_MODES);
export const LeaveCreditPolicySchema = z.enum(LEAVE_CREDIT_POLICIES);

const LeaveTypeFieldsSchema = z.object({
  nameEn: z.string().min(1).max(100),
  nameAr: z.string().min(1).max(100),
  isPaid: z.boolean().default(true),
  /** supports half-day-year policies (e.g. 2.5 days/yr) */
  daysPerYear: z.number().min(0).max(365),
  countMode: LeaveCountModeSchema.default("skip_weekly_off"),
  isEncashable: z.boolean().default(false),
  creditPolicy: LeaveCreditPolicySchema.default("beginning_of_year"),
  minimumNoticeDays: z.number().int().min(0).max(365).default(0),
  maxCarryForwardDays: z.number().int().min(0).max(365).default(0),
  allowCarryForward: z.boolean().default(false),
  allowHalfDay: z.boolean().default(false),
  requireSupportingDocument: z.boolean().default(false),
  allowNegativeBalance: z.boolean().default(false),
  /**
   * Not in the design mockup's leave-type card — added per the "configurable
   * per leave type" approval-levels decision (docs/MODULES/leave.md
   * "Additions beyond the literal screenshots"). When on, a request must
   * clear a second approver after the first before it's Approved.
   */
  requiresSecondApproval: z.boolean().default(false),
});

function assertCarryForwardShape(
  v: { allowCarryForward: boolean; maxCarryForwardDays: number },
  ctx: z.RefinementCtx,
): void {
  if (!v.allowCarryForward && v.maxCarryForwardDays > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["maxCarryForwardDays"],
      message: "Only meaningful when carry-forward is allowed",
    });
  }
}

export const CreateLeaveTypeSchema = LeaveTypeFieldsSchema.superRefine(assertCarryForwardShape);
export type CreateLeaveTypeInput = z.infer<typeof CreateLeaveTypeSchema>;

export const UpdateLeaveTypeSchema = LeaveTypeFieldsSchema.partial()
  .extend({ isActive: z.boolean().optional() })
  .superRefine((v, ctx) => assertCarryForwardShape({ allowCarryForward: true, maxCarryForwardDays: 0, ...v }, ctx));
export type UpdateLeaveTypeInput = z.infer<typeof UpdateLeaveTypeSchema>;

export const ListLeaveTypesQuerySchema = PaginationQuerySchema.extend({
  // A query string is always a literal "true"/"false" — z.coerce.boolean()
  // would coerce the string "false" to `true` (any non-empty string is
  // truthy), so this maps the two literal strings explicitly instead.
  includeInactive: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
});
export type ListLeaveTypesQuery = z.infer<typeof ListLeaveTypesQuerySchema>;

export const LeaveTypeSchema = LeaveTypeFieldsSchema.extend({
  id: z.string().uuid(),
  isActive: z.boolean(),
  sortOrder: z.number().int(),
});
export type LeaveType = z.infer<typeof LeaveTypeSchema>;

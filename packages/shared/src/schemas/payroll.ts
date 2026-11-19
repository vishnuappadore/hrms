import { z } from "zod";
import {
  PAYROLL_ADJUSTMENT_TYPES,
  PAYROLL_BATCH_ACTIONS,
  PAYROLL_ITEM_STATUSES,
  PAYROLL_TABS,
} from "../enums";
import { PaginationQuerySchema } from "./common";
import { PayrollComponentCategorySchema } from "./employee";

/**
 * Payroll scope: Commission is deliberately absent from every schema below
 * (no commission source module exists). Absence Deduction and Leave
 * Deduction (unpaid leave) are both separate, Gross-based deduction lines;
 * `paidDays` reflects only Date of Join. See `absenceDeductionMinor`/
 * `absentDays`, `leaveDeductionMinor`/`unpaidLeaveDays`, and `paidDays` below.
 */

export const PayrollMonthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Expected YYYY-MM");
export type PayrollMonth = z.infer<typeof PayrollMonthSchema>;

export const PayrollItemStatusSchema = z.enum(PAYROLL_ITEM_STATUSES);
export const PayrollTabSchema = z.enum(PAYROLL_TABS);
export const PayrollBatchActionSchema = z.enum(PAYROLL_BATCH_ACTIONS);
export const PayrollAdjustmentTypeSchema = z.enum(PAYROLL_ADJUSTMENT_TYPES);

/* ── Runs ────────────────────────────────────────────────────────────────── */

/** `POST /payroll/runs` body — idempotent: returns the existing run if one exists. */
export const GeneratePayrollRunSchema = z.object({
  branchId: z.string().uuid(),
  payrollMonth: PayrollMonthSchema,
});
export type GeneratePayrollRunInput = z.infer<typeof GeneratePayrollRunSchema>;

/** `GET /payroll/runs` query — look up without generating. */
export const GetPayrollRunQuerySchema = z.object({
  branchId: z.string().uuid(),
  payrollMonth: PayrollMonthSchema,
});
export type GetPayrollRunQuery = z.infer<typeof GetPayrollRunQuerySchema>;

export const PayrollRunSchema = z.object({
  id: z.string().uuid(),
  branchId: z.string().uuid(),
  payrollMonth: PayrollMonthSchema,
  currency: z.string(),
  generatedBy: z.string().uuid(),
  generatedAt: z.coerce.date(),
});
export type PayrollRun = z.infer<typeof PayrollRunSchema>;

/**
 * `GET /payroll/runs/preview` response — lets the web app show a confirm
 * dialog with real counts before calling `POST /payroll/runs`. Counts follow
 * the same "existing items are never recounted/touched" rule as generation
 * itself: `totalEmployeeCount` is `existingEmployeeCount + newEmployeeCount`,
 * not a fresh eligibility recount (an item already in the run stays counted
 * even if that employee is no longer eligible today).
 */
export const PayrollRunPreviewSchema = z.object({
  runExists: z.boolean(),
  existingEmployeeCount: z.number().int(),
  newEmployeeCount: z.number().int(),
  totalEmployeeCount: z.number().int(),
  statusCounts: z.object({
    pending: z.number().int(),
    approved: z.number().int(),
    rejected: z.number().int(),
    paid: z.number().int(),
  }),
});
export type PayrollRunPreview = z.infer<typeof PayrollRunPreviewSchema>;

/* ── Payslip breakdown rows ──────────────────────────────────────────────── */

/** Read-only snapshot of an employee's configured allowance/deduction components. */
export const PayrollItemComponentSchema = z.object({
  category: PayrollComponentCategorySchema,
  nameEn: z.string(),
  nameAr: z.string(),
  amountMinor: z.number().int(),
});
export type PayrollItemComponentOutput = z.infer<typeof PayrollItemComponentSchema>;

/** Ad-hoc payslip row (bonus/overtime on the earnings side, advance/fine on the deductions side). */
export const PayrollAdjustmentInputSchema = z.object({
  labelEn: z.string().min(1).max(100),
  labelAr: z.string().max(100).nullable().optional(),
  amountMinor: z.number().int().min(0),
});
export type PayrollAdjustmentInput = z.infer<typeof PayrollAdjustmentInputSchema>;

export const PayrollAdjustmentSchema = PayrollAdjustmentInputSchema.extend({
  id: z.string().uuid(),
  type: PayrollAdjustmentTypeSchema,
});
export type PayrollAdjustmentOutput = z.infer<typeof PayrollAdjustmentSchema>;

/* ── Items (payroll listing rows + payslip detail) ──────────────────────── */

const PayrollEmployeeSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  role: z.string().nullable(),
  joiningDate: z.coerce.date().nullable(),
  branchNameEn: z.string(),
  branchNameAr: z.string(),
});

export const PayrollItemSummarySchema = z.object({
  id: z.string().uuid(),
  employee: PayrollEmployeeSummarySchema,
  currency: z.string(),
  baseSalaryMinor: z.number().int(),
  allowancesTotalMinor: z.number().int(),
  statutoryDeductionsTotalMinor: z.number().int(),
  otherDeductionMinor: z.number().int(),
  /** Gross-based (full base + full allowances) × Attendance's genuine `absent` day count — see payroll.md. */
  absenceDeductionMinor: z.number().int(),
  /** Day count backing absenceDeductionMinor — informational only, not itself editable. */
  absentDays: z.number(),
  /** Gross-based (full base + full allowances) × approved UNPAID-leave-type days in the month —
   * a separate deduction line rather than a reduction to paidDays, so Base Salary/Allowances stay
   * whole. See payroll.md. */
  leaveDeductionMinor: z.number().int(),
  /** Day count backing leaveDeductionMinor — informational only, not itself editable. */
  unpaidLeaveDays: z.number(),
  additionsTotalMinor: z.number().int(),
  extraDeductionsTotalMinor: z.number().int(),
  netPayMinor: z.number().int(),
  status: PayrollItemStatusSchema,
  batchNo: z.number().int().nullable(),
  /**
   * Days this item was actually paid for in `totalDaysInMonth` days — purely the employee's
   * Date of Join (packages/shared/src/money.ts `paidDaysForJoin`). Equal to `totalDaysInMonth` for
   * the common case (joined before this month). Unpaid leave does NOT reduce this — it's its own
   * deduction line (leaveDeductionMinor) instead. Frozen at generation time like every other
   * snapshotted figure on this item.
   */
  paidDays: z.number(),
  totalDaysInMonth: z.number().int(),
});
export type PayrollItemSummary = z.infer<typeof PayrollItemSummarySchema>;

export const PayrollItemDetailSchema = PayrollItemSummarySchema.extend({
  payrollRunId: z.string().uuid(),
  branchId: z.string().uuid(),
  payrollMonth: PayrollMonthSchema,
  allowanceComponents: z.array(PayrollItemComponentSchema),
  statutoryDeductionComponents: z.array(PayrollItemComponentSchema),
  additions: z.array(PayrollAdjustmentSchema),
  extraDeductions: z.array(PayrollAdjustmentSchema),
  approvedAt: z.coerce.date().nullable(),
  rejectedAt: z.coerce.date().nullable(),
  rejectionReason: z.string().nullable(),
  paidAt: z.coerce.date().nullable(),
});
export type PayrollItemDetail = z.infer<typeof PayrollItemDetailSchema>;

export const ListPayrollItemsQuerySchema = PaginationQuerySchema.extend({
  tab: PayrollTabSchema,
});
export type ListPayrollItemsQuery = z.infer<typeof ListPayrollItemsQuerySchema>;

/* ── Batches (Batch view for the Approved/Rejected tabs) ────────────────── */

/**
 * Lightweight batch menu entry — no nested items. Powers the left-side batch
 * menu in the redesigned Batch view; item fetching for one selected batch is
 * a separate paginated endpoint (`ListPayrollBatchItemsQuerySchema` below).
 */
export const PayrollBatchSchema = z.object({
  id: z.string().uuid(),
  batchNo: z.number().int(),
  action: PayrollBatchActionSchema,
  performedBy: z.string().uuid(),
  performedAt: z.coerce.date(),
  count: z.number().int(),
  totalNetMinor: z.number().int(),
});
export type PayrollBatch = z.infer<typeof PayrollBatchSchema>;

export const ListPayrollBatchesQuerySchema = z.object({
  tab: z.enum(["approved", "rejected"]),
});
export type ListPayrollBatchesQuery = z.infer<typeof ListPayrollBatchesQuerySchema>;

/** `GET /payroll/runs/:runId/batches/:batchId/items` query — paginated items for one batch. */
export const ListPayrollBatchItemsQuerySchema = PaginationQuerySchema;
export type ListPayrollBatchItemsQuery = z.infer<typeof ListPayrollBatchItemsQuerySchema>;

/* ── Edit (allowances/deductions overrides + ad-hoc rows, pre-approval only) ── */

/**
 * `PATCH /payroll/items/:itemId` body. Follows the same full-replace
 * convention as `SavePayrollComponentsSchema`: `additions`/`extraDeductions`
 * replace the item's full ad-hoc row set for that side.
 */
export const EditPayrollItemSchema = z.object({
  allowancesTotalMinor: z.number().int().min(0).optional(),
  statutoryDeductionsTotalMinor: z.number().int().min(0).optional(),
  otherDeductionMinor: z.number().int().min(0).optional(),
  /** Override for the system-computed absence deduction (e.g. an approved late excuse). */
  absenceDeductionMinor: z.number().int().min(0).optional(),
  /** Override for the system-computed unpaid-leave deduction. */
  leaveDeductionMinor: z.number().int().min(0).optional(),
  additions: z.array(PayrollAdjustmentInputSchema).max(20).optional(),
  extraDeductions: z.array(PayrollAdjustmentInputSchema).max(20).optional(),
});
export type EditPayrollItemInput = z.infer<typeof EditPayrollItemSchema>;

/* ── Actions ─────────────────────────────────────────────────────────────── */

export const RejectPayrollItemSchema = z.object({
  reason: z.string().max(500).optional(),
});
export type RejectPayrollItemInput = z.infer<typeof RejectPayrollItemSchema>;

/**
 * Bulk action body — exactly one of `itemIds` (explicit page-scoped selection)
 * or `selectAll` (resolved server-side at execution time, so it always
 * reflects the current state, not a stale snapshot from when the user clicked
 * "select all"). `selectAll.tab` scopes to that tab's displayed statuses
 * intersected with the action's valid source statuses (see
 * `sourceStatusesForTab` in payroll.service.ts) — this is what keeps, e.g., a
 * "select all" Mark Paid from the Approved tab from sweeping in already-Paid
 * rows, since the Approved tab also displays Paid items.
 */
export const BulkPayrollActionSchema = z
  .object({
    itemIds: z.array(z.string().uuid()).max(500).optional(),
    selectAll: z
      .object({
        tab: PayrollTabSchema,
        batchId: z.string().uuid().optional(),
        excludeIds: z.array(z.string().uuid()).max(500).default([]),
      })
      .optional(),
    reason: z.string().max(500).optional(),
  })
  .refine((d) => Boolean(d.itemIds?.length) !== Boolean(d.selectAll), {
    message: "Provide exactly one of itemIds or selectAll",
  });
export type BulkPayrollActionInput = z.infer<typeof BulkPayrollActionSchema>;

import { z } from "zod";
import { EMPLOYEE_STATUSES, EMPLOYMENT_TYPES } from "../enums";
import { MobileSchema } from "./common";
import { assertBranchAssignment, CreateUserSchema, UserSchema } from "./user";

/* ── Enums ───────────────────────────────────────────────────────────────── */

export const GenderSchema = z.enum(["male", "female"]);
export type Gender = z.infer<typeof GenderSchema>;

/** Employee availability, distinct from the login-only account `status` on User. */
export const EmployeeStatusSchema = z.enum(EMPLOYEE_STATUSES);

export const EmploymentTypeSchema = z.enum(EMPLOYMENT_TYPES);

export const PayrollComponentCategorySchema = z.enum(["allowance", "deduction"]);
export type PayrollComponentCategory = z.infer<typeof PayrollComponentCategorySchema>;

export const PayrollComponentBasisSchema = z.enum(["fixed_amount", "percentage_of_base"]);
export type PayrollComponentBasis = z.infer<typeof PayrollComponentBasisSchema>;

/* ── Payroll components (Settings > Payroll Components catalog) ───────────── */

const PayrollComponentFieldsSchema = z.object({
  nameEn: z.string().min(1).max(100),
  nameAr: z.string().min(1).max(100),
  basis: PayrollComponentBasisSchema,
  /** integer minor units in AED; required iff basis = fixed_amount */
  defaultAmountMinor: z.number().int().min(0).nullable().optional(),
  /** percent of base salary; required iff basis = percentage_of_base */
  defaultRatePct: z.number().min(0).max(100).nullable().optional(),
});

function assertBasisShape(
  v: { basis: PayrollComponentBasis; defaultAmountMinor?: number | null; defaultRatePct?: number | null },
  ctx: z.RefinementCtx,
): void {
  if (v.basis === "fixed_amount" && v.defaultAmountMinor == null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["defaultAmountMinor"],
      message: "Required when basis is a fixed amount",
    });
  }
  if (v.basis === "percentage_of_base" && v.defaultRatePct == null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["defaultRatePct"],
      message: "Required when basis is a percentage of base salary",
    });
  }
}

/** One row of a Settings > Payroll Components bulk save — no `id` means a new row. */
export const PayrollComponentListItemSchema = PayrollComponentFieldsSchema.extend({
  id: z.string().uuid().optional(),
}).superRefine(assertBasisShape);
export type PayrollComponentListItemInput = z.infer<typeof PayrollComponentListItemSchema>;

/** `PUT /payroll-components?category=` body — replaces the full active set for that category. */
export const SavePayrollComponentsSchema = z.object({
  items: z.array(PayrollComponentListItemSchema).max(200),
});
export type SavePayrollComponentsInput = z.infer<typeof SavePayrollComponentsSchema>;

export const ListPayrollComponentsQuerySchema = z.object({
  category: PayrollComponentCategorySchema.optional(),
});
export type ListPayrollComponentsQuery = z.infer<typeof ListPayrollComponentsQuerySchema>;

export const PayrollComponentSchema = PayrollComponentFieldsSchema.extend({
  id: z.string().uuid(),
  category: PayrollComponentCategorySchema,
  isActive: z.boolean(),
  sortOrder: z.number().int(),
});
export type PayrollComponent = z.infer<typeof PayrollComponentSchema>;

/* ── Employee salary — allowance/deduction rows selected on an employee profile ──── */

export const EmployeePayrollComponentInputSchema = z.object({
  payrollComponentId: z.string().uuid(),
  amountMinor: z.number().int().min(0),
});
export type EmployeePayrollComponentInput = z.infer<typeof EmployeePayrollComponentInputSchema>;

export const EmployeePayrollComponentSchema = z.object({
  payrollComponentId: z.string().uuid(),
  nameEn: z.string(),
  nameAr: z.string(),
  amountMinor: z.number().int(),
});
export type EmployeePayrollComponentOutput = z.infer<typeof EmployeePayrollComponentSchema>;

/* ── Employee (extends the User/System-Access schema with profile + salary) ──── */

const EmployeeProfileFieldsSchema = z.object({
  mobile: MobileSchema,
  gender: GenderSchema,
  employeeStatus: EmployeeStatusSchema.default("active"),
  primaryBranchId: z.string().uuid(),
  employmentType: EmploymentTypeSchema,
  joiningDate: z.coerce.date().nullable().optional(),
  /** another employee this person reports to; must not be self (service-checked) */
  reportingManagerId: z.string().uuid().nullable().optional(),
  /** integer minor units of AED (packages/shared/src/money.ts) */
  baseSalaryMinor: z.number().int().min(0).default(0),
  commissionEnabled: z.boolean().default(false),
  commissionRatePct: z.number().min(0).max(100).nullable().optional(),
  allowances: z.array(EmployeePayrollComponentInputSchema).max(50).default([]),
  deductions: z.array(EmployeePayrollComponentInputSchema).max(50).default([]),
});

/** Exported so the web wizard's client-side schema can apply the same rule. */
export function assertCommissionRate(
  v: { commissionEnabled: boolean; commissionRatePct?: number | null },
  ctx: z.RefinementCtx,
): void {
  if (v.commissionEnabled && v.commissionRatePct == null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["commissionRatePct"],
      message: "Required when commission is enabled",
    });
  }
}

/**
 * The primary (payroll) branch is a distinct concept from System Access's
 * Assigned Branches, but must always be one of them — it can't be deselected
 * there. Exported so the web wizard's client-side schema applies the same rule.
 */
export function assertPrimaryBranchAssigned(
  v: { primaryBranchId?: string | null; allBranches: boolean; branchIds: string[] },
  ctx: z.RefinementCtx,
): void {
  if (!v.allBranches && v.primaryBranchId && !v.branchIds.includes(v.primaryBranchId)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["branchIds"],
      message: "Primary branch must be included in assigned branches",
    });
  }
}

export const CreateEmployeeSchema = CreateUserSchema.innerType()
  .extend({ ...EmployeeProfileFieldsSchema.shape, email: z.string().email().max(254) })
  .superRefine((v, ctx) => {
    assertBranchAssignment(v, ctx);
    assertCommissionRate(v, ctx);
    assertPrimaryBranchAssigned(v, ctx);
  });
export type CreateEmployeeInput = z.infer<typeof CreateEmployeeSchema>;

export const UpdateEmployeeSchema = CreateEmployeeSchema.innerType().omit({ password: true }).partial();
export type UpdateEmployeeInput = z.infer<typeof UpdateEmployeeSchema>;

/** API response shape for the employee create/update/get-by-id routes. */
export const EmployeeSchema = UserSchema.extend({
  mobile: z.string().nullable(),
  gender: GenderSchema.nullable(),
  employeeStatus: EmployeeStatusSchema,
  primaryBranchId: z.string().uuid().nullable(),
  employmentType: EmploymentTypeSchema.nullable(),
  joiningDate: z.coerce.date().nullable(),
  reportingManager: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
  baseSalaryMinor: z.number().int(),
  commissionEnabled: z.boolean(),
  commissionRatePct: z.number().nullable(),
  allowances: z.array(EmployeePayrollComponentSchema),
  deductions: z.array(EmployeePayrollComponentSchema),
  /** computed = baseSalaryMinor + Σ allowances; never stored */
  grossSalaryMinor: z.number().int(),
  /** computed = grossSalaryMinor − Σ deductions; never stored */
  netSalaryMinor: z.number().int(),
});
export type Employee = z.infer<typeof EmployeeSchema>;

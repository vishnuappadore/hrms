"use client";

import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { Controller, useFieldArray, useForm, type FieldPath } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { z } from "zod";
import {
  assertBranchAssignment,
  assertCommissionRate,
  assertPrimaryBranchAssigned,
  CreateStaffSchema,
  formatMoney,
  fromMinorUnits,
  percentOf,
  toMinorUnits,
  type CreateStaffInput,
  type Staff,
} from "@keystonehr/shared";
import { useRouter } from "@/i18n/navigation";
import { ApiError } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { usePermissions } from "@/lib/permissions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox } from "@/components/ui/combobox";
import { Field } from "@/components/ui/field";
import { FormSection } from "@/components/ui/form-section";
import { Input } from "@/components/ui/input";
import { MobileInput } from "@/components/ui/mobile-input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select } from "@/components/ui/select";
import { Stepper } from "@/components/ui/stepper";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { useBranches } from "@/lib/queries/branches";
import { usePayrollComponents } from "@/lib/queries/payroll-components";
import { useCreateUser, useMe, useRoles, useUpdateUser, useUsers } from "@/lib/queries/users";

const BaseSchema = CreateStaffSchema.innerType();

function superRefineStaff(
  v: Omit<z.infer<typeof BaseSchema>, "password">,
  ctx: z.RefinementCtx,
) {
  assertBranchAssignment(v, ctx);
  assertCommissionRate(v, ctx);
  assertPrimaryBranchAssigned(v, ctx);
}

const CreateFormSchema = BaseSchema.extend({ confirmPassword: z.string() }).superRefine(
  (v, ctx) => {
    superRefineStaff(v, ctx);
    if (v.password !== v.confirmPassword) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["confirmPassword"], message: "passwordMismatch" });
    }
  },
);

const EditFormSchema = BaseSchema.omit({ password: true }).superRefine(superRefineStaff);

type FormValues = z.infer<typeof CreateFormSchema>;

const emptyToNull = { setValueAs: (v: unknown) => (v === "" ? null : v) };

function toDateInputValue(value: string | Date | undefined | null): string {
  if (!value) return "";
  return new Date(value).toISOString().slice(0, 10);
}

const FIELD_ERROR_KEYS: Record<string, string> = {
  name: "nameRequired",
  username: "usernameInvalid",
  mobile: "mobileInvalid",
  email: "emailInvalid",
  primaryBranchId: "primaryBranchRequired",
  roleId: "roleRequired",
  employmentType: "employmentTypeRequired",
  baseSalaryMinor: "baseSalaryInvalid",
  confirmPassword: "passwordMismatch",
  branchIds: "branchRequired",
  password: "passwordPolicy",
  reportingManagerId: "reportingManagerSelf",
  commissionRatePct: "commissionRateRequired",
};

export function StaffForm({ user }: { user?: Staff }) {
  const t = useTranslations("staff");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const createUser = useCreateUser();
  const updateUser = useUpdateUser(user?.id ?? "");
  const roles = useRoles();
  const branches = useBranches({ pageSize: 100 });
  const users = useUsers({ pageSize: 100 });
  const allowanceComponents = usePayrollComponents("allowance");
  const deductionComponents = usePayrollComponents("deduction");
  const { data: me } = useMe();
  const permissions = usePermissions();
  const canSave =
    permissions.includes(user ? "staff.update" : "staff.create") &&
    permissions.includes("staff.employment.manage");
  const { showToast } = useToast();
  const [serverError, setServerError] = useState<string | null>(null);
  const [step, setStep] = useState(0);

  const schema = useMemo(() => (user ? EditFormSchema : CreateFormSchema), [user]);

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    setError,
    clearErrors,
    trigger,
    getValues,
    formState: { errors, isSubmitting, dirtyFields },
  } = useForm<FormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(schema as any),
    shouldUnregister: true,
    mode: "onChange",
    reValidateMode: "onChange",
    defaultValues: user
      ? {
          name: user.name,
          username: user.username,
          email: user.email ?? "",
          mobile: user.mobile ?? "",
          gender: user.gender ?? undefined,
          staffStatus: user.staffStatus,
          primaryBranchId: user.primaryBranchId ?? undefined,
          employmentType: user.employmentType ?? undefined,
          joiningDate: (toDateInputValue(user.joiningDate) || undefined) as unknown as Date,
          reportingManagerId: user.reportingManager?.id ?? null,
          roleId: user.role.id,
          status: user.status,
          locale: user.locale,
          allBranches: user.allBranches,
          branchIds: user.branchIds,
          baseSalaryMinor: user.baseSalaryMinor,
          commissionEnabled: user.commissionEnabled,
          commissionRatePct: user.commissionRatePct ?? undefined,
          allowances: user.allowances.map((a) => ({
            payrollComponentId: a.payrollComponentId,
            amountMinor: a.amountMinor,
          })),
          deductions: user.deductions.map((d) => ({
            payrollComponentId: d.payrollComponentId,
            amountMinor: d.amountMinor,
          })),
        }
      : {
          gender: "male",
          staffStatus: "active",
          status: "active",
          locale: "en",
          allBranches: false,
          branchIds: [],
          baseSalaryMinor: 0,
          commissionEnabled: false,
          allowances: [],
          deductions: [],
        },
  });

  const allowanceFields = useFieldArray({ control, name: "allowances" });
  const deductionFields = useFieldArray({ control, name: "deductions" });

  const allBranches = watch("allBranches");
  const primaryBranchId = watch("primaryBranchId");
  const currency =
    (branches.data?.data ?? []).find((b) => b.id === primaryBranchId)?.currency ??
    me?.currency ??
    "OMR";
  const baseSalaryMinor = watch("baseSalaryMinor") ?? 0;
  const commissionEnabled = watch("commissionEnabled");
  const allowanceValues = watch("allowances") ?? [];
  const deductionValues = watch("deductions") ?? [];
  const usernameValue = watch("username");
  const emailValue = watch("email");

  const managerOptions = (users.data?.data ?? [])
    .filter((u) => u.id !== user?.id)
    .filter((u) => !primaryBranchId || u.allBranches || u.branchIds.includes(primaryBranchId))
    .map((u) => ({ value: u.id, label: u.name }));

  // The primary branch must always be one of the assigned branches. Running
  // this as an effect (not just on the Select's onChange) also covers the
  // edit-mode case: a loaded record's branchIds may not yet include it.
  useEffect(() => {
    if (allBranches) return;
    // Deferred to the next macrotask: the Assigned Branches Controller's own
    // first-mount registration (triggered by this same allBranches flip) runs
    // asynchronously AFTER this effect and resets branchIds back to its
    // static defaultValues snapshot, clobbering a same-tick setValue here —
    // same category of RHF/shouldUnregister race as goNext()'s clearErrors.
    const handle = setTimeout(() => {
      const current = getValues("branchIds") ?? [];
      if (primaryBranchId && !current.includes(primaryBranchId)) {
        setValue("branchIds", [...current, primaryBranchId], { shouldValidate: true });
      }
    }, 0);
    return () => clearTimeout(handle);
  }, [primaryBranchId, allBranches]);

  // Reporting Manager is narrowed to staff with access to the Primary Branch
  // (see managerOptions below); clear a selection the narrowing just orphaned.
  useEffect(() => {
    const currentManagerId = watch("reportingManagerId");
    if (currentManagerId && !managerOptions.some((o) => o.value === currentManagerId)) {
      setValue("reportingManagerId", null);
    }
  }, [primaryBranchId]);

  // Live "already taken" check using the staff list already loaded above for
  // Reporting Manager — no new request. Case-sensitive for username,
  // case-insensitive for email, matching assertNoConflict's real semantics.
  // Only clears an error this effect itself set, never a schema error (e.g.
  // "too short") the zod resolver is managing for the same field.
  useEffect(() => {
    // Debounced so this settles AFTER the zod resolver's own onChange
    // revalidation for the same keystroke — otherwise the resolver's async
    // validation (which sees a well-formed username) can clear this error
    // right back out on the same change.
    const handle = setTimeout(() => {
      const taken =
        !!usernameValue &&
        usernameValue.length >= 3 &&
        (users.data?.data ?? []).some((u) => u.id !== user?.id && u.username === usernameValue);
      if (taken) {
        setError("username", { message: "usernameExists" });
      } else if (errors.username?.message === "usernameExists") {
        clearErrors("username");
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [usernameValue, users.data]);

  useEffect(() => {
    const handle = setTimeout(() => {
      const taken =
        !!emailValue &&
        (users.data?.data ?? []).some(
          (u) => u.id !== user?.id && u.email?.toLowerCase() === emailValue.toLowerCase(),
        );
      if (taken) {
        setError("email", { message: "emailExists" });
      } else if (errors.email?.message === "emailExists") {
        clearErrors("email");
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [emailValue, users.data]);

  const grossSalaryMinor =
    baseSalaryMinor + allowanceValues.reduce((sum, a) => sum + (a.amountMinor ?? 0), 0);
  const totalDeductionsMinor = deductionValues.reduce((sum, d) => sum + (d.amountMinor ?? 0), 0);
  const netSalaryMinor = grossSalaryMinor - totalDeductionsMinor;

  // Percentage-of-base components are derived, never typed: the API and payroll always recompute
  // them from the current base salary (resolveComponentAmountMinor). Keep the read-only form values
  // in step with base salary so the Gross/Net summary here matches what the payslip will show.
  useEffect(() => {
    const sync = (prefix: "allowances" | "deductions", components: PayrollComponentOption[] | undefined) => {
      (getValues(prefix) ?? []).forEach((row, i) => {
        const c = components?.find((x) => x.id === row.payrollComponentId);
        if (c?.basis !== "percentage_of_base") return;
        const amount = percentOf(baseSalaryMinor, c.defaultRatePct ?? 0);
        if (row.amountMinor !== amount) setValue(`${prefix}.${i}.amountMinor`, amount);
      });
    };
    sync("allowances", allowanceComponents.data);
    sync("deductions", deductionComponents.data);
  }, [baseSalaryMinor, allowanceComponents.data, deductionComponents.data]);

  type F = FieldPath<FormValues>;
  const steps: { key: string; title: string; fields: F[] }[] = [
    {
      key: "basicProfile",
      title: t("form.stepBasicProfile"),
      fields: ["name", "username", "mobile", "email", "gender", "staffStatus"],
    },
    {
      key: "employment",
      title: t("form.stepEmployment"),
      fields: ["primaryBranchId", "roleId", "employmentType", "joiningDate", "reportingManagerId"],
    },
    {
      key: "salaryCommission",
      title: t("form.stepSalaryCommission"),
      fields: [
        "baseSalaryMinor",
        "commissionEnabled",
        "commissionRatePct",
        ...allowanceFields.fields.flatMap(
          (_, i) => [`allowances.${i}.payrollComponentId`, `allowances.${i}.amountMinor`] as const,
        ),
        ...deductionFields.fields.flatMap(
          (_, i) => [`deductions.${i}.payrollComponentId`, `deductions.${i}.amountMinor`] as const,
        ),
      ],
    },
    {
      key: "systemAccess",
      title: t("form.stepSystemAccess"),
      fields: user
        ? ["roleId", "status", "allBranches", "branchIds"]
        : ["roleId", "status", "allBranches", "branchIds", "password", "confirmPassword"],
    },
  ];

  const current = step;
  const currentStep = steps[current]!;
  const isLast = current === steps.length - 1;
  const show = (key: string) => (currentStep.key === key ? undefined : "hidden");
  // Edit mode only: every step's data is already populated and independently valid (unlike
  // create, where later steps may have no data yet), so free step-jumping is safe there.
  const hasUnsavedChanges = Object.keys(dirtyFields).length > 0;

  async function goNext() {
    const ok = await trigger(currentStep.fields);
    if (ok) {
      const nextIndex = current + 1;
      setStep(nextIndex);
      // useFieldArray + shouldUnregister runs an internal full-schema validity
      // check (async, after the next step's fields mount) that clobbers
      // formState.errors with "required" errors for fields the user hasn't
      // reached yet. Clear them on the next macrotask, after that settles —
      // the user shouldn't see errors for a step before trying to leave it.
      setTimeout(() => clearErrors(steps[nextIndex]?.fields), 0);
    }
  }
  function goBack() {
    setStep(Math.max(0, current - 1));
  }

  /**
   * Finds the first step (in order) containing a field with a validation error. All 4 steps share
   * one always-mounted form — a step's own error messages are invisible while that step is
   * CSS-hidden, so without this, clicking Save while on step 2/3 with an invalid field back on step
   * 1 silently does nothing (handleSubmit never calls onSubmit, and the error renders off-screen).
   */
  function stepIndexForError(formErrors: typeof errors): number {
    // Match on each field's ROOT segment ("allowances.0.amountMinor" → "allowances"), not the exact
    // path: errors on fields a step doesn't list (array-level errors, newly added schema fields)
    // must still route to the step that renders them instead of returning -1 and staying hidden.
    const erroredRoots = Object.keys(formErrors).filter(
      (k) => (formErrors as Record<string, unknown>)[k] != null,
    );
    return steps.findIndex((s) =>
      s.fields.some((path) => erroredRoots.includes(path.split(".")[0]!)),
    );
  }

  function onInvalid(formErrors: typeof errors) {
    const erroredStep = stepIndexForError(formErrors);
    if (erroredStep !== -1) setStep(erroredStep);
    setServerError(t("form.errors.fixHighlighted"));
  }

  const submitForm = handleSubmit(onSubmit, onInvalid);

  async function onSubmit(values: FormValues) {
    setServerError(null);
    try {
      if (user) {
        const { confirmPassword: _c, password: _p, ...rest } = values;
        await updateUser.mutateAsync(rest);
      } else {
        const { confirmPassword: _c, ...input } = values;
        await createUser.mutateAsync(input as CreateStaffInput);
      }
      showToast(tc("savedSuccessfully"));
      router.replace("/staff");
      router.refresh();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "NETWORK";
      if (code === "USERNAME_EXISTS") {
        setError("username", { message: "usernameExists" });
        setStep(steps.findIndex((s) => s.key === "basicProfile"));
      } else if (code === "EMAIL_EXISTS") {
        setError("email", { message: "emailExists" });
        setStep(steps.findIndex((s) => s.key === "basicProfile"));
      } else {
        setServerError(
          code === "CANNOT_MODIFY_SELF"
            ? t("form.errors.cannotModifySelf")
            : code === "VALIDATION_FAILED"
              ? tc("errors.VALIDATION_FAILED")
              : tc("errors.GENERIC"),
        );
      }
    }
  }

  const err = (path: keyof FormValues): string | undefined => {
    const node = errors[path];
    if (!node?.message) return undefined;
    const known = [
      "passwordMismatch",
      "branchRequired",
      "usernameExists",
      "emailExists",
      "reportingManagerSelf",
      "commissionRateRequired",
    ];
    const key = known.includes(String(node.message))
      ? String(node.message)
      : (FIELD_ERROR_KEYS[String(path)] ?? "invalid");
    return t(`form.errors.${key}`);
  };

  function componentLabel(component: { nameEn: string; nameAr: string }) {
    return locale === "ar" ? component.nameAr : component.nameEn;
  }

  function prefillAmount(
    fieldName: `allowances.${number}.amountMinor` | `deductions.${number}.amountMinor`,
    componentId: string,
    components: PayrollComponentOption[],
  ) {
    const component = components.find((c) => c.id === componentId);
    if (!component) return;
    if (component.basis === "fixed_amount") {
      // defaultAmountMinor is minted in the tenant's default currency (Settings
      // > Payroll Components has no branch context). Only trust it when the
      // staff member's branch currency matches — otherwise leave it for the
      // admin to enter manually rather than silently prefilling the wrong
      // currency/magnitude (there's no FX conversion anywhere in money.ts).
      const tenantCurrency = me?.currency ?? "OMR";
      setValue(fieldName, currency === tenantCurrency ? (component.defaultAmountMinor ?? 0) : 0);
      return;
    }
    setValue(fieldName, percentOf(baseSalaryMinor, component.defaultRatePct ?? 0));
  }

  function onKeyDown(e: KeyboardEvent<HTMLFormElement>) {
    // Enter advances the step instead of submitting early (submit is last-step only).
    if (e.key === "Enter" && !isLast && (e.target as HTMLElement).tagName !== "TEXTAREA") {
      e.preventDefault();
      void goNext();
    }
  }

  return (
    <form onSubmit={submitForm} onKeyDown={onKeyDown} className="space-y-5" noValidate>
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">
          {t("form.stepProgress", { current: current + 1, total: steps.length, title: currentStep.title })}
        </p>
        <Stepper steps={steps} current={current} onStepClick={user ? setStep : undefined} />
      </div>

      <div className={cn("space-y-4", show("basicProfile"))}>
        <FormSection>
          <Field label={t("form.name")} htmlFor="name" required error={err("name")}>
            <Input id="name" {...register("name")} />
          </Field>
          <Field label={t("form.username")} htmlFor="username" required error={err("username")}>
            <Input id="username" dir="ltr" autoComplete="off" {...register("username")} />
          </Field>
          <Field label={t("form.mobile")} htmlFor="mobile" required error={err("mobile")}>
            <MobileInput
              id="mobile"
              value={watch("mobile")}
              onChange={(v) => setValue("mobile", v, { shouldValidate: false })}
              defaultCurrency={me?.currency}
            />
          </Field>
          <Field label={t("form.email")} htmlFor="email" required error={err("email")}>
            <Input id="email" type="email" dir="ltr" {...register("email")} />
          </Field>
          <Field label={t("form.gender")} required>
            <Controller
              control={control}
              name="gender"
              render={({ field }) => (
                <SegmentedControl
                  aria-label={t("form.gender")}
                  value={field.value ?? undefined}
                  onChange={field.onChange}
                  options={[
                    { value: "male", label: t("form.genderMale") },
                    { value: "female", label: t("form.genderFemale") },
                  ]}
                />
              )}
            />
          </Field>
          <Field label={t("form.staffStatus")} required>
            <Controller
              control={control}
              name="staffStatus"
              render={({ field }) => (
                <SegmentedControl
                  aria-label={t("form.staffStatus")}
                  value={field.value}
                  onChange={field.onChange}
                  options={[
                    { value: "active", label: t("form.staffStatusActive") },
                    { value: "on_leave", label: t("form.staffStatusOnLeave") },
                    { value: "inactive", label: t("form.staffStatusInactive") },
                  ]}
                />
              )}
            />
          </Field>
        </FormSection>
      </div>

      <div className={cn("space-y-4", show("employment"))}>
        <FormSection>
          <Field
            label={t("form.primaryBranch")}
            htmlFor="primaryBranchId"
            required
            error={err("primaryBranchId")}
          >
            <Controller
              control={control}
              name="primaryBranchId"
              render={({ field }) => (
                <Select
                  id="primaryBranchId"
                  value={field.value ?? ""}
                  onChange={(e) => field.onChange(e.target.value)}
                >
                  <option value="">—</option>
                  {(branches.data?.data ?? []).map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.nameEn}
                    </option>
                  ))}
                </Select>
              )}
            />
          </Field>
          <Field label={t("form.role")} htmlFor="employmentRoleId" required error={err("roleId")}>
            <Controller
              control={control}
              name="roleId"
              render={({ field }) => (
                <Select id="employmentRoleId" value={field.value ?? ""} onChange={field.onChange}>
                  <option value="">—</option>
                  {(roles.data ?? []).map((role) => (
                    <option key={role.id} value={role.id}>
                      {locale === "ar" ? role.nameAr : role.nameEn}
                    </option>
                  ))}
                </Select>
              )}
            />
          </Field>
          <Field label={t("form.employmentType")} required>
            <Controller
              control={control}
              name="employmentType"
              render={({ field }) => (
                <SegmentedControl
                  aria-label={t("form.employmentType")}
                  value={field.value ?? undefined}
                  onChange={field.onChange}
                  options={[
                    { value: "full_time", label: t("form.employmentTypeFullTime") },
                    { value: "part_time", label: t("form.employmentTypePartTime") },
                    { value: "contract", label: t("form.employmentTypeContract") },
                  ]}
                />
              )}
            />
          </Field>
          <Field label={t("form.joiningDate")} htmlFor="joiningDate">
            <Input id="joiningDate" type="date" {...register("joiningDate", emptyToNull)} />
          </Field>
          <div className="sm:col-span-2">
            <Field label={t("form.reportingManager")}>
              <Controller
                control={control}
                name="reportingManagerId"
                render={({ field }) => (
                  <Combobox
                    id="reportingManagerId"
                    options={managerOptions}
                    value={field.value ?? null}
                    onChange={field.onChange}
                    placeholder={t("form.reportingManagerPlaceholder")}
                    clearLabel={t("form.noReportingManager")}
                  />
                )}
              />
            </Field>
          </div>
        </FormSection>
      </div>

      <div className={cn("space-y-4", show("salaryCommission"))}>
        <FormSection>
          <Field label={t("form.baseSalary", { currency })} htmlFor="baseSalaryMinor" error={err("baseSalaryMinor")}>
            <Controller
              control={control}
              name="baseSalaryMinor"
              render={({ field }) => (
                <Input
                  id="baseSalaryMinor"
                  type="number"
                  min={0}
                  step="any"
                  value={field.value != null ? fromMinorUnits(field.value, currency) : ""}
                  onChange={(e) =>
                    field.onChange(
                      e.target.value === "" ? 0 : toMinorUnits(Number(e.target.value), currency),
                    )
                  }
                />
              )}
            />
          </Field>
          <div className="sm:col-span-2 flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
            <p className="text-sm font-medium">{t("form.commissionRate")}</p>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{t("form.commissionEnabledLabel")}</span>
              <Controller
                control={control}
                name="commissionEnabled"
                render={({ field }) => (
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    aria-label={t("form.commissionEnabledLabel")}
                  />
                )}
              />
            </div>
          </div>
          {commissionEnabled && (
            <Field
              label={t("form.commissionRatePct")}
              htmlFor="commissionRatePct"
              required
              error={err("commissionRatePct")}
            >
              <Input
                id="commissionRatePct"
                type="number"
                min={0}
                max={100}
                step="any"
                {...register("commissionRatePct", {
                  setValueAs: (v: unknown) => (v === "" ? undefined : Number(v)),
                })}
              />
            </Field>
          )}
        </FormSection>

        <ComponentListSection
          title={t("form.allowances")}
          emptyLabel={t("form.noAllowances")}
          addLabel={t("form.addAllowance")}
          selectLabel={t("form.selectComponent")}
          amountLabel={t("form.amount")}
          fields={allowanceFields.fields}
          components={allowanceComponents.data ?? []}
          selectedIds={allowanceValues.map((a) => a.payrollComponentId).filter(Boolean)}
          componentLabel={componentLabel}
          onAdd={() => allowanceFields.append({ payrollComponentId: "", amountMinor: 0 })}
          onRemove={allowanceFields.remove}
          register={register}
          control={control}
          namePrefix="allowances"
          rowComponentIds={allowanceValues.map((a) => a.payrollComponentId)}
          currency={currency}
          onSelectComponent={(index, componentId) =>
            prefillAmount(`allowances.${index}.amountMinor`, componentId, allowanceComponents.data ?? [])
          }
        />

        <ComponentListSection
          title={t("form.deductions")}
          emptyLabel={t("form.noDeductions")}
          addLabel={t("form.addDeduction")}
          selectLabel={t("form.selectComponent")}
          amountLabel={t("form.amount")}
          fields={deductionFields.fields}
          components={deductionComponents.data ?? []}
          selectedIds={deductionValues.map((d) => d.payrollComponentId).filter(Boolean)}
          componentLabel={componentLabel}
          onAdd={() => deductionFields.append({ payrollComponentId: "", amountMinor: 0 })}
          onRemove={deductionFields.remove}
          register={register}
          control={control}
          namePrefix="deductions"
          rowComponentIds={deductionValues.map((d) => d.payrollComponentId)}
          currency={currency}
          onSelectComponent={(index, componentId) =>
            prefillAmount(`deductions.${index}.amountMinor`, componentId, deductionComponents.data ?? [])
          }
        />

        <section className="rounded-xl border border-border bg-card p-5">
          <dl className="divide-y divide-border/60 text-sm">
            <SummaryRow label={t("form.grossSalary")} value={formatMoney(grossSalaryMinor, currency, locale)} />
            <SummaryRow
              label={t("form.totalDeductions")}
              value={`− ${formatMoney(totalDeductionsMinor, currency, locale)}`}
            />
            <SummaryRow
              label={t("form.netSalary")}
              value={formatMoney(netSalaryMinor, currency, locale)}
              emphasize
            />
          </dl>
        </section>
      </div>

      <div className={cn("space-y-4", show("systemAccess"))}>
        <FormSection title={t("form.access")}>
          <Field label={t("form.role")} htmlFor="roleId" required error={err("roleId")}>
            <Controller
              control={control}
              name="roleId"
              render={({ field }) => (
                <Select id="roleId" value={field.value ?? ""} onChange={field.onChange}>
                  <option value="">—</option>
                  {(roles.data ?? []).map((role) => (
                    <option key={role.id} value={role.id}>
                      {locale === "ar" ? role.nameAr : role.nameEn}
                    </option>
                  ))}
                </Select>
              )}
            />
          </Field>
          <Field label={t("form.status")} htmlFor="status" required>
            <Select id="status" {...register("status")}>
              <option value="active">{tc("active")}</option>
              <option value="inactive">{tc("inactive")}</option>
            </Select>
          </Field>
          <p className="sm:col-span-2 -mt-2 text-xs text-muted-foreground">
            {t("form.accountStatusHint")}
          </p>

          <div className="sm:col-span-2">
            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
              <div>
                <p className="text-sm font-medium">{t("form.allBranches")}</p>
                <p className="text-xs text-muted-foreground">{t("form.allBranchesHint")}</p>
              </div>
              <Controller
                control={control}
                name="allBranches"
                render={({ field }) => (
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    aria-label={t("form.allBranches")}
                  />
                )}
              />
            </div>
          </div>

          {!allBranches && (
            <div className="sm:col-span-2">
              <Field label={t("form.branches")} required error={err("branchIds")}>
                <Controller
                  control={control}
                  name="branchIds"
                  render={({ field }) => {
                    const selected = field.value ?? [];
                    return (
                      <div className="grid grid-cols-1 gap-2 rounded-lg border border-border p-3 sm:grid-cols-2">
                        {(branches.data?.data ?? []).map((branch) => {
                          const isPrimary = branch.id === primaryBranchId;
                          return (
                            <label
                              key={branch.id}
                              className={cn(
                                "flex items-center gap-2 text-xs",
                                isPrimary ? "cursor-not-allowed opacity-80" : "cursor-pointer",
                              )}
                            >
                              <Checkbox
                                checked={isPrimary || selected.includes(branch.id)}
                                disabled={isPrimary}
                                onChange={() => {
                                  if (isPrimary) return;
                                  field.onChange(
                                    selected.includes(branch.id)
                                      ? selected.filter((b) => b !== branch.id)
                                      : [...selected, branch.id],
                                  );
                                }}
                              />
                              {branch.nameEn}
                              <span className="text-muted-foreground">{branch.code}</span>
                              {isPrimary && (
                                <span className="font-medium text-primary">
                                  {t("form.primaryBranchLocked")}
                                </span>
                              )}
                            </label>
                          );
                        })}
                        {branches.data && branches.data.data.length === 0 && (
                          <p className="text-sm text-muted-foreground">{t("form.noBranches")}</p>
                        )}
                      </div>
                    );
                  }}
                />
              </Field>
            </div>
          )}
        </FormSection>

        {!user && (
          <FormSection title={t("form.credentials")}>
            <Field label={t("form.password")} htmlFor="password" required error={err("password")}>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                {...register("password")}
              />
            </Field>
            <Field
              label={t("form.confirmPassword")}
              htmlFor="confirmPassword"
              required
              error={err("confirmPassword")}
            >
              <Input
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
                {...register("confirmPassword")}
              />
            </Field>
            <p className="text-xs text-muted-foreground sm:col-span-2">{t("form.passwordHint")}</p>
          </FormSection>
        )}
      </div>

      {serverError && <Alert>{serverError}</Alert>}

      <div className="flex items-center justify-between gap-3">
        <Button variant="outline" type="button" onClick={() => router.back()}>
          {tc("cancel")}
        </Button>
        <div className="flex gap-3">
          {current > 0 && (
            <Button variant="outline" type="button" onClick={goBack}>
              {tc("back")}
            </Button>
          )}
          {isLast ? (
            canSave && (
              <Button type="button" disabled={isSubmitting} onClick={submitForm}>
                {isSubmitting ? tc("saving") : user ? tc("save") : t("form.addStaff")}
              </Button>
            )
          ) : (
            <>
              {user && hasUnsavedChanges && canSave && (
                <Button
                  variant="outline"
                  type="button"
                  disabled={isSubmitting}
                  onClick={submitForm}
                >
                  {isSubmitting ? tc("saving") : tc("save")}
                </Button>
              )}
              <Button type="button" onClick={goNext}>
                {tc("next")}
              </Button>
            </>
          )}
        </div>
      </div>
    </form>
  );
}

function SummaryRow({
  label,
  value,
  emphasize,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-2 first:pt-0 last:pb-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("font-medium", emphasize && "text-base font-semibold text-primary")}>{value}</dd>
    </div>
  );
}

interface PayrollComponentOption {
  id: string;
  basis: string;
  defaultAmountMinor?: number | null;
  defaultRatePct?: number | null;
  nameEn: string;
  nameAr: string;
}

function ComponentListSection({
  title,
  emptyLabel,
  addLabel,
  selectLabel,
  amountLabel,
  fields,
  components,
  selectedIds,
  componentLabel,
  onAdd,
  onRemove,
  control,
  namePrefix,
  rowComponentIds,
  currency,
  onSelectComponent,
}: {
  title: string;
  emptyLabel: string;
  addLabel: string;
  selectLabel: string;
  amountLabel: string;
  fields: { id: string }[];
  components: PayrollComponentOption[];
  selectedIds: string[];
  componentLabel: (c: PayrollComponentOption) => string;
  onAdd: () => void;
  onRemove: (index: number) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  register: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  control: any;
  namePrefix: "allowances" | "deductions";
  rowComponentIds: string[];
  currency: string;
  onSelectComponent: (index: number, componentId: string) => void;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
        <Button variant="outline" size="sm" type="button" onClick={onAdd}>
          {addLabel}
        </Button>
      </div>
      {fields.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <div className="space-y-2">
          {fields.map((field, index) => (
            <div key={field.id} className="flex items-center gap-2">
              <div className="flex-1">
                <Controller
                  control={control}
                  name={`${namePrefix}.${index}.payrollComponentId`}
                  render={({ field: f }) => (
                    <Select
                      aria-label={selectLabel}
                      value={f.value ?? ""}
                      onChange={(e) => {
                        f.onChange(e.target.value);
                        onSelectComponent(index, e.target.value);
                      }}
                    >
                      <option value="">{selectLabel}</option>
                      {components
                        .filter((c) => c.id === f.value || !selectedIds.includes(c.id))
                        .map((c) => (
                        <option key={c.id} value={c.id}>
                          {componentLabel(c)}
                        </option>
                      ))}
                    </Select>
                  )}
                />
              </div>
              <div className="w-28">
                <Controller
                  control={control}
                  name={`${namePrefix}.${index}.amountMinor`}
                  render={({ field: f }) => {
                    const isPercentage =
                      components.find((c) => c.id === rowComponentIds[index])?.basis === "percentage_of_base";
                    return (
                    <Input
                      aria-label={amountLabel}
                      // Percentage components are computed from base salary — editing them would be
                      // silently ignored by payroll, so they are display-only.
                      readOnly={isPercentage}
                      className={isPercentage ? "bg-muted text-muted-foreground" : undefined}
                      type="number"
                      min={0}
                      step="any"
                      value={f.value != null ? fromMinorUnits(f.value, currency) : ""}
                      onChange={(e) =>
                        f.onChange(e.target.value === "" ? 0 : toMinorUnits(Number(e.target.value), currency))
                      }
                    />
                    );
                  }}
                />
              </div>
              <Button
                variant="destructive"
                size="sm"
                type="button"
                aria-label="remove"
                onClick={() => onRemove(index)}
              >
                <X className="h-3.5 w-3.5" strokeWidth={1.75} />
              </Button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

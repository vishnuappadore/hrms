"use client";

import { useEffect } from "react";
import { Controller, useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { CreateLeaveTypeSchema, type CreateLeaveTypeInput, type LeaveType } from "@keystonehr/shared";
import { ApiError } from "@/lib/api-client";
import { usePermissions } from "@/lib/permissions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { useCreateLeaveType, useUpdateLeaveType } from "@/lib/queries/leave-types";

const BLANK: CreateLeaveTypeInput = {
  nameEn: "",
  nameAr: "",
  isPaid: true,
  daysPerYear: 0,
  countMode: "skip_weekly_off",
  isEncashable: false,
  creditPolicy: "beginning_of_year",
  minimumNoticeDays: 0,
  maxCarryForwardDays: 0,
  allowCarryForward: false,
  allowHalfDay: false,
  requireSupportingDocument: false,
  allowNegativeBalance: false,
  requiresSecondApproval: false,
};

/** Maps a field to its `settings.leaveSettings.validation.*` message key. */
const VALIDATION_MESSAGE_KEYS: Partial<Record<keyof CreateLeaveTypeInput, string>> = {
  nameEn: "nameEnRequired",
  nameAr: "nameArRequired",
  daysPerYear: "daysPerYearRange",
  minimumNoticeDays: "minimumNoticeDaysRange",
  maxCarryForwardDays: "maxCarryForwardDaysRange",
};

function toFormValues(type: LeaveType): CreateLeaveTypeInput {
  const { id: _id, isActive: _isActive, sortOrder: _sortOrder, ...fields } = type;
  return fields;
}

export function LeaveTypeDialog({
  open,
  type,
  onClose,
}: {
  open: boolean;
  /** null = create mode */
  type: LeaveType | null;
  onClose: () => void;
}) {
  const t = useTranslations("settings.leaveSettings");
  const tc = useTranslations("common");
  const create = useCreateLeaveType();
  const update = useUpdateLeaveType();
  const permissions = usePermissions();
  const pending = create.isPending || update.isPending;

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    setError,
    reset,
    formState: { errors },
  } = useForm<CreateLeaveTypeInput>({
    resolver: zodResolver(CreateLeaveTypeSchema) as unknown as Resolver<CreateLeaveTypeInput>,
    defaultValues: BLANK,
  });

  // The dialog stays mounted across opens (Dialog toggles the native <dialog>
  // element rather than unmount/remount), so the form must be re-synced to
  // whichever record is being edited every time it opens.
  useEffect(() => {
    if (open) reset(type ? toFormValues(type) : BLANK);
  }, [open, type, reset]);

  const allowCarryForward = watch("allowCarryForward");

  function close() {
    onClose();
  }

  async function onSubmit(values: CreateLeaveTypeInput) {
    try {
      if (type) {
        await update.mutateAsync({ id: type.id, input: values });
      } else {
        await create.mutateAsync(values);
      }
      onClose();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "NETWORK";
      if (code === "NAME_EXISTS") {
        setError("nameEn", { type: "server", message: t("nameExists") });
      } else {
        setError("root", { message: tc("errors.GENERIC") });
      }
    }
  }

  /**
   * Client-side zod issues get a specific, localized message per field (zod's
   * own messages aren't localized, so they're never shown directly) —
   * server-flagged errors (e.g. NAME_EXISTS) already carry a friendly,
   * localized message, so those pass through as-is.
   */
  function err(path: keyof CreateLeaveTypeInput): string | undefined {
    const fieldError = errors[path];
    if (!fieldError) return undefined;
    if (fieldError.type === "server") return fieldError.message;
    return t(`validation.${VALIDATION_MESSAGE_KEYS[path] ?? "generic"}`);
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title={type ? t("editTitle") : t("addTitle")}
      className="max-w-2xl"
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6" noValidate>
        <section className="space-y-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("sectionBasic")}
          </h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t("nameEn")} htmlFor="lt-nameEn" required error={err("nameEn")}>
              <Input id="lt-nameEn" dir="ltr" {...register("nameEn")} />
            </Field>
            <Field label={t("nameAr")} htmlFor="lt-nameAr" required error={err("nameAr")}>
              <Input id="lt-nameAr" dir="rtl" {...register("nameAr")} />
            </Field>
          </div>
          <Field label={t("paymentType")}>
            <Controller
              control={control}
              name="isPaid"
              render={({ field }) => (
                <SegmentedControl
                  aria-label={t("paymentType")}
                  value={field.value ? "paid" : "unpaid"}
                  onChange={(v) => field.onChange(v === "paid")}
                  options={[
                    { value: "paid", label: t("paid") },
                    { value: "unpaid", label: t("unpaid") },
                  ]}
                />
              )}
            />
            <p className="mt-1 text-xs text-muted-foreground">{t("paymentTypeHint")}</p>
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t("daysPerYear")} htmlFor="lt-daysPerYear" error={err("daysPerYear")}>
              <Input
                id="lt-daysPerYear"
                type="number"
                min={0}
                step="0.5"
                {...register("daysPerYear", { valueAsNumber: true })}
              />
              <p className="mt-1 text-xs text-muted-foreground">{t("daysPerYearHint")}</p>
            </Field>
            <Field label={t("countMode")} htmlFor="lt-countMode">
              <Select id="lt-countMode" {...register("countMode")}>
                <option value="all_days">{t("countModeOptions.all_days")}</option>
                <option value="skip_weekly_off">{t("countModeOptions.skip_weekly_off")}</option>
              </Select>
              <p className="mt-1 text-xs text-muted-foreground">{t("countModeHint")}</p>
            </Field>
          </div>
        </section>

        <section className="space-y-4 border-t border-border pt-5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("sectionBalance")}
          </h3>
          <Field label={t("creditBalance")} htmlFor="lt-creditPolicy">
            <Select id="lt-creditPolicy" {...register("creditPolicy")}>
              <option value="beginning_of_year">{t("creditPolicyOptions.beginning_of_year")}</option>
              <option value="beginning_of_month">{t("creditPolicyOptions.beginning_of_month")}</option>
              <option value="end_of_month">{t("creditPolicyOptions.end_of_month")}</option>
              <option value="anniversary">{t("creditPolicyOptions.anniversary")}</option>
            </Select>
            <p className="mt-1 text-xs text-muted-foreground">{t("creditBalanceHint")}</p>
          </Field>
          <Controller
            control={control}
            name="allowCarryForward"
            render={({ field }) => (
              <ToggleField
                label={t("allowCarryForward")}
                hint={t("allowCarryForwardHint")}
                checked={field.value}
                onCheckedChange={(v) => {
                  field.onChange(v);
                  if (!v) setValue("maxCarryForwardDays", 0);
                }}
              />
            )}
          />
          <Field
            label={t("maxCarryForwardDays")}
            htmlFor="lt-maxCarryForwardDays"
            error={err("maxCarryForwardDays")}
          >
            <Input
              id="lt-maxCarryForwardDays"
              type="number"
              min={0}
              disabled={!allowCarryForward}
              {...register("maxCarryForwardDays", { valueAsNumber: true })}
            />
          </Field>
          <Controller
            control={control}
            name="allowNegativeBalance"
            render={({ field }) => (
              <ToggleField
                label={t("allowNegativeBalance")}
                hint={t("allowNegativeBalanceHint")}
                checked={field.value}
                onCheckedChange={field.onChange}
              />
            )}
          />
          <Controller
            control={control}
            name="isEncashable"
            render={({ field }) => (
              <ToggleField
                label={t("isEncashable")}
                hint={t("isEncashableHint")}
                checked={field.value}
                onCheckedChange={field.onChange}
              />
            )}
          />
        </section>

        <section className="space-y-4 border-t border-border pt-5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("sectionApproval")}
          </h3>
          <Field
            label={t("minimumNoticeDays")}
            htmlFor="lt-minimumNoticeDays"
            error={err("minimumNoticeDays")}
          >
            <Input
              id="lt-minimumNoticeDays"
              type="number"
              min={0}
              {...register("minimumNoticeDays", { valueAsNumber: true })}
            />
            <p className="mt-1 text-xs text-muted-foreground">{t("minimumNoticeDaysHint")}</p>
          </Field>
          <Controller
            control={control}
            name="allowHalfDay"
            render={({ field }) => (
              <ToggleField
                label={t("allowHalfDay")}
                hint={t("allowHalfDayHint")}
                checked={field.value}
                onCheckedChange={field.onChange}
              />
            )}
          />
          <Controller
            control={control}
            name="requireSupportingDocument"
            render={({ field }) => (
              <ToggleField
                label={t("requireSupportingDocument")}
                hint={t("requireSupportingDocumentHint")}
                checked={field.value}
                onCheckedChange={field.onChange}
              />
            )}
          />
          <Controller
            control={control}
            name="requiresSecondApproval"
            render={({ field }) => (
              <ToggleField
                label={t("requiresSecondApproval")}
                hint={t("requiresSecondApprovalHint")}
                checked={field.value}
                onCheckedChange={field.onChange}
              />
            )}
          />
        </section>

        {errors.root?.message && <Alert>{errors.root.message}</Alert>}

        <div className="flex items-center justify-end gap-3 border-t border-border pt-4">
          <Button type="button" variant="outline" onClick={close}>
            {tc("cancel")}
          </Button>
          {permissions.includes("leave.settings.manage") && (
            <Button type="submit" disabled={pending}>
              {pending ? tc("saving") : type ? t("saveChanges") : t("createAction")}
            </Button>
          )}
        </div>
      </form>
    </Dialog>
  );
}

function ToggleField({
  label,
  hint,
  checked,
  onCheckedChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} aria-label={label} />
    </div>
  );
}

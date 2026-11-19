"use client";

import { useEffect, useRef, useState } from "react";
import { Controller, useForm, useWatch, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocale, useTranslations } from "next-intl";
import { Paperclip } from "lucide-react";
import { CreateLeaveRequestSchema, type CreateLeaveRequestInput } from "@keystonehr/shared";
import { ApiError } from "@/lib/api-client";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { useAttendanceList } from "@/lib/queries/attendance";
import { useLeaveTypes } from "@/lib/queries/leave-types";
import {
  useCreateLeaveRequest,
  useLeaveBalances,
  useMyLeaveBalances,
  usePresignLeaveAttachment,
} from "@/lib/queries/leave";

function todayString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const BLANK: CreateLeaveRequestInput = {
  leaveTypeId: "",
  employeeProfileId: undefined,
  startDate: todayString() as unknown as Date,
  endDate: todayString() as unknown as Date,
  startHalfDay: false,
  endHalfDay: false,
  halfDayPeriod: undefined,
  reason: "",
  attachmentKey: undefined,
};

/** Maps a field to its `leave.requestDialog.validation.*` message key. */
const VALIDATION_MESSAGE_KEYS: Partial<Record<keyof CreateLeaveRequestInput, string>> = {
  leaveTypeId: "leaveTypeRequired",
  startDate: "startDateRequired",
  endDate: "endDateBeforeStart",
  halfDayPeriod: "halfDayShapeInvalid",
  reason: "reasonRequired",
};

export function RequestLeaveDialog({
  open,
  onClose,
  allowOnBehalf = true,
}: {
  open: boolean;
  onClose: () => void;
  /** Self-service entry points (My Panel, Profile's My Leave tab) only ever file for themselves. */
  allowOnBehalf?: boolean;
}) {
  const t = useTranslations("leave.requestDialog");
  const tLeave = useTranslations("leave");
  const tc = useTranslations("common");
  const locale = useLocale();
  const { showToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: leaveTypes } = useLeaveTypes();
  // Reuses Attendance's existing "today" employee list purely as a {employeeProfileId, name} lookup for
  // the admin-on-behalf picker — no new endpoint, no Employees-module change.
  const { data: todayAttendance } = useAttendanceList({ scope: "today", date: todayString(), page: 1, pageSize: 100 });
  const employeeOptions = (todayAttendance?.data ?? []).map((row) => row.employee);

  const create = useCreateLeaveRequest();
  const presignAttachment = usePresignLeaveAttachment();
  const [attachmentName, setAttachmentName] = useState<string | null>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const {
    control,
    register,
    handleSubmit,
    reset,
    setValue,
    setError,
    formState: { errors },
  } = useForm<CreateLeaveRequestInput>({
    resolver: zodResolver(CreateLeaveRequestSchema) as unknown as Resolver<CreateLeaveRequestInput>,
    defaultValues: BLANK,
  });

  useEffect(() => {
    if (open) {
      reset(BLANK);
      setAttachmentName(null);
      setAttachmentError(null);
    }
  }, [open, reset]);

  const employeeProfileId = useWatch({ control, name: "employeeProfileId" });
  const leaveTypeId = useWatch({ control, name: "leaveTypeId" });
  const startDate = useWatch({ control, name: "startDate" });
  const endDate = useWatch({ control, name: "endDate" });
  const halfDayPeriod = useWatch({ control, name: "halfDayPeriod" });
  const isSingleDay = !!startDate && startDate === endDate;

  const selectedType = (leaveTypes ?? []).find((lt) => lt.id === leaveTypeId);

  const myBalances = useMyLeaveBalances();
  const employeeBalances = useLeaveBalances(employeeProfileId || undefined);
  const balances = employeeProfileId ? employeeBalances.data : myBalances.data;
  const remaining = balances?.find((b) => b.leaveTypeId === leaveTypeId)?.closingBalance;

  // Each shape only makes sense for one case — switching between single-day and a range clears
  // whichever fields no longer apply, so a stale half-day choice never silently carries over.
  useEffect(() => {
    if (isSingleDay) {
      setValue("startHalfDay", false);
      setValue("endHalfDay", false);
    } else {
      setValue("halfDayPeriod", undefined);
    }
  }, [isSingleDay, setValue]);

  function err(path: keyof CreateLeaveRequestInput): string | undefined {
    const fieldError = errors[path];
    if (!fieldError) return undefined;
    if (fieldError.type === "server") return fieldError.message as string;
    return t(`validation.${VALIDATION_MESSAGE_KEYS[path] ?? "generic"}`);
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAttachmentError(null);
    setUploading(true);
    try {
      const { uploadUrl, key } = await presignAttachment.mutateAsync({
        fileName: file.name,
        contentType: file.type || "application/octet-stream",
      });
      const res = await fetch(uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
      if (!res.ok) throw new Error("upload failed");
      setValue("attachmentKey", key, { shouldValidate: true });
      setAttachmentName(file.name);
    } catch {
      setAttachmentError(t("attachmentUploadFailed"));
      setValue("attachmentKey", undefined);
      setAttachmentName(null);
    } finally {
      setUploading(false);
    }
  }

  async function onSubmit(values: CreateLeaveRequestInput) {
    try {
      await create.mutateAsync(values);
      showToast(tLeave("toast.requestSubmitted"));
      onClose();
    } catch (error) {
      const code = error instanceof ApiError ? error.code : "NETWORK";
      const key =
        code === "LEAVE_MINIMUM_NOTICE_NOT_MET"
          ? "minimumNoticeNotMet"
          : code === "LEAVE_HALF_DAY_NOT_ALLOWED"
            ? "halfDayNotAllowed"
            : code === "LEAVE_SUPPORTING_DOCUMENT_REQUIRED"
              ? "supportingDocumentRequired"
              : code === "LEAVE_INSUFFICIENT_BALANCE"
                ? "insufficientBalance"
                : code === "LEAVE_DATE_CONFLICT"
                  ? "dateConflict"
                  : null;
      setError("root", { message: key ? t(`validation.${key}`) : tc("errors.GENERIC") });
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("title")}
      className="max-w-2xl"
      showCloseButton
      closeLabel={tc("close")}
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        {allowOnBehalf && (
          <Field label={t("onBehalfOf")} htmlFor="lr-employee">
            <Controller
              control={control}
              name="employeeProfileId"
              render={({ field }) => (
                <Select
                  id="lr-employee"
                  value={field.value ?? ""}
                  onChange={(e) => field.onChange(e.target.value || undefined)}
                >
                  <option value="">{t("myself")}</option>
                  {employeeOptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              )}
            />
          </Field>
        )}

        <Field label={t("leaveType")} htmlFor="lr-type" required error={err("leaveTypeId")}>
          <Controller
            control={control}
            name="leaveTypeId"
            render={({ field }) => (
              <Select id="lr-type" value={field.value} onChange={field.onChange}>
                <option value="" disabled>
                  {t("selectType")}
                </option>
                {(leaveTypes ?? []).map((lt) => (
                  <option key={lt.id} value={lt.id}>
                    {locale === "ar" ? lt.nameAr : lt.nameEn}
                  </option>
                ))}
              </Select>
            )}
          />
          {selectedType && remaining !== undefined && (
            <p className="mt-1 text-xs text-muted-foreground">{t("daysRemaining", { count: remaining })}</p>
          )}
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t("startDate")} htmlFor="lr-start" required error={err("startDate")}>
            <Controller
              control={control}
              name="startDate"
              render={({ field }) => (
                <Input
                  id="lr-start"
                  type="date"
                  value={(field.value as unknown as string) ?? ""}
                  onChange={(e) => field.onChange(e.target.value as unknown as Date)}
                />
              )}
            />
            {selectedType?.allowHalfDay && !isSingleDay && (
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">{t("startHalfDay")}</span>
                <Controller
                  control={control}
                  name="startHalfDay"
                  render={({ field }) => (
                    <Switch checked={field.value} onCheckedChange={field.onChange} aria-label={t("startHalfDay")} />
                  )}
                />
              </div>
            )}
          </Field>
          <Field label={t("endDate")} htmlFor="lr-end" required error={err("endDate")}>
            <Controller
              control={control}
              name="endDate"
              render={({ field }) => (
                <Input
                  id="lr-end"
                  type="date"
                  value={(field.value as unknown as string) ?? ""}
                  onChange={(e) => field.onChange(e.target.value as unknown as Date)}
                />
              )}
            />
            {selectedType?.allowHalfDay && !isSingleDay && (
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">{t("endHalfDay")}</span>
                <Controller
                  control={control}
                  name="endHalfDay"
                  render={({ field }) => (
                    <Switch checked={field.value} onCheckedChange={field.onChange} aria-label={t("endHalfDay")} />
                  )}
                />
              </div>
            )}
          </Field>
        </div>

        {selectedType?.allowHalfDay && isSingleDay && (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm font-medium">{t("halfDay")}</p>
              <Switch
                checked={!!halfDayPeriod}
                onCheckedChange={(checked) => setValue("halfDayPeriod", checked ? "first_half" : undefined)}
                aria-label={t("halfDay")}
              />
            </div>
            {halfDayPeriod && (
              <Controller
                control={control}
                name="halfDayPeriod"
                render={({ field }) => (
                  <SegmentedControl
                    aria-label={t("halfDayPeriod")}
                    value={field.value ?? "first_half"}
                    onChange={field.onChange}
                    options={[
                      { value: "first_half", label: t("firstHalf") },
                      { value: "second_half", label: t("secondHalf") },
                    ]}
                  />
                )}
              />
            )}
          </div>
        )}

        <Field label={t("reason")} htmlFor="lr-reason" required error={err("reason")}>
          <textarea
            id="lr-reason"
            rows={3}
            className="w-full rounded-lg border border-input bg-card px-3 py-2 text-[12.5px] text-foreground shadow-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/25"
            {...register("reason")}
          />
        </Field>

        {selectedType?.requireSupportingDocument && (
          <Field
            label={t("attachment")}
            htmlFor="lr-attachment"
            required
            error={attachmentError ?? err("attachmentKey")}
          >
            <input ref={fileInputRef} id="lr-attachment" type="file" className="hidden" onChange={handleFileChange} />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              <Paperclip className="h-3.5 w-3.5" strokeWidth={1.75} />
              {uploading ? tc("saving") : attachmentName ? attachmentName : t("chooseFile")}
            </Button>
            <p className="mt-1 text-xs text-muted-foreground">{t("attachmentHint")}</p>
          </Field>
        )}

        {errors.root?.message && <Alert>{errors.root.message}</Alert>}

        <div className="flex items-center justify-end gap-3 border-t border-border pt-4">
          <Button type="button" variant="outline" onClick={onClose}>
            {tc("cancel")}
          </Button>
          <Button type="submit" disabled={create.isPending || uploading}>
            {create.isPending ? tc("saving") : t("submit")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

"use client";

import { useEffect, useState } from "react";
import { Controller, useFieldArray, useForm, useWatch, type Control, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocale, useTranslations } from "next-intl";
import { Plus, X } from "lucide-react";
import {
  SESSION_VALIDATION_MESSAGES,
  UpdateAttendanceDaySchema,
  type AttendanceDayDetail,
  type UpdateAttendanceDayInput,
} from "@keystonehr/shared";
import { ApiError } from "@/lib/api-client";
import { usePermissions } from "@/lib/permissions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAttendanceDay, useUpdateAttendanceDay } from "@/lib/queries/attendance";
import { formatTime, toDateTimeLocal, toIso } from "./attendance-time";
import { SessionsTable } from "./sessions-table";

/** Maps a rule message (see `SESSION_VALIDATION_MESSAGES`) to its localized key. */
const VALIDATION_MESSAGE_KEYS: Record<string, string> = {
  [SESSION_VALIDATION_MESSAGES.checkInRequired]: "checkInRequired",
  [SESSION_VALIDATION_MESSAGES.checkoutBeforeCheckin]: "checkoutBeforeCheckin",
  [SESSION_VALIDATION_MESSAGES.openMustBeLast]: "openMustBeLast",
  [SESSION_VALIDATION_MESSAGES.overlap]: "overlap",
  [SESSION_VALIDATION_MESSAGES.futureCheckIn]: "futureCheckIn",
  [SESSION_VALIDATION_MESSAGES.futureCheckOut]: "futureCheckOut",
};

function formatMinutes(min: number | null): string {
  if (min == null) return "—";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function toFormValues(detail: AttendanceDayDetail): UpdateAttendanceDayInput {
  return {
    sessions: detail.sessions.map((s) => ({ checkInAt: s.checkInAt, checkOutAt: s.checkOutAt })),
  };
}

export function AttendanceSessionDialog({
  target,
  onClose,
}: {
  target: { employeeProfileId: string; date: string } | null;
  onClose: () => void;
}) {
  const t = useTranslations("attendance.sessionDialog");
  const tc = useTranslations("common");
  const locale = useLocale();
  const { data, isLoading } = useAttendanceDay(target?.employeeProfileId, target?.date);
  const update = useUpdateAttendanceDay();
  const permissions = usePermissions();
  const [editing, setEditing] = useState(false);

  const {
    control,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<UpdateAttendanceDayInput>({
    resolver: zodResolver(UpdateAttendanceDaySchema) as unknown as Resolver<UpdateAttendanceDayInput>,
    defaultValues: { sessions: [] },
  });
  const fieldArray = useFieldArray({ control, name: "sessions" });
  // UX assist only (native picker hint) — the shared schema's future-time check is what blocks Save.
  const maxDateTime = toDateTimeLocal(new Date());

  useEffect(() => {
    setEditing(false);
  }, [target?.employeeProfileId, target?.date]);

  useEffect(() => {
    if (data) reset(toFormValues(data));
  }, [data, reset]);

  function startEdit() {
    if (data) reset(toFormValues(data));
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    if (data) reset(toFormValues(data));
  }

  /** Client zod issues map to a localized key by rule message; server errors pass through as-is. */
  function sessionErr(i: number, field: "checkInAt" | "checkOutAt"): string | undefined {
    const fieldError = errors.sessions?.[i]?.[field];
    if (!fieldError) return undefined;
    if (fieldError.type === "server") return fieldError.message;
    const key = VALIDATION_MESSAGE_KEYS[fieldError.message ?? ""] ?? "generic";
    return t(`validation.${key}`);
  }

  async function onSubmit(values: UpdateAttendanceDayInput) {
    if (!target) return;
    try {
      await update.mutateAsync({
        employeeProfileId: target.employeeProfileId,
        date: target.date,
        input: values,
      });
      setEditing(false);
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "NETWORK";
      setError("root", {
        message: code === "VALIDATION_FAILED" ? tc("errors.VALIDATION_FAILED") : tc("errors.GENERIC"),
      });
    }
  }

  return (
    <Dialog
      open={target !== null}
      onClose={onClose}
      title={data ? t("title", { name: data.employee.name }) : t("titleFallback")}
      className="max-w-3xl"
      showCloseButton
      closeLabel={tc("close")}
    >
      {isLoading || !data ? (
        <p className="text-sm text-muted-foreground">{tc("loading")}</p>
      ) : (
        // No `type="submit"` button anywhere below: the Edit/Save buttons share one JSX
        // position across the `editing` toggle, so React reuses that DOM node — a
        // `type="submit"` button there would occasionally fire a native submit on the very
        // click that turns Edit into Save (the node's `type` attribute flips mid-event). The
        // `onSubmit` here is just a safety net against any native submission regardless.
        <form onSubmit={(e) => e.preventDefault()} className="space-y-4" noValidate>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <SummaryTile label={t("sessions")} value={String(data.sessions.length)} />
            <SummaryTile label={t("firstIn")} value={formatTime(data.firstInAt, locale)} tone="positive" />
            <SummaryTile label={t("lastOut")} value={formatTime(data.lastOutAt, locale)} tone="destructive" />
            <SummaryTile label={t("totalWorked")} value={formatMinutes(data.totalWorkedMinutes)} />
          </div>

          {!editing ? (
            <SessionsTable sessions={data.sessions} />
          ) : (
            <div className="space-y-3">
              {fieldArray.fields.map((row, i) => (
                <div key={row.id} className="grid grid-cols-[1fr_1fr_auto_2rem] items-start gap-2">
                  <div>
                    <Controller
                      control={control}
                      name={`sessions.${i}.checkInAt`}
                      render={({ field }) => (
                        <Input
                          type="datetime-local"
                          step="1"
                          max={maxDateTime}
                          value={toDateTimeLocal(field.value as unknown as string)}
                          onChange={(e) => field.onChange(toIso(e.target.value) as unknown as Date)}
                          aria-label={t("checkIn")}
                        />
                      )}
                    />
                    {sessionErr(i, "checkInAt") && (
                      <p role="alert" className="mt-1 text-xs text-destructive">
                        {sessionErr(i, "checkInAt")}
                      </p>
                    )}
                  </div>
                  <div>
                    <Controller
                      control={control}
                      name={`sessions.${i}.checkOutAt`}
                      render={({ field }) => (
                        <Input
                          type="datetime-local"
                          step="1"
                          max={maxDateTime}
                          value={toDateTimeLocal(field.value as unknown as string | null)}
                          onChange={(e) =>
                            field.onChange((toIso(e.target.value) ?? null) as unknown as Date | null)
                          }
                          aria-label={t("checkOut")}
                        />
                      )}
                    />
                    {sessionErr(i, "checkOutAt") && (
                      <p role="alert" className="mt-1 text-xs text-destructive">
                        {sessionErr(i, "checkOutAt")}
                      </p>
                    )}
                  </div>
                  <SessionRowDuration control={control} index={i} />
                  <Button
                    variant="destructive"
                    size="sm"
                    type="button"
                    onClick={() => fieldArray.remove(i)}
                    aria-label={t("removeSession")}
                  >
                    <X className="h-3.5 w-3.5" strokeWidth={1.75} />
                  </Button>
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                type="button"
                onClick={() => fieldArray.append({ checkInAt: "" as unknown as Date, checkOutAt: null })}
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
                {t("addSession")}
              </Button>
            </div>
          )}

          {/* errors.sessions?.message is a whole-array zod issue (e.g. the session-count cap) —
              never shown as raw zod text, mapped to a dedicated localized message instead. */}
          {(errors.root?.message || errors.sessions?.message) && (
            <Alert>{errors.root?.message ?? t("validation.tooManySessions")}</Alert>
          )}

          <div className="flex items-center justify-between border-t border-border pt-4">
            <span className="text-xs text-muted-foreground">
              {t("breakTotal", { minutes: formatMinutes(breakTotal(data.sessions)) })}
            </span>
            <div className="flex gap-2">
              {editing ? (
                <>
                  <Button type="button" variant="outline" onClick={cancelEdit}>
                    {tc("cancel")}
                  </Button>
                  <Button type="button" onClick={handleSubmit(onSubmit)} disabled={update.isPending}>
                    {update.isPending ? tc("saving") : tc("save")}
                  </Button>
                </>
              ) : (
                <>
                  <Button type="button" variant="outline" onClick={onClose}>
                    {tc("close")}
                  </Button>
                  {permissions.includes("attendance.edit") && (
                    <Button type="button" onClick={startEdit}>
                      {tc("edit")}
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        </form>
      )}
    </Dialog>
  );
}

function breakTotal(sessions: { breakMinutesBefore: number | null }[]): number {
  return sessions.reduce((sum, s) => sum + (s.breakMinutesBefore ?? 0), 0);
}

/** Sits between the Check-out field and the delete button — same height as the inputs. */
function SessionRowDuration({
  control,
  index,
}: {
  control: Control<UpdateAttendanceDayInput>;
  index: number;
}) {
  const row = useWatch({ control, name: `sessions.${index}` });
  const checkInAt = row?.checkInAt as unknown as string | undefined;
  const checkOutAt = row?.checkOutAt as unknown as string | null | undefined;
  const minutes =
    checkInAt && checkOutAt
      ? Math.round((new Date(checkOutAt).getTime() - new Date(checkInAt).getTime()) / 60_000)
      : null;

  return (
    <div className="flex h-9 items-center justify-center whitespace-nowrap px-1 text-xs text-muted-foreground">
      {minutes != null && minutes > 0 ? formatMinutes(minutes) : "—"}
    </div>
  );
}

function SummaryTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "positive" | "destructive";
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <p className="text-[10.5px] text-muted-foreground">{label}</p>
      <p
        className={
          tone === "positive"
            ? "mt-1 text-lg font-semibold text-positive"
            : tone === "destructive"
              ? "mt-1 text-lg font-semibold text-destructive"
              : "mt-1 text-lg font-semibold"
        }
      >
        {value}
      </p>
    </div>
  );
}

"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ChevronDown } from "lucide-react";
import { ApiError } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { usePermissions } from "@/lib/permissions";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useCheckIn, useCheckOut, useMyAttendanceToday } from "@/lib/queries/attendance";
import { formatTime } from "../attendance/attendance-time";
import { SessionsTable } from "../attendance/sessions-table";
import { RequestLeaveDialog } from "../leave/request-leave-dialog";

function formatMinutes(min: number | undefined): string {
  if (!min) return "—";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h ${m}m`;
}

/**
 * Self-service attendance + leave widget — the Dashboard module stays
 * static/placeholder otherwise (docs/MODULES/attendance.md screen 5).
 */
export function MyPanelWidget() {
  const t = useTranslations("dashboard.myPanel");
  const tSession = useTranslations("attendance.sessionDialog");
  const tc = useTranslations("common");
  const locale = useLocale();
  const { data, isLoading, error: todayError } = useMyAttendanceToday();
  const noEmployeeProfile =
    todayError instanceof ApiError && todayError.code === "ATTENDANCE_NO_EMPLOYEE_PROFILE";
  const checkIn = useCheckIn();
  const checkOut = useCheckOut();
  const permissions = usePermissions();
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const pending = checkIn.isPending || checkOut.isPending;
  const sessionCount = data?.sessions.length ?? 0;
  const status = !data ? null : data.isCheckedIn ? "checkedIn" : sessionCount > 0 ? "checkedOut" : "notCheckedIn";

  async function toggle() {
    setError(null);
    try {
      if (data?.isCheckedIn) {
        await checkOut.mutateAsync();
      } else {
        await checkIn.mutateAsync();
      }
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "NETWORK";
      setError(
        code === "ATTENDANCE_ALREADY_CHECKED_IN" || code === "ATTENDANCE_NOT_CHECKED_IN"
          ? t("staleState")
          : code === "ATTENDANCE_NO_EMPLOYEE_PROFILE"
            ? t("noEmployeeProfile")
            : tc("errors.GENERIC"),
      );
    }
  }

  return (
    <div className={cn("flex flex-col rounded-xl border border-border bg-card p-4", !expanded && "h-48")}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{t("title")}</p>
        {status && (
          <Badge variant={status === "checkedIn" ? "success" : "muted"}>{t(status)}</Badge>
        )}
      </div>

      <div className="mt-3 flex items-center gap-4">
        <Stat label={tSession("firstIn")} value={formatTime(data?.firstInAt, locale)} />
        <Stat label={tSession("lastOut")} value={formatTime(data?.lastOutAt, locale)} />
        <Stat label={t("worked")} value={formatMinutes(data?.totalWorkedMinutes)} />
      </div>

      <div className="mt-auto flex items-end justify-between gap-2 pt-3">
        <div className="flex items-center gap-3">
          {!isLoading ? (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              aria-label={expanded ? t("collapseAria") : t("expandAria")}
              className="flex items-center gap-1 text-xs font-medium text-muted-foreground transition hover:text-foreground"
            >
              <ChevronDown
                className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")}
                strokeWidth={1.75}
              />
              {t("sessionsToggle", { count: sessionCount })}
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={() => setRequestOpen(true)}
            className="text-xs font-medium text-muted-foreground transition hover:text-foreground"
          >
            {t("requestLeave")}
          </button>
        </div>

        <div className="flex flex-col items-end gap-1">
          {permissions.includes("attendance.mark") && !noEmployeeProfile && (
            <Button
              size="sm"
              variant={data?.isCheckedIn ? "destructive" : "primary"}
              onClick={toggle}
              disabled={isLoading || pending}
            >
              {pending ? tc("saving") : data?.isCheckedIn ? t("checkOutAction") : t("checkInAction")}
            </Button>
          )}
          {error && <Alert>{error}</Alert>}
        </div>
      </div>

      {expanded && (
        <div className="mt-3">
          <SessionsTable sessions={data?.sessions ?? []} />
        </div>
      )}

      <RequestLeaveDialog open={requestOpen} onClose={() => setRequestOpen(false)} allowOnBehalf={false} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10.5px] text-muted-foreground">{label}</p>
      <p className="text-sm font-medium tabular-nums">{value}</p>
    </div>
  );
}

"use client";

import { useLocale, useTranslations } from "next-intl";
import { Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useAttendanceMonthlyDetail } from "@/lib/queries/attendance";
import { formatTime } from "./attendance-time";
import { STATUS_BADGE_VARIANT } from "./attendance-status";

function formatMinutes(min: number): string {
  if (!min) return "—";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h ${m}m`;
}

function formatDay(d: Date | string): { dayNum: string; weekday: string } {
  const date = new Date(d);
  return {
    dayNum: String(date.getUTCDate()).padStart(2, "0"),
    weekday: date.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }),
  };
}

export function AttendanceMonthlyDetailDialog({
  target,
  month,
  onClose,
  onOpenDay,
}: {
  target: { employeeProfileId: string; name: string } | null;
  /** "YYYY-MM" — the month selected in the Monthly view (not "now"). */
  month: string;
  onClose: () => void;
  onOpenDay: (employeeProfileId: string, date: string) => void;
}) {
  const t = useTranslations("attendance.monthlyDetail");
  const tc = useTranslations("common");
  const locale = useLocale();
  const { data, isLoading } = useAttendanceMonthlyDetail(target?.employeeProfileId, month);

  return (
    <Dialog
      open={target !== null}
      onClose={onClose}
      title={target ? t("title", { name: target.name, month }) : ""}
      className="max-w-2xl"
    >
      {isLoading || !data ? (
        <p className="text-sm text-muted-foreground">{tc("loading")}</p>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
            <SummaryTile label={t("present")} value={String(data.summary.presentDays)} />
            <SummaryTile label={t("late")} value={String(data.summary.lateDays)} />
            <SummaryTile label={t("leave")} value={String(data.summary.leaveDays)} />
            <SummaryTile label={t("absent")} value={String(data.summary.absentDays)} />
            <SummaryTile label={t("totalHours")} value={formatMinutes(data.summary.totalWorkedMinutes)} />
            <SummaryTile label={t("rate")} value={`${data.summary.attendanceRatePct}%`} />
          </div>

          <div className="max-h-96 overflow-y-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="px-3 py-2 text-start">{t("date")}</th>
                  <th className="px-3 py-2 text-start">{t("day")}</th>
                  <th className="px-3 py-2 text-start">{t("status")}</th>
                  <th className="px-3 py-2 text-start">{t("checkIn")}</th>
                  <th className="px-3 py-2 text-start">{t("checkOut")}</th>
                  <th className="px-3 py-2 text-start">{t("hours")}</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {data.days.map((day) => {
                  const { dayNum, weekday } = formatDay(day.date);
                  const dateStr = new Date(day.date).toISOString().slice(0, 10);
                  return (
                    <tr key={dateStr} className="border-b border-border last:border-0">
                      <td className="px-3 py-2">{dayNum}</td>
                      <td className="px-3 py-2 text-muted-foreground">{weekday}</td>
                      <td className="px-3 py-2">
                        <Badge variant={STATUS_BADGE_VARIANT[day.status]}>
                          {t(`statusLabel.${day.status}`)}
                        </Badge>
                      </td>
                      <td className="px-3 py-2">{formatTime(day.firstInAt, locale)}</td>
                      <td className="px-3 py-2">{formatTime(day.lastOutAt, locale)}</td>
                      <td className="px-3 py-2">{formatMinutes(day.totalWorkedMinutes)}</td>
                      <td className="px-3 py-2">
                        {day.sessionCount > 0 && target && (
                          <button
                            type="button"
                            aria-label={t("viewLog")}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-input bg-card text-muted-foreground transition hover:bg-muted"
                            onClick={() => onOpenDay(target.employeeProfileId, dateStr)}
                          >
                            <Clock className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end border-t border-border pt-4">
            <Button variant="outline" onClick={onClose}>
              {tc("close")}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3 text-center">
      <p className="text-[10.5px] text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}

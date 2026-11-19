"use client";

import { useLocale, useTranslations } from "next-intl";
import type { AttendanceSession } from "@keystonehr/shared";
import { formatTime } from "./attendance-time";

function formatMinutes(min: number | null): string {
  if (min == null) return "—";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Read-only check-in/out log table — shared by the session dialog and the Dashboard My Panel widget. */
export function SessionsTable({ sessions }: { sessions: AttendanceSession[] }) {
  const t = useTranslations("attendance.sessionDialog");
  const locale = useLocale();

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
            <th className="px-3 py-2 text-start">#</th>
            <th className="px-3 py-2 text-start">{t("checkIn")}</th>
            <th className="px-3 py-2 text-start">{t("checkOut")}</th>
            <th className="px-3 py-2 text-start">{t("duration")}</th>
            <th className="px-3 py-2 text-start">{t("breakTime")}</th>
          </tr>
        </thead>
        <tbody>
          {sessions.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                {t("noSessions")}
              </td>
            </tr>
          ) : (
            sessions.map((s, i) => (
              <tr key={s.id} className="border-b border-border last:border-0">
                <td className="px-3 py-2">{i + 1}</td>
                <td className="px-3 py-2">{formatTime(s.checkInAt, locale)}</td>
                <td className="px-3 py-2">{formatTime(s.checkOutAt, locale)}</td>
                <td className="px-3 py-2">
                  {s.checkOutAt
                    ? formatMinutes(
                        Math.round((new Date(s.checkOutAt).getTime() - new Date(s.checkInAt).getTime()) / 60_000),
                      )
                    : "—"}
                </td>
                <td className="px-3 py-2">{formatMinutes(s.breakMinutesBefore)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

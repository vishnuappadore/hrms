import type { useTranslations } from "next-intl";
import type { LeaveRequestSummary } from "@keystonehr/shared";

export function formatDate(d: Date | string, locale: string): string {
  return new Date(d).toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

export function formatDateTime(d: Date | string, locale: string): string {
  return new Date(d).toLocaleString(locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

/** `leave.detailDialog`'s `firstHalf`/`secondHalf`/`halfDayShort` keys must be in scope on `t`. */
export function periodLabel(
  data: Pick<LeaveRequestSummary, "startDate" | "endDate" | "startHalfDay" | "endHalfDay" | "halfDayPeriod">,
  locale: string,
  t: ReturnType<typeof useTranslations>,
): string {
  const startLabel = formatDate(data.startDate, locale);
  const endLabel = formatDate(data.endDate, locale);

  if (startLabel === endLabel) {
    if (data.halfDayPeriod === "first_half") return `${startLabel} · ${t("firstHalf")}`;
    if (data.halfDayPeriod === "second_half") return `${startLabel} · ${t("secondHalf")}`;
    return startLabel;
  }

  const start = data.startHalfDay ? `${startLabel} (${t("halfDayShort")})` : startLabel;
  const end = data.endHalfDay ? `${endLabel} (${t("halfDayShort")})` : endLabel;
  return `${start} – ${end}`;
}

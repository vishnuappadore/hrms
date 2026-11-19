/** Formats a true-UTC check-in/out instant as local wall-clock time (viewer's browser timezone). */
export function formatTime(d: Date | string | null | undefined, locale: string): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(d));
}

/** Populates a `datetime-local` input from a true-UTC instant using LOCAL getters, so the
 *  input displays/edits in the viewer's browser timezone instead of the raw UTC clock fields. */
export function toDateTimeLocal(d: Date | string | null): string {
  if (!d) return "";
  const date = new Date(d);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * `datetime-local` omits the seconds sub-field from its value whenever it's exactly
 * `:00` — even with `step="1"` — so the string is either 16 chars ("...THH:mm") or 19
 * ("...THH:mm:ss"). Interprets the typed value as LOCAL time (browser tz) and converts
 * it to the correct UTC instant — the inverse of `toDateTimeLocal`.
 */
export function toIso(dateTimeLocal: string): string | undefined {
  // Empty / partially-typed values (Firefox reports "" mid-edit) must stay unset so the
  // schema's "check-in required" error fires — never coerce missing parts to 0 (→ 1899).
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(dateTimeLocal);
  if (!m) return undefined;
  const [year, month, day, hour, minute, second] = m.slice(1).map((v) => Number(v ?? 0)) as [
    number, number, number, number, number, number,
  ];
  const date = new Date(year, month - 1, day, hour, minute, second);
  // `new Date(y, …)` maps years 0–99 to 19xx; pin the typed year explicitly.
  date.setFullYear(year);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

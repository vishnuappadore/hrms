"use client";

import { useMemo } from "react";
import { useTheme } from "next-themes";
import { useLocale, useTranslations } from "next-intl";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatMoney, type RevenueOverviewPoint } from "@keystonehr/shared";

/**
 * Validated categorical slots (dataviz skill, references/palette.md) — blue/orange/aqua, the
 * only three that clear the all-pairs CVD floor in both modes. Almost always a single series
 * (one currency) in practice; a 4th+ currency folds into "Other" rather than reusing a slot.
 */
const SERIES_COLORS = {
  light: ["#2a78d6", "#eb6834", "#1baf7a"],
  dark: ["#3987e5", "#d95926", "#199e70"],
};

export function RevenueOverviewChart({ data }: { data?: RevenueOverviewPoint[] }) {
  const t = useTranslations("dashboard.kpis");
  const locale = useLocale();
  const { resolvedTheme } = useTheme();
  const seriesColors = SERIES_COLORS[resolvedTheme === "dark" ? "dark" : "light"];

  const { currencies, rows } = useMemo(() => {
    const currencySet = new Set<string>();
    for (const point of data ?? []) {
      for (const c of point.byCurrency) currencySet.add(c.currency);
    }
    const currencies = [...currencySet].slice(0, 3);
    const rows = (data ?? []).map((point) => {
      const row: Record<string, number | string> = { date: point.date };
      for (const currency of currencies) {
        row[currency] = point.byCurrency.find((c) => c.currency === currency)?.amountMinor ?? 0;
      }
      return row;
    });
    return { currencies, rows };
  }, [data]);

  const dateFmt = new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en", { day: "numeric", month: "short" });

  if (!data) {
    return (
      <div className="flex h-48 flex-col rounded-xl border border-border bg-card p-4">
        <p className="text-sm font-medium">{t("revenueOverview")}</p>
        <div className="mt-2 flex flex-1 animate-pulse items-center justify-center rounded-lg bg-muted" />
      </div>
    );
  }

  return (
    <div className="flex h-64 flex-col rounded-xl border border-border bg-card p-4 shadow-sm">
      <p className="mb-2 text-sm font-medium">{t("revenueOverview")}</p>
      {rows.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
          {t("noData")}
        </div>
      ) : (
        <div className="min-h-0 flex-1">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={(v: string) => dateFmt.format(new Date(v))}
                tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                axisLine={{ stroke: "var(--border)" }}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={36}
                tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                labelFormatter={(v) => (typeof v === "string" ? dateFmt.format(new Date(v)) : v)}
                formatter={(value, name) => [
                  formatMoney(typeof value === "number" ? value : Number(value ?? 0), String(name), locale),
                  String(name),
                ]}
              />
              {currencies.map((currency, i) => (
                <Line
                  key={currency}
                  type="monotone"
                  dataKey={currency}
                  name={currency}
                  stroke={seriesColors[i]}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      {currencies.length > 1 && (
        <div className="mt-2 flex flex-wrap gap-3">
          {currencies.map((currency, i) => (
            <span key={currency} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span
                aria-hidden="true"
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: seriesColors[i] }}
              />
              {currency}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

import type { LucideIcon } from "lucide-react";
import { TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/cn";

interface KpiCardProps {
  label: string;
  value?: number | string;
  icon: LucideIcon;
  loading?: boolean;
  /** vs-previous-period badge (e.g. Dashboard's Revenue/Appointments KPIs). `pct` null = the
   *  prior period had zero (undefined %) — rendered as a flat dash, not 0%/∞%. */
  delta?: { pct: number | null };
  /** "compact" shrinks padding/icon/value sizing (e.g. Customer Details' denser profile layout) —
   *  defaults to "default" so every existing consumer is unaffected. */
  size?: "default" | "compact";
}

/**
 * Stat tile: label in muted ink, value in foreground with proportional figures
 * (tabular-nums is reserved for aligned table columns); the icon carries the accent.
 */
export function KpiCard({ label, value, icon: Icon, loading, delta, size = "default" }: KpiCardProps) {
  const compact = size === "compact";
  return (
    <div
      className={cn(
        "flex items-center rounded-xl border border-border bg-card shadow-sm",
        compact ? "gap-2.5 p-3" : "gap-3.5 p-4",
      )}
    >
      <span
        className={cn(
          "flex shrink-0 items-center justify-center rounded-lg bg-primary-muted text-primary",
          compact ? "h-8 w-8" : "h-10 w-10",
        )}
      >
        <Icon className={compact ? "h-4 w-4" : "h-5 w-5"} strokeWidth={1.75} aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-muted-foreground">{label}</p>
        {loading ? (
          <div className="mt-1.5 h-6 w-12 animate-pulse rounded bg-muted" />
        ) : (
          <>
            <p className={cn("font-semibold", compact ? "text-xl leading-6" : "text-2xl leading-7")}>
              {value ?? "—"}
            </p>
            {delta && (
              <p
                className={cn(
                  "mt-0.5 flex items-center gap-1 text-[11px] font-medium",
                  delta.pct === null
                    ? "text-muted-foreground"
                    : delta.pct > 0
                      ? "text-positive"
                      : delta.pct < 0
                        ? "text-destructive"
                        : "text-muted-foreground",
                )}
              >
                {delta.pct !== null && delta.pct !== 0 ? (
                  delta.pct > 0 ? (
                    <TrendingUp className="h-3 w-3" strokeWidth={1.75} aria-hidden="true" />
                  ) : (
                    <TrendingDown className="h-3 w-3" strokeWidth={1.75} aria-hidden="true" />
                  )
                ) : null}
                {delta.pct === null ? "—" : `${delta.pct > 0 ? "+" : ""}${delta.pct}%`}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type StatTileVariant = "default" | "compact" | "highlighted" | "dense";

const TILE_CLASS: Record<StatTileVariant, string> = {
  default: "rounded-lg border border-border bg-muted/40 p-3",
  compact: "rounded-lg border border-border bg-muted/40 p-3",
  highlighted: "rounded-lg border border-primary/30 bg-primary-muted p-3",
  dense: "rounded-lg border border-border/70 p-2 text-center",
};
const LABEL_CLASS: Record<StatTileVariant, string> = {
  default: "text-[10.5px] text-muted-foreground",
  compact: "text-[10.5px] text-muted-foreground",
  highlighted: "text-[10.5px] text-muted-foreground",
  dense: "text-[10px] text-muted-foreground",
};
const VALUE_CLASS: Record<StatTileVariant, string> = {
  default: "mt-1 text-lg font-semibold",
  compact: "text-sm font-medium",
  highlighted: "mt-1 text-lg font-semibold text-primary",
  dense: "mt-0.5 font-semibold",
};

/** Small label/value tile for dialog summaries — distinct from KpiCard (icon + page-header sized). */
export function StatTile({
  label,
  value,
  variant = "default",
}: {
  label: string;
  value: ReactNode;
  variant?: StatTileVariant;
}) {
  return (
    <div className={TILE_CLASS[variant]}>
      <div className={LABEL_CLASS[variant]}>{label}</div>
      <div className={cn(VALUE_CLASS[variant])}>{value}</div>
    </div>
  );
}

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type BadgeVariant = "success" | "muted" | "destructive" | "warning" | "info" | "platinum" | "bronze";

const VARIANTS: Record<BadgeVariant, string> = {
  success: "bg-positive/10 text-positive",
  muted: "bg-muted text-muted-foreground",
  destructive: "bg-destructive/10 text-destructive",
  warning: "bg-warning/10 text-warning",
  info: "bg-info/10 text-info",
  platinum: "bg-tier-platinum/10 text-tier-platinum",
  bronze: "bg-tier-bronze/10 text-tier-bronze",
};

export function Badge({ variant = "muted", children }: { variant?: BadgeVariant; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
        VARIANTS[variant],
      )}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
      {children}
    </span>
  );
}

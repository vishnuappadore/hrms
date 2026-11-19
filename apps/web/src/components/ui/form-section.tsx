import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface FormSectionProps {
  title?: string;
  className?: string;
  /** Single-column body (space-y-2) instead of the default 2-col grid. */
  wide?: boolean;
  children: ReactNode;
}

/** Card + optional heading + field grid — shared by Staff/Branch/Service forms. */
export function FormSection({ title, className, wide, children }: FormSectionProps) {
  return (
    <section className={cn("rounded-xl border border-border bg-card p-5", className)}>
      {title && (
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      )}
      <div className={wide ? "space-y-2" : "grid grid-cols-1 gap-4 sm:grid-cols-2"}>{children}</div>
    </section>
  );
}

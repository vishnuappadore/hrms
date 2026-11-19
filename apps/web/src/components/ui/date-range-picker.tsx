"use client";

import { cn } from "@/lib/cn";
import { Input } from "./input";

/** Two native date inputs (From/To), following the same `<input type="date">` convention as Attendance/Payroll — no date-picker library in this app. */
export function DateRangePicker({
  from,
  to,
  onChange,
  fromLabel,
  toLabel,
  className,
}: {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  fromLabel: string;
  toLabel: string;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <Input
        type="date"
        value={from}
        onChange={(e) => onChange(e.target.value, to)}
        aria-label={fromLabel}
        className="min-w-0 max-w-40"
      />
      <span aria-hidden="true" className="text-sm text-muted-foreground">
        –
      </span>
      <Input
        type="date"
        value={to}
        onChange={(e) => onChange(from, e.target.value)}
        aria-label={toLabel}
        className="min-w-0 max-w-40"
      />
    </div>
  );
}

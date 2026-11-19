"use client";

import { cn } from "@/lib/cn";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedControlProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T | undefined;
  onChange: (value: T) => void;
  "aria-label"?: string;
}

/** Single-select pill group (radiogroup semantics) — Gender, Employee Status, Employment Type. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ...aria
}: SegmentedControlProps<T>) {
  return (
    <div role="radiogroup" {...aria} className="flex flex-wrap gap-2">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "rounded-lg border px-3 py-1.5 text-[12.5px] font-medium transition",
            value === option.value
              ? "border-primary bg-primary-muted text-primary"
              : "border-input bg-card text-muted-foreground hover:bg-muted",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

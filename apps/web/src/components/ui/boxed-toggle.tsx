"use client";

import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

export interface BoxedToggleOption<T extends string> {
  value: T;
  label: string;
  icon?: LucideIcon;
}

interface BoxedToggleProps<T extends string> {
  value: T;
  options: BoxedToggleOption<T>[];
  onChange: (value: T) => void;
  "aria-label"?: string;
  /** Set false when the toggle already sits inside a shadowed container (e.g. a settings card) —
   *  avoids stacking a second shadow on top of the parent's. Defaults to true. */
  shadow?: boolean;
}

/** Boxed track + solid-active-pill toggle — Appointments' original view-switcher design, shared. */
export function BoxedToggle<T extends string>({
  value,
  options,
  onChange,
  "aria-label": ariaLabel,
  shadow = true,
}: BoxedToggleProps<T>) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn("inline-flex rounded-lg border border-input bg-card p-0.5", shadow && "shadow-sm")}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition",
            value === option.value
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option.icon && <option.icon className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />}
          {option.label}
        </button>
      ))}
    </div>
  );
}

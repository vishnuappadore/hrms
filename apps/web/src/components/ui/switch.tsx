"use client";

import { cn } from "@/lib/cn";

interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
}

/** Thumb moves via logical margin (ms-*), so it mirrors correctly in RTL. */
export function Switch({ checked, onCheckedChange, disabled, id, ...aria }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      id={id}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
        "focus:outline-none focus:ring-2 focus:ring-ring/40",
        "disabled:cursor-not-allowed disabled:opacity-60",
        checked ? "bg-primary" : "bg-input",
      )}
      {...aria}
    >
      <span
        className={cn(
          "h-4 w-4 rounded-full bg-card shadow-sm transition-[margin]",
          checked ? "ms-[18px]" : "ms-0.5",
        )}
      />
    </button>
  );
}

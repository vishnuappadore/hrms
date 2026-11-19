import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

interface ChipProps {
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
}

/** Toggleable pill button for chip-style multi-select. */
export function Chip({ pressed, onClick, children }: ChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      className={cn(
        "rounded-full border px-3 py-1.5 text-xs font-medium transition",
        pressed
          ? "border-primary bg-primary-muted text-primary"
          : "border-input bg-card text-muted-foreground hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}

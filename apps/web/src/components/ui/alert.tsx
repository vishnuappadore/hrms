import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** The one error-banner treatment for the whole app — page/form/dialog-level, not per-field hints
 *  (Field already owns those). */
export function Alert({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p role="alert" className={cn("rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive", className)}>
      {children}
    </p>
  );
}

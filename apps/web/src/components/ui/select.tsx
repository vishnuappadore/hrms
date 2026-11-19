import { ChevronDown } from "lucide-react";
import { forwardRef, type SelectHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...props }, ref) {
    return (
      <div className={cn("relative", className)}>
        <select
          ref={ref}
          className={cn(
            "h-9 w-full appearance-none rounded-lg border border-input bg-card ps-3 pe-8 text-[12.5px] text-foreground shadow-sm outline-none transition",
            "focus:border-ring focus:ring-2 focus:ring-ring/25",
            "disabled:cursor-not-allowed disabled:opacity-60",
          )}
          {...props}
        >
          {children}
        </select>
        <ChevronDown
          aria-hidden="true"
          strokeWidth={1.75}
          className="pointer-events-none absolute end-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
        />
      </div>
    );
  },
);

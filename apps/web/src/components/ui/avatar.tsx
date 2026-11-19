import { cn } from "@/lib/cn";

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/** Initials placeholder — same shape as Payroll's employee cell (payroll-table.tsx), shared here.
 *  Pass `src` (e.g. a Customer's `photoUrl`) to render a real image instead, clipped to the same
 *  rounding; falls back to initials when absent. */
export function Avatar({ name, src, className }: { name: string; src?: string | null; className?: string }) {
  return (
    <span
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-primary-muted text-[11px] font-semibold text-primary",
        className,
      )}
    >
      {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : initials(name)}
    </span>
  );
}

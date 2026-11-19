import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

export interface TimelineRowProps {
  icon: LucideIcon;
  /** Text-color utility class for the icon badge, e.g. "text-positive" or "text-destructive". */
  iconClassName: string;
  label: ReactNode;
  timestamp: ReactNode;
  note?: ReactNode;
  isLast: boolean;
}

/** Connected-dot history row — shared by Appointments/Leave/Customers detail views. Each caller
 *  keeps its own icon/label-resolution logic and only passes the resolved row data. */
export function TimelineRow({ icon: Icon, iconClassName, label, timestamp, note, isLast }: TimelineRowProps) {
  return (
    <div className="relative ps-7 pb-4 last:pb-0">
      {!isLast && <div className="absolute start-2.5 top-5 bottom-[-4px] w-px bg-border" />}
      <span
        className={cn(
          "absolute start-0 top-0 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-card",
          iconClassName,
        )}
      >
        <Icon className="h-3 w-3" strokeWidth={2} />
      </span>
      <p className="text-xs font-medium">{label}</p>
      <p className="text-[10.5px] text-muted-foreground">{timestamp}</p>
      {note ? <p className="mt-0.5 text-[10.5px] text-muted-foreground">{note}</p> : null}
    </div>
  );
}

import { cn } from "@/lib/cn";

export interface StepperStep {
  key: string;
  title: string;
}

/** Progress header for a multi-step wizard: step names + a filled progress bar. Pass
 * `onStepClick` to make the step labels jump straight to that step (edit mode); omit it to
 * keep the labels display-only (create mode, where earlier steps may not be filled in yet). */
export function Stepper({
  steps,
  current,
  onStepClick,
}: {
  steps: StepperStep[];
  current: number;
  onStepClick?: (index: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex gap-1.5">
        {steps.map((s, i) => (
          <div
            key={s.key}
            className={cn(
              "h-1 flex-1 rounded-full transition-colors",
              i <= current ? "bg-primary" : "bg-input",
            )}
          />
        ))}
      </div>
      <div className="flex gap-1.5 text-[11px] font-medium">
        {steps.map((s, i) => {
          const toneClass = i === current ? "text-primary" : i < current ? "text-foreground" : "text-muted-foreground";
          return onStepClick ? (
            <button
              key={s.key}
              type="button"
              onClick={() => onStepClick(i)}
              className={cn("flex-1 truncate text-start hover:underline", toneClass)}
            >
              {s.title}
            </button>
          ) : (
            <span key={s.key} className={cn("flex-1 truncate text-start", toneClass)}>
              {s.title}
            </span>
          );
        })}
      </div>
    </div>
  );
}

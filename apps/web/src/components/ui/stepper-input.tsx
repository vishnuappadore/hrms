import { Minus, Plus } from "lucide-react";

interface StepperInputProps {
  id?: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  "aria-label"?: string;
}

/** +/- numeric stepper for small bounded counts (e.g. chairs, seats). */
export function StepperInput({
  id,
  value,
  onChange,
  min = 0,
  max = 999,
  step = 1,
  ...aria
}: StepperInputProps) {
  return (
    <div className="inline-flex h-9 items-center rounded-lg border border-input bg-card shadow-sm">
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - step))}
        disabled={value <= min}
        aria-label="decrease"
        className="flex h-full w-9 items-center justify-center text-muted-foreground transition hover:bg-muted disabled:opacity-40"
      >
        <Minus className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
      </button>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        readOnly
        value={value}
        className="h-full w-12 border-x border-input bg-transparent text-center text-sm tabular-nums outline-none"
        {...aria}
      />
      <button
        type="button"
        onClick={() => onChange(Math.min(max, value + step))}
        disabled={value >= max}
        aria-label="increase"
        className="flex h-full w-9 items-center justify-center text-muted-foreground transition hover:bg-muted disabled:opacity-40"
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
      </button>
    </div>
  );
}

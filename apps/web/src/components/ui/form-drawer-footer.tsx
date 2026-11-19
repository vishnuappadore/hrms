import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

/** The simple Close+Save drawer-form footer (Customers, Walk-in Queue). Appointments' multi-step
 *  wizard footer is a genuinely different shape (Cancel/Back/Next-or-Submit) and stays bespoke. */
export function FormDrawerFooter({
  onClose,
  closeLabel,
  submitLabel,
  submitting,
  canSubmit = true,
}: {
  onClose: () => void;
  closeLabel: string;
  submitLabel: ReactNode;
  submitting?: boolean;
  canSubmit?: boolean;
}) {
  return (
    <div className="flex items-center justify-end gap-3 border-t border-border pt-4">
      <Button variant="outline" type="button" onClick={onClose}>
        {closeLabel}
      </Button>
      {canSubmit && (
        <Button type="submit" disabled={submitting}>
          {submitLabel}
        </Button>
      )}
    </div>
  );
}

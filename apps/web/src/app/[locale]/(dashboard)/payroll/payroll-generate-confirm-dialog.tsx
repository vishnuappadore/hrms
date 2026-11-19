"use client";

import { useTranslations } from "next-intl";
import type { PayrollRunPreview } from "@keystonehr/shared";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { StatTile } from "@/components/ui/stat-tile";

export interface GenerateConfirmState {
  branchName: string;
  monthLabel: string;
  preview: PayrollRunPreview;
}

/**
 * Shown before actually calling POST /payroll/runs — lets the admin see how
 * many employees will be added and the existing run's status breakdown before
 * committing. Counts come from a point-in-time preview call; see
 * PayrollRunPreviewSchema's doc comment for why they can't literally always
 * match the outcome (another admin could change employee data in between).
 */
export function PayrollGenerateConfirmDialog({
  state,
  onClose,
  onConfirm,
  isPending,
}: {
  state: GenerateConfirmState | null;
  onClose: () => void;
  onConfirm: () => void;
  isPending: boolean;
}) {
  const t = useTranslations("payroll.generateConfirm");
  const ts = useTranslations("payroll.status");
  const tc = useTranslations("common");

  const preview = state?.preview;
  const statusRows: { key: "pending" | "approved" | "rejected" | "paid" }[] = [
    { key: "pending" },
    { key: "approved" },
    { key: "rejected" },
    { key: "paid" },
  ];

  return (
    <Dialog open={state !== null} onClose={onClose} title={t("title")}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <StatTile label={t("branch")} value={state?.branchName} />
          <StatTile label={t("period")} value={state?.monthLabel} />
        </div>

        {preview && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <StatTile variant="highlighted" label={t("newEmployees")} value={preview.newEmployeeCount} />
              <StatTile label={t("totalEmployees")} value={preview.totalEmployeeCount} />
            </div>

            {preview.runExists && (
              <div>
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("existingStatus")}
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {statusRows.map((row) => (
                    <StatTile key={row.key} variant="dense" label={ts(row.key)} value={preview.statusCounts[row.key]} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        <div className="flex items-center justify-end gap-3 border-t border-border pt-4">
          <Button variant="outline" onClick={onClose}>
            {tc("cancel")}
          </Button>
          <Button disabled={isPending} onClick={onConfirm}>
            {isPending ? tc("saving") : t("confirm")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

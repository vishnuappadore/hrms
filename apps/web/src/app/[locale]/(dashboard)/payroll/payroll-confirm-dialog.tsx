"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { formatMoney, type PayrollItemSummary } from "@keystonehr/shared";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { StatTile } from "@/components/ui/stat-tile";

export type PayrollConfirmState =
  | { action: "approve" | "reject"; items: PayrollItemSummary[] }
  | { action: "approve" | "reject"; selectAllCount: number };

/**
 * Generic approve/reject confirm — covers both a single row's quick action
 * and the bulk toolbar (docs/MODULES/payroll.md: bulk applies only in the
 * Pending tab). Mark Paid and Revert act immediately without this dialog.
 */
export function PayrollConfirmDialog({
  state,
  onClose,
  onConfirm,
  isPending,
}: {
  state: PayrollConfirmState | null;
  onClose: () => void;
  onConfirm: (reason?: string) => void;
  isPending: boolean;
}) {
  const t = useTranslations("payroll.confirm");
  const tc = useTranslations("common");
  const locale = useLocale();
  const [reason, setReason] = useState("");

  function close() {
    setReason("");
    onClose();
  }

  const items = state && "items" in state ? state.items : [];
  const selectAllCount = state && "selectAllCount" in state ? state.selectAllCount : null;
  const total = items.reduce((sum, i) => sum + i.netPayMinor, 0);
  const currency = items[0]?.currency ?? "OMR";
  const isApprove = state?.action === "approve";

  return (
    <Dialog open={state !== null} onClose={close} title={isApprove ? t("approveTitle") : t("rejectTitle")}>
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{isApprove ? t("approveBody") : t("rejectBody")}</p>
        {selectAllCount !== null ? (
          <StatTile label={t("staffCount")} value={selectAllCount} />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <StatTile label={t("staffCount")} value={items.length} />
              <StatTile label={t("amount")} value={formatMoney(total, currency, locale)} />
            </div>
            <div className="max-h-48 space-y-1.5 overflow-y-auto">
              {items.map((i) => (
                <div
                  key={i.id}
                  className="flex items-center justify-between rounded-lg border border-border/70 px-3 py-2 text-sm"
                >
                  <span className="truncate">{i.staff.name}</span>
                  <span className="font-medium">{formatMoney(i.netPayMinor, i.currency, locale)}</span>
                </div>
              ))}
            </div>
          </>
        )}
        {!isApprove && (
          <Field label={t("reasonLabel")} htmlFor="reject-reason">
            <Input id="reject-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        )}
        <div className="flex items-center justify-end gap-3">
          <Button variant="outline" onClick={close}>
            {tc("cancel")}
          </Button>
          <Button
            variant={isApprove ? "primary" : "destructive"}
            disabled={isPending}
            onClick={() => onConfirm(reason || undefined)}
          >
            {isPending ? tc("saving") : isApprove ? t("confirmApprove") : t("confirmReject")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

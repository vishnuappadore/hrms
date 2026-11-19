"use client";

import { useTranslations } from "next-intl";
import type { LeaveRequestSummary } from "@keystonehr/shared";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

/** Confirms withdrawing your own still-pending request — no reason needed, nothing's been applied yet. */
export function WithdrawLeaveDialog({
  target,
  onClose,
  onConfirm,
  isPending,
}: {
  /** null = closed */
  target: LeaveRequestSummary | null;
  onClose: () => void;
  onConfirm: () => void;
  isPending: boolean;
}) {
  const t = useTranslations("leave.withdrawDialog");
  const tc = useTranslations("common");

  return (
    <Dialog open={target !== null} onClose={onClose} title={t("title")}>
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{t("body")}</p>
        <div className="flex items-center justify-end gap-3">
          <Button variant="outline" onClick={onClose}>
            {tc("cancel")}
          </Button>
          <Button variant="destructive" disabled={isPending} onClick={onConfirm}>
            {isPending ? tc("saving") : t("confirm")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

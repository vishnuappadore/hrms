"use client";

import { useTranslations } from "next-intl";
import type { LeaveRequestSummary } from "@keystonehr/shared";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

/** Confirms Approve before it fires — deducts the balance, so a misclick shouldn't do that silently. */
export function ApproveLeaveDialog({
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
  const t = useTranslations("leave.approveDialog");
  const tc = useTranslations("common");

  return (
    <Dialog open={target !== null} onClose={onClose} title={t("title", { name: target?.staff.name ?? "" })}>
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{t("body")}</p>
        <div className="flex items-center justify-end gap-3">
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

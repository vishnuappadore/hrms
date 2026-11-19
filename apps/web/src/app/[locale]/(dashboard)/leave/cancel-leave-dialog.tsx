"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { LeaveRequestSummary } from "@keystonehr/shared";
import { ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { useCancelLeaveRequest } from "@/lib/queries/leave";

/** Confirms cancelling an already-approved request — reverses its balance deduction and attendance marking. */
export function CancelLeaveDialog({
  target,
  onClose,
}: {
  /** null = closed */
  target: LeaveRequestSummary | null;
  onClose: () => void;
}) {
  const t = useTranslations("leave.cancelDialog");
  const tLeave = useTranslations("leave");
  const tc = useTranslations("common");
  const cancel = useCancelLeaveRequest();
  const { showToast } = useToast();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setReason("");
    setError(null);
  }, [target?.id]);

  async function confirm() {
    if (!target) return;
    if (!reason.trim()) {
      setError(t("reasonRequired"));
      return;
    }
    setError(null);
    try {
      await cancel.mutateAsync({ id: target.id, input: { cancellationReason: reason.trim() } });
      showToast(tLeave("toast.cancelled"));
      onClose();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "NETWORK";
      setError(code === "LEAVE_REQUEST_NOT_APPROVED" ? t("notApproved") : tc("errors.GENERIC"));
    }
  }

  return (
    <Dialog open={target !== null} onClose={onClose} title={t("title", { name: target?.staff.name ?? "" })}>
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{t("body")}</p>
        <Field label={t("reason")} htmlFor="cancel-reason" required error={error ?? undefined}>
          <textarea
            id="cancel-reason"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full rounded-lg border border-input bg-card px-3 py-2 text-[12.5px] text-foreground shadow-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/25"
          />
        </Field>
        <div className="flex items-center justify-end gap-3">
          <Button variant="outline" onClick={onClose}>
            {tc("cancel")}
          </Button>
          <Button variant="destructive" disabled={cancel.isPending} onClick={confirm}>
            {cancel.isPending ? tc("saving") : t("confirm")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

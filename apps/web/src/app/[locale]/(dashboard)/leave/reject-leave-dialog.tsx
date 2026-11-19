"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { LeaveRequestSummary } from "@keystonehr/shared";
import { ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { useRejectLeaveRequest } from "@/lib/queries/leave";

export function RejectLeaveDialog({
  target,
  onClose,
}: {
  /** null = closed */
  target: LeaveRequestSummary | null;
  onClose: () => void;
}) {
  const t = useTranslations("leave.rejectDialog");
  const tLeave = useTranslations("leave");
  const tc = useTranslations("common");
  const reject = useRejectLeaveRequest();
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
      await reject.mutateAsync({ id: target.id, input: { rejectionReason: reason.trim() } });
      showToast(tLeave("toast.rejected"));
      onClose();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "NETWORK";
      setError(code === "LEAVE_REQUEST_NOT_PENDING" ? t("alreadyResolved") : tc("errors.GENERIC"));
    }
  }

  return (
    <Dialog open={target !== null} onClose={onClose} title={t("title", { name: target?.employee.name ?? "" })}>
      <div className="space-y-4">
        <Field label={t("reason")} htmlFor="reject-reason" required error={error ?? undefined}>
          <textarea
            id="reject-reason"
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
          <Button variant="destructive" disabled={reject.isPending} onClick={confirm}>
            {reject.isPending ? tc("saving") : t("confirm")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

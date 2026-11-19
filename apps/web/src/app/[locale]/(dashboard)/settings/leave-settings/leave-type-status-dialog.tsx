"use client";

import { useLocale, useTranslations } from "next-intl";
import type { LeaveType } from "@keystonehr/shared";
import { usePermissions } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

/** Confirms Activate/Deactivate before it fires, so a misclick can't silently flip a leave type. */
export function LeaveTypeStatusDialog({
  type,
  onClose,
  onConfirm,
  isPending,
}: {
  /** null = closed */
  type: LeaveType | null;
  onClose: () => void;
  onConfirm: () => void;
  isPending: boolean;
}) {
  const t = useTranslations("settings.leaveSettings");
  const tc = useTranslations("common");
  const locale = useLocale();
  const permissions = usePermissions();
  const isActive = type?.isActive ?? false;
  const name = (locale === "ar" ? type?.nameAr : type?.nameEn) ?? "";

  return (
    <Dialog
      open={type !== null}
      onClose={onClose}
      title={isActive ? t("confirmDeactivateTitle") : t("confirmActivateTitle")}
    >
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {isActive ? t("confirmDeactivateBody", { name }) : t("confirmActivateBody", { name })}
        </p>
        <div className="flex items-center justify-end gap-3">
          <Button variant="outline" onClick={onClose}>
            {tc("cancel")}
          </Button>
          {permissions.includes("leave.settings.manage") && (
            <Button variant={isActive ? "destructive" : "primary"} disabled={isPending} onClick={onConfirm}>
              {isPending ? tc("saving") : isActive ? tc("deactivate") : t("activate")}
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { RoleSummary } from "@keystonehr/shared";
import { ApiError } from "@/lib/api-client";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { useDeleteRole } from "@/lib/queries/roles";

export function RoleDeleteDialog({
  target,
  onClose,
}: {
  /** null = closed */
  target: RoleSummary | null;
  onClose: () => void;
}) {
  const t = useTranslations("settings.roles");
  const tc = useTranslations("common");
  const locale = useLocale();
  const remove = useDeleteRole();
  const { showToast } = useToast();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
  }, [target?.id]);

  async function confirm() {
    if (!target) return;
    setError(null);
    try {
      await remove.mutateAsync(target.id);
      showToast(t("roleDeleted"));
      onClose();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "NETWORK";
      setError(code === "ROLE_IN_USE" ? t("errors.roleInUse") : tc("errors.GENERIC"));
    }
  }

  return (
    <Dialog
      open={target !== null}
      onClose={onClose}
      title={t("deleteTitle", { name: (locale === "ar" ? target?.nameAr : target?.nameEn) ?? "" })}
    >
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{t("deleteBody")}</p>
        {error && <Alert>{error}</Alert>}
        <div className="flex items-center justify-end gap-3">
          <Button variant="outline" onClick={onClose}>
            {tc("cancel")}
          </Button>
          <Button variant="destructive" disabled={remove.isPending} onClick={confirm}>
            {remove.isPending ? tc("saving") : tc("remove")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

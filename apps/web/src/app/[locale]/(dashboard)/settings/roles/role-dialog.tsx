"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { RoleSummary } from "@keystonehr/shared";
import { ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useCreateRole, useUpdateRole } from "@/lib/queries/roles";

/** Create (role = null) or rename (role set) a role — the permission grid is a separate dialog. */
export function RoleDialog({
  open,
  role,
  onClose,
  onCreated,
}: {
  open: boolean;
  /** null = create mode */
  role: RoleSummary | null;
  onClose: () => void;
  /** Fired after a successful create, so the caller can immediately open the permission grid. */
  onCreated: (roleId: string) => void;
}) {
  const t = useTranslations("settings.roles");
  const tc = useTranslations("common");
  const create = useCreateRole();
  const update = useUpdateRole(role?.id ?? "");
  const pending = create.isPending || update.isPending;

  const [nameEn, setNameEn] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setNameEn(role?.nameEn ?? "");
      setNameAr(role?.nameAr ?? "");
      setError(null);
    }
  }, [open, role]);

  async function submit() {
    if (!nameEn.trim() || !nameAr.trim()) {
      setError(t("validation.nameRequired"));
      return;
    }
    setError(null);
    try {
      if (role) {
        await update.mutateAsync({
          nameEn: nameEn.trim(),
          nameAr: nameAr.trim(),
          // permissionKeys deliberately omitted: a rename must never touch the permission set.
        });
        onClose();
      } else {
        const created = await create.mutateAsync({
          nameEn: nameEn.trim(),
          nameAr: nameAr.trim(),
          permissionKeys: [],
        });
        onClose();
        onCreated(created.id);
      }
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "NETWORK";
      setError(code === "NAME_EXISTS" ? t("errors.nameExists") : tc("errors.GENERIC"));
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={role ? t("renameRole") : t("newRole")} showCloseButton closeLabel={tc("close")}>
      <div className="space-y-4">
        <Field label={t("roleNameEn")} htmlFor="role-name-en" required error={error ?? undefined}>
          <Input id="role-name-en" value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
        </Field>
        <Field label={t("roleNameAr")} htmlFor="role-name-ar" required>
          <Input id="role-name-ar" dir="rtl" value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
        </Field>
        <div className="flex items-center justify-end gap-3">
          <Button variant="outline" onClick={onClose}>
            {tc("cancel")}
          </Button>
          <Button disabled={pending} onClick={submit}>
            {pending ? tc("saving") : tc("save")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

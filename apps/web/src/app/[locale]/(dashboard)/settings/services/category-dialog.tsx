"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { ServiceCategory } from "@keystonehr/shared";
import { ApiError } from "@/lib/api-client";
import { usePermissions } from "@/lib/permissions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  useCreateServiceCategory,
  useUpdateServiceCategory,
} from "@/lib/queries/services";

type DialogState = { mode: "create" } | { mode: "edit"; category: ServiceCategory } | null;

export function CategoryDialog({ state, onClose }: { state: DialogState; onClose: () => void }) {
  const t = useTranslations("services.categoryDialog");
  const tc = useTranslations("common");
  const create = useCreateServiceCategory();
  const update = useUpdateServiceCategory();
  const permissions = usePermissions();
  const [nameEn, setNameEn] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (state?.mode === "edit") {
      setNameEn(state.category.nameEn);
      setNameAr(state.category.nameAr);
    } else if (state?.mode === "create") {
      setNameEn("");
      setNameAr("");
    }
    setError(null);
  }, [state]);

  const pending = create.isPending || update.isPending;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!state) return;
    if (!nameEn.trim() || !nameAr.trim()) {
      setError(t("bothNamesRequired"));
      return;
    }
    setError(null);
    try {
      if (state.mode === "create") {
        await create.mutateAsync({ nameEn: nameEn.trim(), nameAr: nameAr.trim(), sortOrder: 0 });
      } else {
        await update.mutateAsync({
          id: state.category.id,
          nameEn: nameEn.trim(),
          nameAr: nameAr.trim(),
        });
      }
      onClose();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "NETWORK";
      setError(code === "NAME_EXISTS" ? t("nameExists") : tc("errors.GENERIC"));
    }
  }

  return (
    <Dialog
      open={state !== null}
      onClose={onClose}
      title={state?.mode === "edit" ? t("titleEdit") : t("titleNew")}
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label={t("nameEn")} htmlFor="cat-name-en" required>
          <Input
            id="cat-name-en"
            dir="ltr"
            value={nameEn}
            onChange={(e) => setNameEn(e.target.value)}
          />
        </Field>
        <Field label={t("nameAr")} htmlFor="cat-name-ar" required>
          <Input
            id="cat-name-ar"
            dir="rtl"
            value={nameAr}
            onChange={(e) => setNameAr(e.target.value)}
          />
        </Field>
        {error && <Alert>{error}</Alert>}
        <div className="flex items-center justify-end gap-3">
          <Button variant="outline" onClick={onClose}>
            {tc("cancel")}
          </Button>
          {permissions.includes("services.manage") && (
            <Button type="submit" disabled={pending}>
              {pending ? tc("saving") : tc("save")}
            </Button>
          )}
        </div>
      </form>
    </Dialog>
  );
}

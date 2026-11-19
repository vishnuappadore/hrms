"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ALL_PERMISSION_KEYS, PERMISSIONS, type PermissionKey } from "@keystonehr/shared";
import { ApiError } from "@/lib/api-client";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { useRoleDetail, useUpdateRole } from "@/lib/queries/roles";

/** Groups the flat permission catalog by its `module.` prefix, in catalog order. */
function groupByModule(): Map<string, PermissionKey[]> {
  const groups = new Map<string, PermissionKey[]>();
  for (const key of ALL_PERMISSION_KEYS) {
    const moduleKey = key.split(".")[0]!;
    const list = groups.get(moduleKey) ?? [];
    list.push(key);
    groups.set(moduleKey, list);
  }
  return groups;
}

const MODULE_GROUPS = groupByModule();

export function RolePermissionsDialog({
  roleId,
  onClose,
}: {
  /** null = closed */
  roleId: string | null;
  onClose: () => void;
}) {
  const t = useTranslations("settings.roles");
  const tc = useTranslations("common");
  const locale = useLocale();
  const { data: detail, isLoading } = useRoleDetail(roleId ?? undefined);
  const update = useUpdateRole(roleId ?? "");
  const { showToast } = useToast();

  const [checked, setChecked] = useState<Set<PermissionKey>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (detail) setChecked(new Set(detail.permissionKeys));
    setError(null);
  }, [detail]);

  const readOnly = !!detail?.isSuperAdmin;

  function toggle(key: PermissionKey) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleModule(keys: PermissionKey[]) {
    const allChecked = keys.every((k) => checked.has(k));
    setChecked((prev) => {
      const next = new Set(prev);
      for (const key of keys) {
        if (allChecked) next.delete(key);
        else next.add(key);
      }
      return next;
    });
  }

  async function save() {
    if (!detail) return;
    setError(null);
    try {
      await update.mutateAsync({
        nameEn: detail.nameEn,
        nameAr: detail.nameAr,
        permissionKeys: Array.from(checked),
      });
      showToast(t("permissionsSaved"));
      onClose();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "NETWORK";
      setError(code === "ROLE_PROTECTED" ? t("errors.roleProtected") : tc("errors.GENERIC"));
    }
  }

  const moduleEntries = useMemo(() => Array.from(MODULE_GROUPS.entries()), []);

  return (
    <Dialog
      open={roleId !== null}
      onClose={onClose}
      title={
        detail
          ? t("permissionsTitle", { name: locale === "ar" ? detail.nameAr : detail.nameEn })
          : t("permissionsTitleFallback")
      }
      className="max-w-3xl"
      showCloseButton
      closeLabel={tc("close")}
    >
      {isLoading || !detail ? (
        <p className="text-sm text-muted-foreground">{tc("loading")}</p>
      ) : (
        <div className="space-y-4">
          {readOnly && (
            <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
              {t("superAdminReadOnly")}
            </div>
          )}

          <div className="max-h-[60vh] space-y-5 overflow-y-auto pe-1">
            {moduleEntries.map(([moduleKey, keys]) => (
              <section key={moduleKey}>
                <div className="mb-2 flex items-center justify-between border-b border-border pb-1.5">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground/80">
                    {t(`modules.${moduleKey}`)}
                  </h3>
                  {!readOnly && (
                    <button
                      type="button"
                      onClick={() => toggleModule(keys)}
                      className="text-xs font-medium text-primary hover:underline"
                    >
                      {keys.every((k) => checked.has(k)) ? t("clearAll") : t("selectAll")}
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {keys.map((key) => (
                    <label key={key} className="flex items-start gap-2 text-sm">
                      <Checkbox
                        checked={checked.has(key)}
                        disabled={readOnly}
                        onChange={() => toggle(key)}
                        className="mt-0.5"
                      />
                      <span className={readOnly ? "text-muted-foreground" : undefined}>{PERMISSIONS[key]}</span>
                    </label>
                  ))}
                </div>
              </section>
            ))}
          </div>

          {error && <Alert>{error}</Alert>}

          <div className="flex items-center justify-between border-t border-border pt-4">
            <Badge variant="muted">{t("keysSelected", { count: checked.size })}</Badge>
            <div className="flex items-center gap-3">
              <Button variant="outline" onClick={onClose}>
                {tc("close")}
              </Button>
              {!readOnly && (
                <Button disabled={update.isPending} onClick={save}>
                  {update.isPending ? tc("saving") : tc("save")}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </Dialog>
  );
}

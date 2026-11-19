"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { KeyRound, Pencil, Plus, Trash2 } from "lucide-react";
import type { RoleSummary } from "@keystonehr/shared";
import { BackLink } from "@/components/back-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IconActionButton } from "@/components/ui/icon-action-button";
import { DataTable } from "@/components/data-table";
import { useRoleSummaries } from "@/lib/queries/roles";
import { RoleDialog } from "./role-dialog";
import { RolePermissionsDialog } from "./role-permissions-dialog";
import { RoleDeleteDialog } from "./role-delete-dialog";

export function RolesContent() {
  const t = useTranslations("settings.roles");
  const tc = useTranslations("common");
  const locale = useLocale();
  const { data: roles, isLoading } = useRoleSummaries();

  const [roleDialogState, setRoleDialogState] = useState<{ open: boolean; role: RoleSummary | null }>({
    open: false,
    role: null,
  });
  const [permissionsTargetId, setPermissionsTargetId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RoleSummary | null>(null);

  const columns = useMemo<ColumnDef<RoleSummary>[]>(
    () => [
      {
        id: "name",
        header: t("colName"),
        cell: ({ row }) => (
          <div>
            <button
              type="button"
              onClick={() => setPermissionsTargetId(row.original.id)}
              className="font-medium text-foreground underline-offset-2 hover:underline"
            >
              {locale === "ar" ? row.original.nameAr : row.original.nameEn}
            </button>
            <div className="mt-0.5 flex items-center gap-1.5">
              {row.original.isSuperAdmin ? (
                <Badge variant="warning">{t("fullAccess")}</Badge>
              ) : row.original.isSystem ? (
                <Badge variant="muted">{t("systemRole")}</Badge>
              ) : (
                <Badge variant="info">{t("customRole")}</Badge>
              )}
            </div>
          </div>
        ),
      },
      {
        id: "staffCount",
        header: t("colStaff"),
        cell: ({ row }) => <span className="tabular-nums">{row.original.staffCount}</span>,
      },
      {
        id: "actions",
        header: tc("actions"),
        cell: ({ row }) => (
          <div className="flex justify-end gap-2">
            <IconActionButton
              variant="view"
              label={t("permissionSetup")}
              onClick={() => setPermissionsTargetId(row.original.id)}
            >
              <KeyRound className="h-3.5 w-3.5" strokeWidth={1.75} />
            </IconActionButton>
            <IconActionButton
              variant="edit"
              label={tc("edit")}
              disabled={row.original.isSuperAdmin}
              onClick={() => setRoleDialogState({ open: true, role: row.original })}
            >
              <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />
            </IconActionButton>
            <IconActionButton
              variant="delete"
              label={tc("remove")}
              disabled={row.original.isSuperAdmin}
              onClick={() => setDeleteTarget(row.original)}
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
            </IconActionButton>
          </div>
        ),
      },
    ],
    [t, tc, locale],
  );

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-1 flex items-center justify-between gap-4">
          <h1 className="text-xl font-semibold">{t("title")}</h1>
          <BackLink href="/settings" label={t("backToSettings")} bare />
        </div>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      <div className="flex items-center justify-end">
        <Button type="button" onClick={() => setRoleDialogState({ open: true, role: null })}>
          <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
          {t("newRole")}
        </Button>
      </div>

      <DataTable columns={columns} data={roles ?? []} isLoading={isLoading} />

      <RoleDialog
        open={roleDialogState.open}
        role={roleDialogState.role}
        onClose={() => setRoleDialogState({ open: false, role: null })}
        onCreated={(roleId) => setPermissionsTargetId(roleId)}
      />
      <RolePermissionsDialog roleId={permissionsTargetId} onClose={() => setPermissionsTargetId(null)} />
      <RoleDeleteDialog target={deleteTarget} onClose={() => setDeleteTarget(null)} />
    </div>
  );
}

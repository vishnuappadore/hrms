"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { Pencil, Power, PowerOff } from "lucide-react";
import type { LeaveType } from "@keystonehr/shared";
import { usePermissions } from "@/lib/permissions";
import { BackLink } from "@/components/back-link";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { IconActionButton } from "@/components/ui/icon-action-button";
import { DataTable } from "@/components/data-table";
import { useLeaveTypes, useUpdateLeaveType } from "@/lib/queries/leave-types";
import { LeaveTypeDialog } from "./leave-type-dialog";
import { LeaveTypeStatusDialog } from "./leave-type-status-dialog";

export function LeaveSettingsContent() {
  const t = useTranslations("settings.leaveSettings");
  const tc = useTranslations("common");
  const locale = useLocale();
  const [showInactive, setShowInactive] = useState(false);
  const { data: types, isLoading } = useLeaveTypes(showInactive);
  const update = useUpdateLeaveType();
  const permissions = usePermissions();
  const canManage = permissions.includes("leave.settings.manage");
  const [dialogState, setDialogState] = useState<{ open: boolean; type: LeaveType | null }>({
    open: false,
    type: null,
  });
  const [rowError, setRowError] = useState<string | null>(null);
  const [statusTarget, setStatusTarget] = useState<LeaveType | null>(null);

  async function confirmToggleActive() {
    if (!statusTarget) return;
    setRowError(null);
    try {
      await update.mutateAsync({
        id: statusTarget.id,
        input: { isActive: !statusTarget.isActive },
      });
      setStatusTarget(null);
    } catch {
      setRowError(tc("errors.GENERIC"));
    }
  }

  const columns = useMemo<ColumnDef<LeaveType>[]>(
    () => [
      {
        id: "name",
        header: t("colName"),
        cell: ({ row }) => (
          <p className="font-medium">
            {locale === "ar" ? row.original.nameAr : row.original.nameEn}
          </p>
        ),
      },
      {
        id: "isPaid",
        header: t("paymentType"),
        cell: ({ row }) => (
          <Badge variant={row.original.isPaid ? "success" : "muted"}>
            {row.original.isPaid ? t("paid") : t("unpaid")}
          </Badge>
        ),
      },
      {
        id: "daysPerYear",
        header: t("daysPerYear"),
        cell: ({ row }) => (
          <span className="tabular-nums">
            {row.original.daysPerYear} {t("daysPerYearSuffix")}
          </span>
        ),
      },
      {
        id: "status",
        header: t("status"),
        cell: ({ row }) => (
          <Badge variant={row.original.isActive ? "success" : "destructive"}>
            {row.original.isActive ? tc("active") : tc("inactive")}
          </Badge>
        ),
      },
      {
        id: "isEncashable",
        header: t("colEncashable"),
        cell: ({ row }) => (
          <Badge variant={row.original.isEncashable ? "success" : "muted"}>
            {row.original.isEncashable ? tc("yes") : tc("no")}
          </Badge>
        ),
      },
      {
        id: "allowCarryForward",
        header: t("colCarryForward"),
        cell: ({ row }) => (
          <Badge variant={row.original.allowCarryForward ? "success" : "muted"}>
            {row.original.allowCarryForward
              ? `${tc("yes")} (${t("maxDaysShort", { days: row.original.maxCarryForwardDays })})`
              : tc("no")}
          </Badge>
        ),
      },
      {
        id: "requiresSecondApproval",
        header: t("colSecondApproval"),
        cell: ({ row }) => (
          <Badge variant={row.original.requiresSecondApproval ? "success" : "muted"}>
            {row.original.requiresSecondApproval ? tc("yes") : tc("no")}
          </Badge>
        ),
      },
      {
        id: "actions",
        header: tc("actions"),
        cell: ({ row }) => (
          <div className="flex justify-end gap-2">
            {canManage && (
              <IconActionButton
                variant="edit"
                label={tc("edit")}
                onClick={() => setDialogState({ open: true, type: row.original })}
              >
                <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />
              </IconActionButton>
            )}
            {canManage && (
              <IconActionButton
                variant={row.original.isActive ? "delete" : "view"}
                label={row.original.isActive ? tc("deactivate") : t("activate")}
                onClick={() => setStatusTarget(row.original)}
                disabled={update.isPending}
              >
                {row.original.isActive ? (
                  <PowerOff className="h-3.5 w-3.5" strokeWidth={1.75} />
                ) : (
                  <Power className="h-3.5 w-3.5" strokeWidth={1.75} />
                )}
              </IconActionButton>
            )}
          </div>
        ),
      },
    ],
    [t, tc, locale, update.isPending, canManage],
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

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">{t("leaveTypes")}</h2>
          <p className="text-xs text-muted-foreground">{t("hint")}</p>
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Checkbox checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            {t("showInactive")}
          </label>
          {canManage && (
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={() => setDialogState({ open: true, type: null })}
            >
              {t("add")}
            </Button>
          )}
        </div>
      </div>

      {rowError && <Alert>{rowError}</Alert>}

      <DataTable columns={columns} data={types ?? []} isLoading={isLoading} />

      <LeaveTypeDialog
        open={dialogState.open}
        type={dialogState.type}
        onClose={() => setDialogState({ open: false, type: null })}
      />

      <LeaveTypeStatusDialog
        type={statusTarget}
        onClose={() => setStatusTarget(null)}
        onConfirm={confirmToggleActive}
        isPending={update.isPending}
      />
    </div>
  );
}

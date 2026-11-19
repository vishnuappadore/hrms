"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import type { User } from "@keystonehr/shared";
import { KeyRound, Pencil } from "lucide-react";
import { usePermissions } from "@/lib/permissions";
import { DataTable } from "@/components/data-table";
import { Alert } from "@/components/ui/alert";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { IconActionButton, IconActionLink } from "@/components/ui/icon-action-button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useBranches } from "@/lib/queries/branches";
import { useEmployees, useRoles, type EmployeeListParams } from "@/lib/queries/employees";
import { ResetPasswordDialog } from "./reset-password-dialog";

export function EmployeeContent() {
  const t = useTranslations("employees");
  const tc = useTranslations("common");
  const locale = useLocale();
  const permissions = usePermissions();

  const [params, setParams] = useState<EmployeeListParams>({ page: 1, pageSize: 25 });
  const [searchInput, setSearchInput] = useState("");
  const [resetTarget, setResetTarget] = useState<User | null>(null);
  const { data, isLoading, isError } = useEmployees(params);
  const roles = useRoles();
  const { data: branchesData } = useBranches({ page: 1, pageSize: 100, status: "active" });
  const branches = branchesData?.data ?? [];

  useEffect(() => {
    const handle = setTimeout(() => {
      setParams((p) =>
        p.search === (searchInput || undefined)
          ? p
          : { ...p, search: searchInput || undefined, page: 1 },
      );
    }, 400);
    return () => clearTimeout(handle);
  }, [searchInput]);

  const dateFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en", {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [locale],
  );

  const columns = useMemo<ColumnDef<User>[]>(
    () => [
      {
        id: "name",
        header: t("list.name"),
        enableSorting: true,
        cell: ({ row }) => (
          <div className="flex items-center gap-2.5">
            <Avatar name={row.original.name} />
            <div className="min-w-0">
              <div className="truncate font-medium text-foreground">{row.original.name}</div>
              <div className="truncate text-[10.5px] text-muted-foreground">
                {row.original.mobile ?? "—"}
              </div>
            </div>
          </div>
        ),
      },
      { id: "username", header: t("list.username"), accessorKey: "username", enableSorting: true },
      {
        id: "email",
        header: t("list.email"),
        cell: ({ row }) =>
          row.original.email ?? <span className="text-muted-foreground">—</span>,
      },
      {
        id: "role",
        header: t("list.role"),
        cell: ({ row }) => (locale === "ar" ? row.original.role.nameAr : row.original.role.nameEn),
      },
      {
        id: "branches",
        header: t("list.branches"),
        cell: ({ row }) =>
          row.original.allBranches
            ? t("list.allBranches")
            : t("list.branchCount", { count: row.original.branchIds.length }),
      },
      {
        id: "status",
        header: t("list.status"),
        enableSorting: true,
        cell: ({ row }) => (
          <Badge variant={row.original.status === "active" ? "success" : "destructive"}>
            {tc(row.original.status)}
          </Badge>
        ),
      },
      {
        id: "lastLoginAt",
        header: t("list.lastLogin"),
        enableSorting: true,
        cell: ({ row }) =>
          row.original.lastLoginAt ? (
            <span className="whitespace-nowrap">
              {dateFmt.format(new Date(row.original.lastLoginAt))}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        id: "actions",
        header: tc("actions"),
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-1.5">
            {permissions.includes("employee.update") && (
              <IconActionButton
                variant="view"
                label={t("resetPassword.action")}
                onClick={() => setResetTarget(row.original)}
              >
                <KeyRound className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
              </IconActionButton>
            )}
            <IconActionLink variant="edit" label={tc("edit")} href={`/employees/${row.original.id}`}>
              <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
            </IconActionLink>
          </div>
        ),
      },
    ],
    [t, tc, dateFmt, locale, permissions],
  );

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        {permissions.includes("employee.create") &&
          permissions.includes("employee.employment.manage") && (
            <ButtonLink href="/employees/new">+ {t("addUser")}</ButtonLink>
          )}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder={tc("search")}
          className="max-w-64"
        />
        <Select
          value={params.roleId ?? ""}
          onChange={(e) => setParams({ ...params, roleId: e.target.value || undefined, page: 1 })}
          className="w-52"
          aria-label={t("list.role")}
        >
          <option value="">{t("filters.allRoles")}</option>
          {(roles.data ?? []).map((role) => (
            <option key={role.id} value={role.id}>
              {locale === "ar" ? role.nameAr : role.nameEn}
            </option>
          ))}
        </Select>
        <Select
          value={params.branchId ?? ""}
          onChange={(e) => setParams({ ...params, branchId: e.target.value || undefined, page: 1 })}
          className="w-52"
          aria-label={t("list.branches")}
        >
          <option value="">{t("filters.allBranches")}</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {locale === "ar" ? b.nameAr : b.nameEn}
            </option>
          ))}
        </Select>
        <Select
          value={params.status ?? ""}
          onChange={(e) =>
            setParams({
              ...params,
              status: (e.target.value || undefined) as EmployeeListParams["status"],
              page: 1,
            })
          }
          className="w-44"
          aria-label={t("list.status")}
        >
          <option value="">{t("filters.allStatuses")}</option>
          <option value="active">{tc("active")}</option>
          <option value="inactive">{tc("inactive")}</option>
        </Select>
      </div>

      {isError ? (
        <Alert>{tc("loadFailed")}</Alert>
      ) : (
        <DataTable
          columns={columns}
          data={data?.data ?? []}
          meta={data?.meta}
          isLoading={isLoading}
          sort={params.sort}
          onSortChange={(sort) => setParams({ ...params, sort, page: 1 })}
          onPageChange={(page) => setParams({ ...params, page })}
        />
      )}

      <ResetPasswordDialog user={resetTarget} onClose={() => setResetTarget(null)} />
    </div>
  );
}

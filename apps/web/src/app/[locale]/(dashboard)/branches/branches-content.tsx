"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import type { Branch } from "@keystonehr/shared";
import {
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CircleX,
  LayoutGrid,
  List,
  Pencil,
  SearchX,
  Store,
  Users,
} from "lucide-react";
import { usePermissions } from "@/lib/permissions";
import { DataTable } from "@/components/data-table";
import { KpiCard } from "@/components/kpi-card";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { BoxedToggle } from "@/components/ui/boxed-toggle";
import { ButtonLink } from "@/components/ui/button";
import { IconActionLink } from "@/components/ui/icon-action-button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useBranches, useBranchStats, type BranchListParams } from "@/lib/queries/branches";
import { BranchCard } from "./branch-card";

export function BranchesContent() {
  const t = useTranslations("branches");
  const tc = useTranslations("common");
  const tt = useTranslations("table");
  const locale = useLocale();
  const permissions = usePermissions();

  const [params, setParams] = useState<BranchListParams>({ page: 1, pageSize: 25 });
  const [searchInput, setSearchInput] = useState("");
  const [view, setView] = useState<"grid" | "list">("grid");
  const { data, isLoading, isError } = useBranches(params);
  const stats = useBranchStats();

  // debounce free-text search into the query params
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

  const columns = useMemo<ColumnDef<Branch>[]>(
    () => [
      { id: "code", header: t("list.code"), accessorKey: "code", enableSorting: true },
      {
        id: "nameEn",
        header: t("list.name"),
        enableSorting: true,
        cell: ({ row }) => (
          <span className="font-medium">
            {locale === "ar" ? row.original.nameAr : row.original.nameEn}
          </span>
        ),
      },
      { id: "city", header: t("list.city"), accessorKey: "city", enableSorting: true },
      {
        id: "manager",
        header: t("list.manager"),
        cell: ({ row }) =>
          row.original.manager?.name ?? <span className="text-muted-foreground">—</span>,
      },
      {
        id: "employees",
        header: t("list.employees"),
        cell: ({ row }) => <span className="tabular-nums">{row.original.employeeCount}</span>,
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
        id: "actions",
        header: tc("actions"),
        cell: ({ row }) => (
          <div className="flex justify-end">
            <IconActionLink variant="edit" label={tc("edit")} href={`/branches/${row.original.id}`}>
              <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
            </IconActionLink>
          </div>
        ),
      },
    ],
    [t, tc, locale],
  );

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <div className="flex items-center gap-3">
          <BoxedToggle
            value={view}
            onChange={setView}
            aria-label={t("views.label")}
            options={[
              { value: "grid", label: t("views.grid"), icon: LayoutGrid },
              { value: "list", label: t("views.list"), icon: List },
            ]}
          />
          {permissions.includes("branches.create") && (
            <ButtonLink href="/branches/new">+ {t("addBranch")}</ButtonLink>
          )}
        </div>
      </div>

      {/* KPI cards */}
      <div className="mb-5 grid grid-cols-2 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label={t("kpis.total")}
          value={stats.data?.total}
          icon={Store}
          loading={stats.isLoading}
        />
        <KpiCard
          label={t("kpis.active")}
          value={stats.data?.active}
          icon={CircleCheck}
          loading={stats.isLoading}
        />
        <KpiCard
          label={t("kpis.inactive")}
          value={stats.data?.inactive}
          icon={CircleX}
          loading={stats.isLoading}
        />
        <KpiCard
          label={t("kpis.employees")}
          value={stats.data?.employees}
          icon={Users}
          loading={stats.isLoading}
        />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder={tc("search")}
          className="max-w-64"
        />
        <Select
          value={params.status ?? ""}
          onChange={(e) =>
            setParams({
              ...params,
              status: (e.target.value || undefined) as BranchListParams["status"],
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
      ) : view === "grid" ? (
        renderGrid()
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
    </div>
  );

  function renderGrid() {
    const branches = data?.data ?? [];
    const meta = data?.meta;
    const loading = isLoading;
    const onPageChange = (page: number) => setParams({ ...params, page });
    if (loading) {
      return (
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-52 animate-pulse rounded-xl border border-border bg-muted/40" />
          ))}
        </div>
      );
    }
    if (branches.length === 0) {
      return (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-border bg-card py-14 text-muted-foreground">
          <SearchX className="h-7 w-7 opacity-60" strokeWidth={1.5} aria-hidden="true" />
          <span className="text-sm">{tt("noResults")}</span>
        </div>
      );
    }
    const pages = meta ? Math.max(1, Math.ceil(meta.total / meta.pageSize)) : 1;
    return (
      <div className="space-y-4">
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
          {branches.map((b) => (
            <BranchCard key={b.id} branch={b} />
          ))}
        </div>
        {meta && meta.total > 0 && (
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>{tt("totalRows", { total: meta.total })}</span>
            <div className="flex items-center gap-1.5">
              <IconButton
                label={tt("previous")}
                disabled={meta.page <= 1}
                onClick={() => onPageChange?.(meta.page - 1)}
              >
                <ChevronLeft className="h-4 w-4 rtl:rotate-180" strokeWidth={1.75} aria-hidden="true" />
              </IconButton>
              <span className="px-1 tabular-nums">
                {tt("pageOf", { page: meta.page, pages })}
              </span>
              <IconButton
                label={tt("next")}
                disabled={meta.page >= pages}
                onClick={() => onPageChange?.(meta.page + 1)}
              >
                <ChevronRight className="h-4 w-4 rtl:rotate-180" strokeWidth={1.75} aria-hidden="true" />
              </IconButton>
            </div>
          </div>
        )}
      </div>
    );
  }
}


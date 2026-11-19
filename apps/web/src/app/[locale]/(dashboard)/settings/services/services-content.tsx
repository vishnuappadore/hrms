"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Pencil, Plus } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { formatMoney, type Service, type ServiceCategory } from "@keystonehr/shared";
import { Link } from "@/i18n/navigation";
import { usePermissions } from "@/lib/permissions";
import { BackLink } from "@/components/back-link";
import { DataTable } from "@/components/data-table";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useMe } from "@/lib/queries/users";
import { useServiceCategories, useServices, type ServiceListParams } from "@/lib/queries/services";
import { CategoryDialog } from "./category-dialog";
import { cn } from "@/lib/cn";

export function ServicesContent() {
  const t = useTranslations("services");
  const tc = useTranslations("common");
  const locale = useLocale();
  const { data: me } = useMe();
  const permissions = usePermissions();

  const [params, setParams] = useState<ServiceListParams>({ page: 1, pageSize: 25 });
  const [searchInput, setSearchInput] = useState("");
  const [categoryDialog, setCategoryDialog] = useState<
    { mode: "create" } | { mode: "edit"; category: ServiceCategory } | null
  >(null);

  const categories = useServiceCategories();
  const { data, isLoading, isError } = useServices(params);

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

  const currency = me?.currency ?? "OMR";
  const catName = (c: { nameEn: string; nameAr: string }) =>
    locale === "ar" ? c.nameAr : c.nameEn;

  const columns = useMemo<ColumnDef<Service>[]>(
    () => [
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
      {
        id: "category",
        header: t("list.category"),
        cell: ({ row }) => catName(row.original.category),
      },
      {
        id: "durationMinutes",
        header: t("list.duration"),
        enableSorting: true,
        cell: ({ row }) => (
          <span className="whitespace-nowrap tabular-nums">
            {t("list.minutes", { minutes: row.original.durationMinutes })}
            {row.original.bufferMinutes > 0 && (
              <span className="text-muted-foreground"> +{row.original.bufferMinutes}</span>
            )}
          </span>
        ),
      },
      {
        id: "priceMinor",
        header: t("list.price"),
        enableSorting: true,
        cell: ({ row }) => (
          <span className="whitespace-nowrap tabular-nums">
            {formatMoney(row.original.priceMinor, currency, locale)}
          </span>
        ),
      },
      {
        id: "overrides",
        header: t("list.overrides"),
        cell: ({ row }) =>
          row.original.branchOverrides.length > 0 ? (
            <span className="tabular-nums">{row.original.branchOverrides.length}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
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
          <Link
            href={`/settings/services/${row.original.id}`}
            className="font-medium text-primary hover:underline"
          >
            {tc("edit")}
          </Link>
        ),
      },
    ],
    [t, tc, locale, currency],
  );

  return (
    <div>
      <BackLink href="/settings" label={t("backToSettings")} />
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        {permissions.includes("services.manage") && (
          <ButtonLink href="/settings/services/new">+ {t("addService")}</ButtonLink>
        )}
      </div>

      {/* category chips double as the category filter */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setParams({ ...params, categoryId: undefined, page: 1 })}
          className={cn(
            "h-8 rounded-full border px-3 text-sm transition",
            !params.categoryId
              ? "border-primary bg-primary-muted font-medium text-primary"
              : "border-input bg-card text-muted-foreground hover:bg-muted",
          )}
        >
          {t("allCategories")}
        </button>
        {(categories.data ?? []).map((category) => (
          <span key={category.id} className="inline-flex items-center">
            <button
              type="button"
              onClick={() => setParams({ ...params, categoryId: category.id, page: 1 })}
              className={cn(
                "h-8 rounded-s-full border border-e-0 ps-3 pe-2 text-sm transition",
                params.categoryId === category.id
                  ? "border-primary bg-primary-muted font-medium text-primary"
                  : "border-input bg-card text-muted-foreground hover:bg-muted",
              )}
            >
              {catName(category)}
              <span className="ms-1.5 text-xs opacity-70 tabular-nums">
                {category.serviceCount}
              </span>
            </button>
            {permissions.includes("services.manage") && (
              <button
                type="button"
                aria-label={t("editCategory", { name: catName(category) })}
                onClick={() => setCategoryDialog({ mode: "edit", category })}
                className={cn(
                  "flex h-8 items-center rounded-e-full border border-s-0 pe-2.5 ps-1 transition",
                  params.categoryId === category.id
                    ? "border-primary bg-primary-muted text-primary"
                    : "border-input bg-card text-muted-foreground hover:bg-muted",
                )}
              >
                <Pencil className="h-3 w-3" strokeWidth={1.75} aria-hidden="true" />
              </button>
            )}
          </span>
        ))}
        {permissions.includes("services.manage") && (
          <Button variant="outline" size="sm" onClick={() => setCategoryDialog({ mode: "create" })}>
            <Plus className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
            {t("addCategory")}
          </Button>
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
          value={params.status ?? ""}
          onChange={(e) =>
            setParams({
              ...params,
              status: (e.target.value || undefined) as ServiceListParams["status"],
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

      <CategoryDialog state={categoryDialog} onClose={() => setCategoryDialog(null)} />
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { Eye, Pencil, ShoppingCart } from "lucide-react";
import { CUSTOMER_TIERS, formatMoney, type Customer } from "@keystonehr/shared";
import { usePermissions } from "@/lib/permissions";
import { DataTable } from "@/components/data-table";
import { Alert } from "@/components/ui/alert";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IconActionButton, IconActionLink } from "@/components/ui/icon-action-button";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useCustomers, type CustomerListParams } from "@/lib/queries/customers";
import { CustomerDrawer, type CustomerDrawerState } from "./customer-drawer";
import { TIER_BADGE_VARIANT } from "./customer-tier";

export function CustomersContent() {
  const t = useTranslations("customers");
  const tc = useTranslations("common");
  const locale = useLocale();
  const initialSearch = useSearchParams().get("search") ?? "";
  const permissions = usePermissions();

  const [params, setParams] = useState<CustomerListParams>({
    page: 1,
    pageSize: 25,
    search: initialSearch || undefined,
  });
  const [searchInput, setSearchInput] = useState(initialSearch);
  const [drawerState, setDrawerState] = useState<CustomerDrawerState>(null);
  const { data, isLoading, isError } = useCustomers(params);

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

  const columns = useMemo<ColumnDef<Customer>[]>(
    () => [
      {
        id: "name",
        header: t("list.customer"),
        enableSorting: true,
        cell: ({ row }) => (
          <div className="flex items-center gap-2.5">
            <Avatar name={row.original.name} src={row.original.photoUrl} />
            <span className="font-medium">{row.original.name}</span>
          </div>
        ),
      },
      {
        id: "contact",
        header: t("list.contact"),
        cell: ({ row }) => (
          <div className="leading-tight">
            <div dir="ltr" className="text-start">
              {row.original.mobile}
            </div>
            {row.original.email ? (
              <div dir="ltr" className="text-start text-xs text-muted-foreground">
                {row.original.email}
              </div>
            ) : null}
          </div>
        ),
      },
      {
        id: "tier",
        header: t("list.tier"),
        cell: ({ row }) => (
          <Badge variant={TIER_BADGE_VARIANT[row.original.tier]}>{t(`tiers.${row.original.tier}`)}</Badge>
        ),
      },
      {
        id: "visits",
        header: t("list.visits"),
        enableSorting: true,
        cell: ({ row }) => row.original.visits,
      },
      {
        id: "points",
        header: t("list.points"),
        enableSorting: true,
        cell: ({ row }) => row.original.points,
      },
      {
        id: "totalSpendMinor",
        header: t("list.totalSpend"),
        enableSorting: true,
        cell: ({ row }) => (
          <span className="whitespace-nowrap">
            {formatMoney(row.original.totalSpendMinor, row.original.currency, locale)}
          </span>
        ),
      },
      {
        id: "actions",
        header: tc("actions"),
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-1.5">
            <IconActionButton
              variant="view"
              label={t("list.view")}
              onClick={() => setDrawerState({ mode: "view", customer: row.original })}
            >
              <Eye className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
            </IconActionButton>
            {permissions.includes("pos.use") && (
              <IconActionLink
                variant="sell"
                label={t("list.newSale")}
                href={`/pos?customerId=${row.original.id}`}
              >
                <ShoppingCart className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
              </IconActionLink>
            )}
            {permissions.includes("customers.update") && (
              <IconActionButton
                variant="neutral"
                label={tc("edit")}
                onClick={() => setDrawerState({ mode: "edit", customer: row.original })}
              >
                <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
              </IconActionButton>
            )}
          </div>
        ),
      },
    ],
    [t, tc, locale, permissions],
  );

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("subtitle", { count: data?.meta.total ?? 0 })}
          </p>
        </div>
        {permissions.includes("customers.create") && (
          <Button onClick={() => setDrawerState({ mode: "create" })}>+ {t("addCustomer")}</Button>
        )}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder={t("searchPlaceholder")}
          className="max-w-64"
        />
        <SegmentedControl
          aria-label={t("list.tier")}
          value={params.tier ?? "all"}
          onChange={(v) => setParams({ ...params, tier: v === "all" ? undefined : v, page: 1 })}
          options={[
            { value: "all", label: t("filters.allTiers") },
            ...CUSTOMER_TIERS.map((tier) => ({ value: tier, label: t(`tiers.${tier}`) })),
          ]}
        />
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

      <CustomerDrawer
        state={drawerState}
        onClose={() => setDrawerState(null)}
        onEdit={(customer) => setDrawerState({ mode: "edit", customer })}
      />
    </div>
  );
}

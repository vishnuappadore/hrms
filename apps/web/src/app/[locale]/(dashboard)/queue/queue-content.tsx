"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { Check, Clock, Eye, ListChecks, List as ListIcon, LayoutGrid, Play, ShoppingCart, Users, X } from "lucide-react";
import { WALKIN_STATUSES, type WalkIn, type WalkInStatus } from "@keystonehr/shared";
import { DataTable } from "@/components/data-table";
import { KpiCard } from "@/components/kpi-card";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { BoxedToggle } from "@/components/ui/boxed-toggle";
import { Button } from "@/components/ui/button";
import { IconActionButton, IconActionLink } from "@/components/ui/icon-action-button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { usePermissions } from "@/lib/permissions";
import { useBranches } from "@/lib/queries/branches";
import { useAppointmentBarbers } from "@/lib/queries/appointments";
import { useAssignWalkInBarber, useWalkInAction, useWalkInStats, useWalkIns } from "@/lib/queries/walk-ins";
import { WalkInBoard } from "./walk-in-board";
import { WalkInDrawer, type WalkInDrawerState } from "./walk-in-drawer";
import { STATUS_BADGE, useServiceNames, useWaitLabel } from "./walk-in-queue";

type ViewKey = "list" | "board";

export function QueueContent() {
  const t = useTranslations("walkIn");
  const tc = useTranslations("common");
  const locale = useLocale();
  const permissions = usePermissions();

  const branchesQuery = useBranches({ status: "active", pageSize: 100 });
  const branches = branchesQuery.data?.data ?? [];
  const [branchId, setBranchId] = useState<string | undefined>();
  useEffect(() => {
    if (!branchId && branches.length > 0) setBranchId(branches[0]!.id);
  }, [branches, branchId]);

  const [view, setView] = useState<ViewKey>("list");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState<string | undefined>();
  const [status, setStatus] = useState<WalkInStatus | undefined>();
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<string | undefined>();
  const [drawerState, setDrawerState] = useState<WalkInDrawerState>(null);

  useEffect(() => {
    const handle = setTimeout(() => {
      setSearch((prev) => {
        const next = searchInput || undefined;
        if (prev !== next) setPage(1);
        return next;
      });
    }, 400);
    return () => clearTimeout(handle);
  }, [searchInput]);

  const selectedBranch = branches.find((b) => b.id === branchId);
  const statsQuery = useWalkInStats(branchId);
  const barbersQuery = useAppointmentBarbers(branchId);
  const barbers = barbersQuery.data ?? [];

  // Board shows every active entry (any age) plus today's completed ones via the API's board mode —
  // not "page N of all-time history", which let >100 newer finished/cancelled rows push a still-
  // waiting entry off the board. The List's status filter and page don't apply to the Board.
  const boardSince = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0); // viewer's local start of day
    return d.toISOString();
  }, []);
  const { data, isLoading, isError } = useWalkIns(
    view === "list"
      ? { branchId, search, status, page, pageSize: 25, sort }
      : { branchId, search, boardSince, page: 1, pageSize: 100, sort: "queuedAt" },
  );

  const assignBarber = useAssignWalkInBarber();
  const action = useWalkInAction();

  const columns = useMemo<ColumnDef<WalkIn>[]>(
    () => [
      {
        id: "customer",
        header: t("list.customer"),
        cell: ({ row }) => {
          const name = row.original.customer?.name ?? row.original.customerName ?? t("list.guest");
          const mobile = row.original.customer?.mobile ?? row.original.mobileNumber;
          return (
            <div className="leading-tight">
              <div className="font-medium">{name}</div>
              {mobile ? (
                <div dir="ltr" className="text-start text-xs text-muted-foreground">
                  {mobile}
                </div>
              ) : null}
            </div>
          );
        },
      },
      {
        id: "services",
        header: t("list.services"),
        cell: ({ row }) => <ServiceNamesCell services={row.original.services} />,
      },
      {
        id: "barber",
        header: t("list.barber"),
        cell: ({ row }) => {
          const entry = row.original;
          if (entry.status === "completed" || entry.status === "cancelled" || !permissions.includes("walkin.update")) {
            return <span>{entry.barber?.name ?? t("list.unassigned")}</span>;
          }
          return (
            <Select
              aria-label={t("list.barber")}
              value={entry.barberStaffId ?? ""}
              onChange={(e) =>
                assignBarber.mutate({ id: entry.id, input: { barberStaffId: e.target.value || null } })
              }
              className="w-44"
            >
              <option value="">{t("list.unassigned")}</option>
              {barbers.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          );
        },
      },
      {
        id: "wait",
        header: t("list.wait"),
        cell: ({ row }) =>
          row.original.status === "waiting" || row.original.status === "serving" ? (
            <WaitCell since={row.original.queuedAt} />
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        id: "status",
        header: t("list.status"),
        cell: ({ row }) => (
          <Badge variant={STATUS_BADGE[row.original.status]}>{t(`status.${row.original.status}`)}</Badge>
        ),
      },
      {
        id: "actions",
        header: tc("actions"),
        cell: ({ row }) => {
          const entry = row.original;
          const viewButton = (
            <IconActionButton
              variant="neutral"
              label={t("actions.view")}
              onClick={() => setDrawerState({ mode: "view", entry })}
            >
              <Eye className="h-3.5 w-3.5" strokeWidth={1.75} />
            </IconActionButton>
          );
          if (entry.status === "waiting") {
            return (
              <div className="flex items-center gap-1.5">
                {viewButton}
                {permissions.includes("walkin.checkin") && (
                  <IconActionButton
                    variant="view"
                    label={t("actions.start")}
                    onClick={() => action.mutate({ id: entry.id, action: "start" })}
                    disabled={action.isPending}
                  >
                    <Play className="h-3.5 w-3.5" strokeWidth={1.75} />
                  </IconActionButton>
                )}
                {permissions.includes("walkin.cancel") && (
                  <IconActionButton
                    variant="delete"
                    label={t("actions.cancel")}
                    onClick={() => action.mutate({ id: entry.id, action: "cancel" })}
                    disabled={action.isPending}
                  >
                    <X className="h-3.5 w-3.5" strokeWidth={1.75} />
                  </IconActionButton>
                )}
              </div>
            );
          }
          if (entry.status === "serving") {
            return (
              <div className="flex items-center gap-1.5">
                {viewButton}
                {permissions.includes("pos.use") && (
                  <IconActionLink variant="sell" label={t("actions.checkout")} href={`/pos?walkInId=${entry.id}`}>
                    <ShoppingCart className="h-3.5 w-3.5" strokeWidth={1.75} />
                  </IconActionLink>
                )}
                {permissions.includes("walkin.checkin") && (
                  <IconActionButton
                    variant="complete"
                    label={t("actions.complete")}
                    onClick={() => action.mutate({ id: entry.id, action: "complete" })}
                    disabled={action.isPending}
                  >
                    <Check className="h-3.5 w-3.5" strokeWidth={1.75} />
                  </IconActionButton>
                )}
              </div>
            );
          }
          return <div className="flex items-center gap-1.5">{viewButton}</div>;
        },
      },
    ],
    [t, tc, locale, permissions, barbers, assignBarber, action],
  );

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <BoxedToggle<ViewKey>
            value={view}
            onChange={setView}
            aria-label={t("views.label")}
            options={[
              { value: "list", label: t("views.list"), icon: ListIcon },
              { value: "board", label: t("views.board"), icon: LayoutGrid },
            ]}
          />
          <Select
            value={branchId ?? ""}
            onChange={(e) => {
              setBranchId(e.target.value || undefined);
              setPage(1);
            }}
            className="w-48"
            aria-label={t("branch")}
          >
            {branches.length === 0 ? (
              <option value="">{t("noBranches")}</option>
            ) : (
              branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {locale === "ar" ? b.nameAr : b.nameEn}
                </option>
              ))
            )}
          </Select>
          {permissions.includes("walkin.create") && (
            <Button onClick={() => setDrawerState({ mode: "create" })} disabled={!branchId}>
              + {t("addWalkIn")}
            </Button>
          )}
        </div>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiCard label={t("kpis.inQueue")} value={statsQuery.data?.inQueue} icon={Users} loading={statsQuery.isLoading} />
        <KpiCard label={t("kpis.servingNow")} value={statsQuery.data?.servingNow} icon={Clock} loading={statsQuery.isLoading} />
        <KpiCard label={t("kpis.doneToday")} value={statsQuery.data?.doneToday} icon={ListChecks} loading={statsQuery.isLoading} />
        <KpiCard
          label={t("kpis.avgWait")}
          value={statsQuery.data?.avgWaitMinutes != null ? t("list.minutes", { minutes: statsQuery.data.avgWaitMinutes }) : undefined}
          icon={Clock}
          loading={statsQuery.isLoading}
        />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder={t("searchPlaceholder")}
          className="max-w-64"
        />
        {view === "list" ? (
          <Select
            value={status ?? ""}
            onChange={(e) => {
              setStatus((e.target.value || undefined) as WalkInStatus | undefined);
              setPage(1);
            }}
            className="w-44"
            aria-label={t("list.status")}
          >
            <option value="">{t("filters.allStatuses")}</option>
            {WALKIN_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`status.${s}`)}
              </option>
            ))}
          </Select>
        ) : null}
      </div>

      {view === "board" ? (
        isError ? (
          <Alert>{tc("loadFailed")}</Alert>
        ) : (
          <WalkInBoard
            entries={data?.data ?? []}
            barbers={barbers}
            isLoading={isLoading}
            onView={(entry) => setDrawerState({ mode: "view", entry })}
          />
        )
      ) : isError ? (
        <Alert>{tc("loadFailed")}</Alert>
      ) : (
        <DataTable
          columns={columns}
          data={data?.data ?? []}
          meta={data?.meta}
          isLoading={isLoading}
          sort={sort}
          onSortChange={(s) => {
            setSort(s);
            setPage(1);
          }}
          onPageChange={setPage}
        />
      )}

      <WalkInDrawer
        state={drawerState}
        branch={selectedBranch}
        onClose={() => setDrawerState(null)}
        onEdit={(entry) => setDrawerState({ mode: "edit", entry })}
      />
    </div>
  );
}

function WaitCell({ since }: { since: string | Date }) {
  const label = useWaitLabel(since);
  return <span className="whitespace-nowrap">{label}</span>;
}

function ServiceNamesCell({ services }: { services: { nameEn: string; nameAr: string }[] }) {
  const label = useServiceNames(services);
  return <span className="whitespace-nowrap">{label}</span>;
}

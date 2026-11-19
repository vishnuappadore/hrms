"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { CalendarCheck, CalendarOff, Clock, Eye, Plus, XCircle } from "lucide-react";
import type { LeaveRequestDetail, LeaveRequestSummary, LeaveTab } from "@keystonehr/shared";
import { ApiError } from "@/lib/api-client";
import { usePermissions } from "@/lib/permissions";
import { Alert } from "@/components/ui/alert";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { BoxedToggle } from "@/components/ui/boxed-toggle";
import { Button } from "@/components/ui/button";
import { IconActionButton } from "@/components/ui/icon-action-button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { KpiCard } from "@/components/kpi-card";
import { DataTable } from "@/components/data-table";
import { useBranches } from "@/lib/queries/branches";
import { useLeaveTypes } from "@/lib/queries/leave-types";
import { useApproveLeaveRequest, useLeaveKpis, useLeaveRequests } from "@/lib/queries/leave";
import { ApproveLeaveDialog } from "./approve-leave-dialog";
import { RejectLeaveDialog } from "./reject-leave-dialog";
import { CancelLeaveDialog } from "./cancel-leave-dialog";
import { LeaveDetailDialog } from "./leave-detail-dialog";
import { RequestLeaveDialog } from "./request-leave-dialog";
import { formatDate, formatDateTime } from "./leave-format";
import { LEAVE_STATUS_BADGE_VARIANT } from "./leave-status";

type TabKey = "all" | LeaveTab;
const TABS: TabKey[] = ["all", "pending", "approved", "rejected", "cancelled"];

export function LeaveContent() {
  const t = useTranslations("leave");
  const tc = useTranslations("common");
  const locale = useLocale();
  const { showToast } = useToast();
  const permissions = usePermissions();

  const { data: branchesData } = useBranches({ page: 1, pageSize: 100, status: "active" });
  const branches = branchesData?.data ?? [];
  const { data: leaveTypes } = useLeaveTypes();

  const [tab, setTab] = useState<TabKey>("all");
  const [branchId, setBranchId] = useState<string | undefined>(undefined);
  const [leaveTypeId, setLeaveTypeId] = useState<string | undefined>(undefined);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState<string | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [approveTarget, setApproveTarget] = useState<LeaveRequestSummary | null>(null);
  const [rejectTarget, setRejectTarget] = useState<LeaveRequestSummary | null>(null);
  const [cancelTarget, setCancelTarget] = useState<LeaveRequestSummary | null>(null);
  const [detailTargetId, setDetailTargetId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [requestDialogOpen, setRequestDialogOpen] = useState(false);

  useEffect(() => {
    const handle = setTimeout(() => setSearch(searchInput || undefined), 400);
    return () => clearTimeout(handle);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [tab, branchId, leaveTypeId, search]);

  const listParams = {
    tab: tab === "all" ? undefined : tab,
    branchId,
    leaveTypeId,
    search,
    page,
    pageSize: 25,
  };
  const { data, isLoading } = useLeaveRequests(listParams);
  const kpis = useLeaveKpis(branchId);
  const approve = useApproveLeaveRequest();

  /** The manager-wide section is only meaningful for leave.view holders — gated on the real
   *  permission, and additionally stays hidden until the KPI call succeeds so it never flashes in
   *  before data is ready. */
  const canViewAll = permissions.includes("leave.view") && kpis.isSuccess;

  async function handleApprove() {
    if (!approveTarget) return;
    setRowError(null);
    try {
      await approve.mutateAsync(approveTarget.id);
      showToast(t("toast.approved"));
      setApproveTarget(null);
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "NETWORK";
      setRowError(code === "LEAVE_INSUFFICIENT_BALANCE" ? t("errors.insufficientBalance") : tc("errors.GENERIC"));
    }
  }

  const columns = useMemo<ColumnDef<LeaveRequestSummary>[]>(
    () => [
      {
        id: "staff",
        header: t("table.staff"),
        cell: ({ row }) => (
          <div className="flex items-center gap-2.5">
            <Avatar name={row.original.staff.name} />
            <div className="min-w-0">
              <p className="truncate font-medium">{row.original.staff.name}</p>
              <p className="truncate text-[10.5px] text-muted-foreground">{row.original.staff.role ?? "—"}</p>
            </div>
          </div>
        ),
      },
      {
        id: "type",
        header: t("table.type"),
        cell: ({ row }) => (locale === "ar" ? row.original.leaveType.nameAr : row.original.leaveType.nameEn),
      },
      {
        id: "period",
        header: t("table.period"),
        cell: ({ row }) => {
          const start = formatDate(row.original.startDate, locale);
          const end = formatDate(row.original.endDate, locale);
          return start === end ? start : `${start} – ${end}`;
        },
      },
      {
        id: "days",
        header: t("table.days"),
        cell: ({ row }) => row.original.daysCount,
      },
      {
        id: "reason",
        header: t("table.reason"),
        cell: ({ row }) => (
          <span className="block max-w-56 line-clamp-2 text-muted-foreground">{row.original.reason ?? "—"}</span>
        ),
      },
      {
        id: "status",
        header: t("table.status"),
        cell: ({ row }) => (
          <Badge variant={LEAVE_STATUS_BADGE_VARIANT[row.original.status]}>
            {row.original.status === "pending_second_approval"
              ? t("status.pendingSecondApproval")
              : t(`status.${row.original.status}`)}
          </Badge>
        ),
      },
      {
        id: "requested",
        header: t("table.requested"),
        cell: ({ row }) => formatDateTime(row.original.createdAt, locale),
      },
      {
        id: "action",
        header: "",
        cell: ({ row }) => {
          const isPendingIsh = row.original.status === "pending" || row.original.status === "pending_second_approval";
          const isApproved = row.original.status === "approved";
          return (
            <div className="flex items-center gap-1.5">
              <IconActionButton
                variant="view"
                label={t("actions.view")}
                onClick={() => setDetailTargetId(row.original.id)}
              >
                <Eye className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
              </IconActionButton>
              {isPendingIsh && permissions.includes("leave.approve") && (
                <>
                  <Button size="sm" onClick={() => setApproveTarget(row.original)}>
                    {t("actions.approve")}
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => setRejectTarget(row.original)}>
                    {t("actions.reject")}
                  </Button>
                </>
              )}
              {isApproved && permissions.includes("leave.approve") && (
                <Button size="sm" variant="destructive" onClick={() => setCancelTarget(row.original)}>
                  {t("actions.cancel")}
                </Button>
              )}
            </div>
          );
        },
      },
    ],
    [t, locale, permissions],
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t("title")}</h1>
          {canViewAll && <p className="text-sm text-muted-foreground">{t("subtitle")}</p>}
        </div>
        <Button onClick={() => setRequestDialogOpen(true)}>
          <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
          {t("newRequest")}
        </Button>
      </div>

      {canViewAll && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <BoxedToggle
              value={tab}
              onChange={setTab}
              options={TABS.map((tabKey) => ({ value: tabKey, label: t(`tabs.${tabKey}`) }))}
            />

            <div className="flex flex-wrap items-center gap-2.5">
              <Input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder={tc("search")}
                className="min-w-0 max-w-56 flex-1"
              />
              <Select value={branchId ?? ""} onChange={(e) => setBranchId(e.target.value || undefined)} className="min-w-0 max-w-48">
                <option value="">{t("allBranches")}</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.nameEn}
                  </option>
                ))}
              </Select>
              <Select
                value={leaveTypeId ?? ""}
                onChange={(e) => setLeaveTypeId(e.target.value || undefined)}
                className="min-w-0 max-w-48"
              >
                <option value="">{t("allTypes")}</option>
                {(leaveTypes ?? []).map((lt) => (
                  <option key={lt.id} value={lt.id}>
                    {locale === "ar" ? lt.nameAr : lt.nameEn}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <KpiCard label={t("kpis.pending")} value={kpis.data?.pending} icon={Clock} loading={kpis.isLoading} />
            <KpiCard
              label={t("kpis.approvedThisMonth")}
              value={kpis.data?.approvedThisMonth}
              icon={CalendarCheck}
              loading={kpis.isLoading}
            />
            <KpiCard
              label={t("kpis.onLeaveToday")}
              value={kpis.data?.onLeaveToday}
              icon={CalendarOff}
              loading={kpis.isLoading}
            />
            <KpiCard label={t("kpis.rejected")} value={kpis.data?.rejected} icon={XCircle} loading={kpis.isLoading} />
          </div>

          {rowError && <Alert>{rowError}</Alert>}

          <DataTable columns={columns} data={data?.data ?? []} meta={data?.meta} isLoading={isLoading} onPageChange={setPage} />
        </div>
      )}

      <RequestLeaveDialog open={requestDialogOpen} onClose={() => setRequestDialogOpen(false)} />
      <ApproveLeaveDialog
        target={approveTarget}
        onClose={() => setApproveTarget(null)}
        onConfirm={handleApprove}
        isPending={approve.isPending}
      />
      <RejectLeaveDialog target={rejectTarget} onClose={() => setRejectTarget(null)} />
      <CancelLeaveDialog target={cancelTarget} onClose={() => setCancelTarget(null)} />
      <LeaveDetailDialog
        id={detailTargetId}
        onClose={() => setDetailTargetId(null)}
        onApprove={(request: LeaveRequestDetail) => {
          setDetailTargetId(null);
          setApproveTarget(request);
        }}
        onReject={(request: LeaveRequestDetail) => {
          setDetailTargetId(null);
          setRejectTarget(request);
        }}
        onCancel={(request: LeaveRequestDetail) => {
          setDetailTargetId(null);
          setCancelTarget(request);
        }}
      />
    </div>
  );
}

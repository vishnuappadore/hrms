"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { ChevronDown, Plus } from "lucide-react";
import type { LeaveRequestSummary, LeaveTab } from "@keystonehr/shared";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { DataTable } from "@/components/data-table";
import { useMyLeaveBalances, useMyLeaveRequests, useWithdrawLeaveRequest } from "@/lib/queries/leave";
import { formatDateTime, periodLabel } from "./leave-format";
import { LEAVE_STATUS_BADGE_VARIANT } from "./leave-status";
import { RequestLeaveDialog } from "./request-leave-dialog";
import { LeaveDetailDialog } from "./leave-detail-dialog";
import { WithdrawLeaveDialog } from "./withdraw-leave-dialog";

type TabKey = "all" | LeaveTab;
const TABS: TabKey[] = ["all", "pending", "approved", "rejected", "cancelled"];

/** Decorative accent dots only, cycled by position — leave types have no configured color. */
const ACCENT_DOTS = ["bg-sky-500", "bg-amber-500", "bg-violet-500", "bg-emerald-500", "bg-rose-500"];

export function MyLeavePanel() {
  const t = useTranslations("leave.myLeave");
  const tLeave = useTranslations("leave");
  const tTabs = useTranslations("leave.tabs");
  const tTable = useTranslations("leave.table");
  const tActions = useTranslations("leave.actions");
  const tDetail = useTranslations("leave.detailDialog");
  const tStatus = useTranslations("leave.status");
  const locale = useLocale();
  const { showToast } = useToast();

  const { data: balances, isLoading: balancesLoading } = useMyLeaveBalances();

  // Accordion: opening one section collapses the other — at most one is expanded at a time.
  const [expandedSection, setExpandedSection] = useState<"balance" | "applied" | null>(null);
  const balanceExpanded = expandedSection === "balance";
  const appliedExpanded = expandedSection === "applied";
  const [tab, setTab] = useState<TabKey>("all");
  const [page, setPage] = useState(1);
  const [requestDialogOpen, setRequestDialogOpen] = useState(false);
  const [detailTargetId, setDetailTargetId] = useState<string | null>(null);
  const [withdrawTarget, setWithdrawTarget] = useState<LeaveRequestSummary | null>(null);

  useEffect(() => {
    setPage(1);
  }, [tab]);

  const { data, isLoading } = useMyLeaveRequests({
    tab: tab === "all" ? undefined : tab,
    page,
    pageSize: 10,
  });

  const withdraw = useWithdrawLeaveRequest();

  async function confirmWithdraw() {
    if (!withdrawTarget) return;
    await withdraw.mutateAsync(withdrawTarget.id);
    showToast(tLeave("toast.withdrawn"));
    setWithdrawTarget(null);
  }

  const columns = useMemo<ColumnDef<LeaveRequestSummary>[]>(
    () => [
      {
        id: "type",
        header: tTable("type"),
        cell: ({ row }) => (locale === "ar" ? row.original.leaveType.nameAr : row.original.leaveType.nameEn),
      },
      {
        id: "period",
        header: tTable("period"),
        cell: ({ row }) => periodLabel(row.original, locale, tDetail),
      },
      {
        id: "days",
        header: tTable("days"),
        cell: ({ row }) => row.original.daysCount,
      },
      {
        id: "status",
        header: tTable("status"),
        cell: ({ row }) => (
          <Badge variant={LEAVE_STATUS_BADGE_VARIANT[row.original.status]}>
            {row.original.status === "pending_second_approval"
              ? tStatus("pendingSecondApproval")
              : tStatus(row.original.status)}
          </Badge>
        ),
      },
      {
        id: "requested",
        header: tTable("requested"),
        cell: ({ row }) => formatDateTime(row.original.createdAt, locale),
      },
      {
        id: "action",
        header: "",
        cell: ({ row }) => {
          const isPendingIsh = row.original.status === "pending" || row.original.status === "pending_second_approval";
          return (
            <div className="flex items-center justify-end gap-1.5">
              <Button size="sm" variant="outline" onClick={() => setDetailTargetId(row.original.id)}>
                {tActions("view")}
              </Button>
              {isPendingIsh && (
                <Button size="sm" variant="destructive" onClick={() => setWithdrawTarget(row.original)}>
                  {tActions("cancel")}
                </Button>
              )}
            </div>
          );
        },
      },
    ],
    [tTable, tDetail, tActions, tStatus, locale],
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">{t("title")}</h2>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <Button onClick={() => setRequestDialogOpen(true)}>
          <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
          {t("newRequest")}
        </Button>
      </div>

      <div>
        <button
          type="button"
          onClick={() => setExpandedSection((s) => (s === "balance" ? null : "balance"))}
          aria-expanded={balanceExpanded}
          className="mb-3 flex w-full items-center justify-between gap-2 text-start"
        >
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("balanceTitle")}
          </h3>
          <ChevronDown
            className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", balanceExpanded && "rotate-180")}
            strokeWidth={1.75}
          />
        </button>
        {balanceExpanded && (balancesLoading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-9 animate-pulse rounded-lg bg-muted/40" />
            ))}
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
                  <th className="px-3 py-2 text-start">{tTable("type")}</th>
                  <th className="px-3 py-2 text-end">{t("total")}</th>
                  <th className="px-3 py-2 text-end">{t("credited")}</th>
                  <th className="px-3 py-2 text-end">{t("carriedForward")}</th>
                  <th className="px-3 py-2 text-end">{t("used")}</th>
                  <th className="px-3 py-2 text-end">{t("remaining")}</th>
                </tr>
              </thead>
              <tbody>
                {!balances || balances.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                      {t("noBalances")}
                    </td>
                  </tr>
                ) : (
                  balances.map((b, i) => {
                    const total = b.openingBalance + b.accrued + b.carriedForward;
                    return (
                      <tr key={b.leaveTypeId} className="border-b border-border last:border-0">
                        <td className="px-3 py-2">
                          <span className="flex min-w-0 items-center gap-2">
                            <span className={cn("h-2 w-2 shrink-0 rounded-full", ACCENT_DOTS[i % ACCENT_DOTS.length])} />
                            <span className="truncate font-medium">
                              {locale === "ar" ? b.leaveTypeNameAr : b.leaveTypeNameEn}
                            </span>
                          </span>
                        </td>
                        <td className="px-3 py-2 text-end">{total}</td>
                        <td className="px-3 py-2 text-end text-muted-foreground">{b.accrued}</td>
                        <td className="px-3 py-2 text-end text-muted-foreground">{b.carriedForward}</td>
                        <td className="px-3 py-2 text-end text-muted-foreground">{b.used}</td>
                        <td className="px-3 py-2 text-end font-semibold">{b.closingBalance}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      <div>
        <button
          type="button"
          onClick={() => setExpandedSection((s) => (s === "applied" ? null : "applied"))}
          aria-expanded={appliedExpanded}
          className="mb-3 flex w-full items-center justify-between gap-2 text-start"
        >
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("appliedLeaves")}
          </h3>
          <ChevronDown
            className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", appliedExpanded && "rotate-180")}
            strokeWidth={1.75}
          />
        </button>
        {appliedExpanded && (
          <>
            <div className="mb-3 flex justify-end">
              <div className="inline-flex gap-1.5 rounded-xl border border-border bg-background p-1">
                {TABS.map((tabKey) => (
                  <button
                    key={tabKey}
                    type="button"
                    onClick={() => setTab(tabKey)}
                    className={cn(
                      "inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition",
                      tab === tabKey ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {tTabs(tabKey)}
                  </button>
                ))}
              </div>
            </div>
            <DataTable columns={columns} data={data?.data ?? []} meta={data?.meta} isLoading={isLoading} onPageChange={setPage} />
          </>
        )}
      </div>

      <RequestLeaveDialog
        open={requestDialogOpen}
        onClose={() => setRequestDialogOpen(false)}
        allowOnBehalf={false}
      />
      <LeaveDetailDialog
        id={detailTargetId}
        onClose={() => setDetailTargetId(null)}
        mode="owner"
        onWithdraw={(request) => {
          setDetailTargetId(null);
          setWithdrawTarget(request);
        }}
      />
      <WithdrawLeaveDialog
        target={withdrawTarget}
        onClose={() => setWithdrawTarget(null)}
        onConfirm={confirmWithdraw}
        isPending={withdraw.isPending}
      />
    </div>
  );
}

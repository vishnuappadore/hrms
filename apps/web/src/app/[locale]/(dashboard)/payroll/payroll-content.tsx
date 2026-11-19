"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { BulkPayrollActionInput, PayrollItemSummary, PayrollTab } from "@keystonehr/shared";
import { Layers, List as ListIcon, Wallet } from "lucide-react";
import { cn } from "@/lib/cn";
import { ApiError } from "@/lib/api-client";
import { usePermissions } from "@/lib/permissions";
import { Alert } from "@/components/ui/alert";
import { BoxedToggle } from "@/components/ui/boxed-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useBranches } from "@/lib/queries/branches";
import {
  useApprovePayrollItem,
  useBulkApprovePayrollItems,
  useBulkMarkPayrollItemsPaid,
  useBulkRecomputePayrollItems,
  useBulkRejectPayrollItems,
  useBulkRevertPayrollItems,
  useGeneratePayrollRun,
  useMarkPayrollItemPaid,
  usePayrollBatches,
  usePayrollBatchItems,
  usePayrollItems,
  usePayrollRun,
  usePreviewPayrollRun,
  useRejectPayrollItem,
  useRevertPayrollItem,
} from "@/lib/queries/payroll";
import { PayrollConfirmDialog, type PayrollConfirmState } from "./payroll-confirm-dialog";
import { PayrollGenerateConfirmDialog, type GenerateConfirmState } from "./payroll-generate-confirm-dialog";
import { canApprove, canMarkPaid, canReject, canRevert } from "./payroll-status";
import { PayrollTable } from "./payroll-table";
import { PayslipDialog } from "./payslip-dialog";

function monthYearLabel(month: string, locale: string): string {
  return new Date(`${month}-01T00:00:00.000Z`).toLocaleDateString(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function currentMonthString(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

const TABS: PayrollTab[] = ["pending", "approved", "rejected"];

export function PayrollContent() {
  const t = useTranslations("payroll");
  const tError = useTranslations("payroll.errors");
  const locale = useLocale();
  const permissions = usePermissions();

  const { data: branchesData } = useBranches({ page: 1, pageSize: 100, status: "active" });
  const branches = branchesData?.data ?? [];

  const [branchId, setBranchId] = useState<string | undefined>(undefined);
  const [month, setMonth] = useState(currentMonthString());
  const [tab, setTab] = useState<PayrollTab>("pending");
  const [view, setView] = useState<"batch" | "list">("list");
  const [payslipItemId, setPayslipItemId] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<PayrollConfirmState | null>(null);
  const [generateConfirmState, setGenerateConfirmState] = useState<GenerateConfirmState | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);

  const [pendingPage, setPendingPage] = useState(1);
  const [approvedPage, setApprovedPage] = useState(1);
  const [rejectedPage, setRejectedPage] = useState(1);
  const [batchItemsPage, setBatchItemsPage] = useState(1);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);

  /**
   * Selection state machine: `selectAllMode` false (default) means
   * `selectedIds` IS the selected set (page-scoped, standard checkbox
   * behavior). `selectAllMode` true means `selectedIds` is the EXCLUDED set —
   * everything matching the current scope (tab, optionally one batch) is
   * selected except these, resolved server-side at bulk-action time so it's
   * never a stale client-held snapshot.
   */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectAllMode, setSelectAllMode] = useState(false);

  useEffect(() => {
    if (!branchId && branches[0]) setBranchId(branches[0].id);
  }, [branchId, branches]);

  const { data: run, isLoading: runLoading } = usePayrollRun(branchId, month);
  const runId = run?.id;
  const generateRun = useGeneratePayrollRun();
  const previewRun = usePreviewPayrollRun();

  // A new/different run invalidates every page-position and selection assumption.
  useEffect(() => {
    setPendingPage(1);
    setApprovedPage(1);
    setRejectedPage(1);
    setBatchItemsPage(1);
    setSelectedBatchId(null);
    setSelectedIds(new Set());
    setSelectAllMode(false);
  }, [runId]);

  const pendingItems = usePayrollItems(runId, "pending", pendingPage);
  const approvedItems = usePayrollItems(runId, "approved", approvedPage);
  const rejectedItems = usePayrollItems(runId, "rejected", rejectedPage);
  const batches = usePayrollBatches(runId, tab === "rejected" ? "rejected" : "approved");

  const inBatchDetail = tab !== "pending" && view === "batch";
  const effectiveSelectedBatchId = selectedBatchId ?? batches.data?.[0]?.id ?? undefined;
  const batchItemsQuery = usePayrollBatchItems(runId, inBatchDetail ? effectiveSelectedBatchId : undefined, batchItemsPage);

  const approveMutation = useApprovePayrollItem(runId ?? "");
  const rejectMutation = useRejectPayrollItem(runId ?? "");
  const markPaidMutation = useMarkPayrollItemPaid(runId ?? "");
  const revertMutation = useRevertPayrollItem(runId ?? "");
  const bulkApprove = useBulkApprovePayrollItems(runId ?? "");
  const bulkReject = useBulkRejectPayrollItems(runId ?? "");
  const bulkMarkPaid = useBulkMarkPayrollItemsPaid(runId ?? "");
  const bulkRevert = useBulkRevertPayrollItems(runId ?? "");
  const bulkRecompute = useBulkRecomputePayrollItems(runId ?? "");

  function onMutationError(err: unknown) {
    const code = err instanceof ApiError ? err.code : "GENERIC";
    setMutationError(
      code === "PAYROLL_ITEM_LOCKED" ||
        code === "PAYROLL_INVALID_TRANSITION" ||
        code === "PAYROLL_ITEM_NOT_PENDING" ||
        code === "PAYROLL_NO_ELIGIBLE_EMPLOYEES"
        ? tError(code)
        : tError("GENERIC"),
    );
  }

  const counts: Record<PayrollTab, number> = {
    pending: pendingItems.data?.meta.total ?? 0,
    approved: approvedItems.data?.meta.total ?? 0,
    rejected: rejectedItems.data?.meta.total ?? 0,
  };

  function clearSelection() {
    setSelectAllMode(false);
    setSelectedIds(new Set());
  }

  function enterSelectAllMode() {
    setSelectAllMode(true);
    setSelectedIds(new Set());
  }

  function switchTab(next: PayrollTab) {
    setTab(next);
    setSelectedBatchId(null);
    setBatchItemsPage(1);
    clearSelection();
    setMutationError(null);
  }

  function switchView(next: "batch" | "list") {
    setView(next);
    setSelectedBatchId(null);
    setBatchItemsPage(1);
    clearSelection();
  }

  function isSelected(id: string): boolean {
    return selectAllMode ? !selectedIds.has(id) : selectedIds.has(id);
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** Page-scoped select-all/none for the given visible ids — always exits select-all-matching mode. */
  function toggleSelectAllFor(ids: string[]) {
    setSelectAllMode(false);
    setSelectedIds((prev) => {
      const allSelected = ids.length > 0 && ids.every((id) => prev.has(id));
      const next = new Set(prev);
      for (const id of ids) {
        if (allSelected) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }

  const listItems: PayrollItemSummary[] =
    tab === "pending"
      ? (pendingItems.data?.data ?? [])
      : tab === "approved"
        ? (approvedItems.data?.data ?? [])
        : (rejectedItems.data?.data ?? []);

  const currentPageItems = inBatchDetail ? (batchItemsQuery.data?.data ?? []) : listItems;

  const activeTabMeta = tab === "pending" ? pendingItems.data?.meta : tab === "approved" ? approvedItems.data?.meta : rejectedItems.data?.meta;
  const activeTabPageSetter = tab === "pending" ? setPendingPage : tab === "approved" ? setApprovedPage : setRejectedPage;
  const scopeTotal = inBatchDetail ? (batchItemsQuery.data?.meta.total ?? 0) : (activeTabMeta?.total ?? 0);
  const scopeBatchId = inBatchDetail ? effectiveSelectedBatchId : undefined;

  function bulkPayload(): BulkPayrollActionInput {
    return selectAllMode
      ? { selectAll: { tab, batchId: scopeBatchId, excludeIds: Array.from(selectedIds) } }
      : { itemIds: Array.from(selectedIds) };
  }

  function openBulkConfirm(action: "approve" | "reject") {
    setConfirmState(
      selectAllMode
        ? { action, selectAllCount: Math.max(0, scopeTotal - selectedIds.size) }
        : { action, items: currentPageItems.filter((i) => selectedIds.has(i.id)) },
    );
  }

  async function handleConfirm(reason?: string) {
    if (!confirmState) return;
    setMutationError(null);
    try {
      if ("selectAllCount" in confirmState) {
        const payload = { ...bulkPayload(), reason };
        if (confirmState.action === "approve") await bulkApprove.mutateAsync(payload);
        else await bulkReject.mutateAsync(payload);
      } else {
        const itemIds = confirmState.items.map((i) => i.id);
        if (confirmState.action === "approve") {
          if (itemIds.length === 1) await approveMutation.mutateAsync({ itemId: itemIds[0]! });
          else await bulkApprove.mutateAsync({ itemIds });
        } else {
          if (itemIds.length === 1) await rejectMutation.mutateAsync({ itemId: itemIds[0]!, reason });
          else await bulkReject.mutateAsync({ itemIds, reason });
        }
      }
      setConfirmState(null);
      clearSelection();
    } catch (err) {
      onMutationError(err);
    }
  }

  function handleBulkMarkPaid() {
    if (!selectAllMode && selectedIds.size === 0) return;
    setMutationError(null);
    bulkMarkPaid.mutate(bulkPayload(), { onSuccess: () => clearSelection(), onError: onMutationError });
  }

  function handleBulkRevert() {
    if (!selectAllMode && selectedIds.size === 0) return;
    setMutationError(null);
    bulkRevert.mutate(bulkPayload(), { onSuccess: () => clearSelection(), onError: onMutationError });
  }

  function handleBulkRecompute() {
    if (!selectAllMode && selectedIds.size === 0) return;
    setMutationError(null);
    bulkRecompute.mutate(bulkPayload(), { onSuccess: () => clearSelection(), onError: onMutationError });
  }

  async function openGenerateConfirm() {
    if (!branchId) return;
    setMutationError(null);
    const branch = branches.find((b) => b.id === branchId);
    const preview = await previewRun.mutateAsync({ branchId, payrollMonth: month });
    if (preview.totalEmployeeCount === 0) {
      setMutationError(t("noEligibleEmployees.body"));
      return;
    }
    setGenerateConfirmState({
      branchName: branch ? (locale === "ar" ? branch.nameAr : branch.nameEn) : "",
      monthLabel: monthYearLabel(month, locale),
      preview,
    });
  }

  function confirmGenerate() {
    if (!branchId) return;
    generateRun.mutate({ branchId, payrollMonth: month });
    setGenerateConfirmState(null);
  }

  const isConfirmPending =
    approveMutation.isPending || rejectMutation.isPending || bulkApprove.isPending || bulkReject.isPending;

  const showSelectAllBanner =
    !selectAllMode &&
    currentPageItems.length > 0 &&
    currentPageItems.every((i) => isSelected(i.id)) &&
    scopeTotal > currentPageItems.length;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      {mutationError && <Alert>{mutationError}</Alert>}

      <div className="flex flex-nowrap items-center gap-2.5 overflow-x-auto">
        <Select
          value={branchId ?? ""}
          onChange={(e) => {
            setBranchId(e.target.value);
            setMutationError(null);
          }}
          className="min-w-0 max-w-48 flex-1"
        >
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {locale === "ar" ? b.nameAr : b.nameEn}
            </option>
          ))}
        </Select>
        <Input
          type="month"
          value={month}
          onChange={(e) => {
            setMonth(e.target.value);
            setMutationError(null);
          }}
          aria-label={t("month")}
          className="min-w-0 max-w-48 flex-1"
        />
        {permissions.includes("payroll.generate") && (
          <Button
            disabled={!branchId || runLoading || previewRun.isPending || generateRun.isPending}
            onClick={openGenerateConfirm}
            className="shrink-0"
          >
            {previewRun.isPending || generateRun.isPending ? "…" : t("generatePayroll")}
          </Button>
        )}
      </div>

      {!runLoading && run === null && (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-card py-16 text-center">
          <Wallet className="h-8 w-8 text-muted-foreground" strokeWidth={1.5} aria-hidden="true" />
          <p className="font-medium text-foreground">{t("notGenerated.title")}</p>
          <p className="max-w-sm text-sm text-muted-foreground">{t("notGenerated.body")}</p>
        </div>
      )}

      {run && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex gap-1.5 rounded-xl border border-border bg-card p-1">
              {TABS.map((tabKey) => (
                <button
                  key={tabKey}
                  type="button"
                  onClick={() => switchTab(tabKey)}
                  className={cn(
                    "inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition",
                    tab === tabKey ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t(`tabs.${tabKey}`)}
                  <span
                    className={cn(
                      "rounded-full px-1.5 text-[10.5px]",
                      tab === tabKey ? "bg-primary-foreground/20" : "bg-muted",
                    )}
                  >
                    {counts[tabKey]}
                  </span>
                </button>
              ))}
            </div>

            {tab !== "pending" && (
              <BoxedToggle
                value={view}
                onChange={switchView}
                aria-label={t("views.label")}
                options={[
                  { value: "batch", label: t("views.batch"), icon: Layers },
                  { value: "list", label: t("views.list"), icon: ListIcon },
                ]}
              />
            )}
          </div>

          {(selectedIds.size > 0 || selectAllMode) && (
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-primary/30 bg-primary-muted p-3">
              <span className="text-sm font-medium">
                {selectAllMode
                  ? t("bulk.selectedAll", { count: Math.max(0, scopeTotal - selectedIds.size) })
                  : t("bulk.selected", { count: selectedIds.size })}
              </span>
              {showSelectAllBanner && (
                <button
                  type="button"
                  onClick={enterSelectAllMode}
                  className="text-sm font-medium text-primary underline-offset-2 hover:underline"
                >
                  {t("bulk.selectAllMatching", { count: scopeTotal })}
                </button>
              )}
              {selectAllMode && (
                <button
                  type="button"
                  onClick={clearSelection}
                  className="text-sm font-medium text-muted-foreground underline-offset-2 hover:underline"
                >
                  {t("bulk.clearSelection")}
                </button>
              )}
              <div className="flex flex-1 items-center justify-end gap-2">
                {tab === "pending" && (
                  <>
                    {permissions.includes("payroll.edit") && (
                      <Button size="sm" variant="outline" disabled={bulkRecompute.isPending} onClick={handleBulkRecompute}>
                        {t("bulk.recomputeSelected")}
                      </Button>
                    )}
                    {permissions.includes("payroll.approve") && (
                      <Button size="sm" onClick={() => openBulkConfirm("approve")}>
                        {t("bulk.approveSelected")}
                      </Button>
                    )}
                    {permissions.includes("payroll.reject") && (
                      <Button size="sm" variant="destructive" onClick={() => openBulkConfirm("reject")}>
                        {t("bulk.rejectSelected")}
                      </Button>
                    )}
                  </>
                )}
                {tab === "approved" && (
                  <>
                    {permissions.includes("payroll.mark_paid") && (
                      <Button size="sm" disabled={bulkMarkPaid.isPending} onClick={handleBulkMarkPaid}>
                        {t("bulk.markPaidSelected")}
                      </Button>
                    )}
                    {permissions.includes("payroll.approve") && (
                      <Button size="sm" variant="outline" disabled={bulkRevert.isPending} onClick={handleBulkRevert}>
                        {t("bulk.revertSelected")}
                      </Button>
                    )}
                  </>
                )}
                {tab === "rejected" && permissions.includes("payroll.approve") && (
                  <Button size="sm" variant="outline" disabled={bulkRevert.isPending} onClick={handleBulkRevert}>
                    {t("bulk.revertSelected")}
                  </Button>
                )}
              </div>
            </div>
          )}

          {tab === "pending" && (
            <PayrollTable
              items={listItems}
              emptyLabel={t("empty")}
              selection={{ isSelected, onToggle: toggleSelect, onToggleAll: () => toggleSelectAllFor(listItems.map((i) => i.id)) }}
              pagination={activeTabMeta ? { meta: activeTabMeta, onPageChange: activeTabPageSetter } : undefined}
              rowActions={(item) => ({
                canApprove: canApprove(item.status) && permissions.includes("payroll.approve"),
                canReject: canReject(item.status) && permissions.includes("payroll.reject"),
              })}
              onViewPayslip={setPayslipItemId}
              onApprove={(item) => setConfirmState({ action: "approve", items: [item] })}
              onReject={(item) => setConfirmState({ action: "reject", items: [item] })}
            />
          )}

          {tab !== "pending" && view === "list" && (
            <PayrollTable
              items={listItems}
              emptyLabel={t("empty")}
              selection={{ isSelected, onToggle: toggleSelect, onToggleAll: () => toggleSelectAllFor(listItems.map((i) => i.id)) }}
              pagination={activeTabMeta ? { meta: activeTabMeta, onPageChange: activeTabPageSetter } : undefined}
              rowActions={(item) => ({
                canReject: canReject(item.status) && permissions.includes("payroll.reject"),
                canMarkPaid: canMarkPaid(item.status) && permissions.includes("payroll.mark_paid"),
                canRevert: canRevert(item.status) && permissions.includes("payroll.approve"),
              })}
              onViewPayslip={setPayslipItemId}
              onReject={(item) => setConfirmState({ action: "reject", items: [item] })}
              onMarkPaid={(itemId) => {
                setMutationError(null);
                markPaidMutation.mutate({ itemId }, { onError: onMutationError });
              }}
              onRevert={(itemId) => {
                setMutationError(null);
                revertMutation.mutate({ itemId }, { onError: onMutationError });
              }}
            />
          )}

          {tab !== "pending" && view === "batch" && (
            <div className="flex gap-4">
              <div className="w-56 shrink-0 space-y-1 overflow-y-auto rounded-xl border border-border bg-card p-2">
                {(batches.data ?? []).length === 0 ? (
                  <div className="p-3 text-center text-sm text-muted-foreground">{t("batchEmpty")}</div>
                ) : (
                  (batches.data ?? []).map((batch) => (
                    <button
                      key={batch.id}
                      type="button"
                      onClick={() => {
                        setSelectedBatchId(batch.id);
                        setBatchItemsPage(1);
                        clearSelection();
                      }}
                      className={cn(
                        "w-full rounded-lg px-3 py-2 text-start text-sm transition",
                        batch.id === effectiveSelectedBatchId ? "bg-primary text-primary-foreground" : "hover:bg-muted",
                      )}
                    >
                      <div className="font-semibold">{t("batchLabel", { no: batch.batchNo })}</div>
                      <div
                        className={cn(
                          "text-[11px]",
                          batch.id === effectiveSelectedBatchId ? "text-primary-foreground/80" : "text-muted-foreground",
                        )}
                      >
                        {new Date(batch.performedAt).toLocaleDateString(locale)} · {t("batchEmployeeCount", { count: batch.count })}
                      </div>
                    </button>
                  ))
                )}
              </div>
              <div className="min-w-0 flex-1">
                <PayrollTable
                  items={batchItemsQuery.data?.data ?? []}
                  emptyLabel={t("empty")}
                  selection={{
                    isSelected,
                    onToggle: toggleSelect,
                    onToggleAll: () => toggleSelectAllFor((batchItemsQuery.data?.data ?? []).map((i) => i.id)),
                  }}
                  pagination={batchItemsQuery.data?.meta ? { meta: batchItemsQuery.data.meta, onPageChange: setBatchItemsPage } : undefined}
                  rowActions={(item) => ({
                    canReject: canReject(item.status),
                    canMarkPaid: canMarkPaid(item.status),
                    canRevert: canRevert(item.status),
                  })}
                  onViewPayslip={setPayslipItemId}
                  onReject={(item) => setConfirmState({ action: "reject", items: [item] })}
                  onMarkPaid={(itemId) => {
                    setMutationError(null);
                    markPaidMutation.mutate({ itemId }, { onError: onMutationError });
                  }}
                  onRevert={(itemId) => {
                    setMutationError(null);
                    revertMutation.mutate({ itemId }, { onError: onMutationError });
                  }}
                />
              </div>
            </div>
          )}
        </>
      )}

      <PayslipDialog
        itemId={payslipItemId}
        runId={runId ?? ""}
        onClose={() => setPayslipItemId(null)}
        onApprove={(item) => {
          setPayslipItemId(null);
          setConfirmState({ action: "approve", items: [item] });
        }}
      />
      <PayrollConfirmDialog
        state={confirmState}
        onClose={() => setConfirmState(null)}
        onConfirm={handleConfirm}
        isPending={isConfirmPending}
      />
      <PayrollGenerateConfirmDialog
        state={generateConfirmState}
        onClose={() => setGenerateConfirmState(null)}
        onConfirm={confirmGenerate}
        isPending={generateRun.isPending}
      />
    </div>
  );
}

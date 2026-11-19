"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  BulkPayrollActionInput,
  EditPayrollItemInput,
  GeneratePayrollRunInput,
  GetPayrollRunQuery,
  Paginated,
  PayrollBatch,
  PayrollItemDetail,
  PayrollItemSummary,
  PayrollRun,
  PayrollRunPreview,
  PayrollTab,
} from "@keystonehr/shared";
import { api } from "@/lib/api-client";
import { toQueryString } from "@/lib/queries/query-string";

/** Look up a run without generating one — null means "not generated yet". */
export function usePayrollRun(branchId: string | undefined, payrollMonth: string | undefined) {
  return useQuery({
    queryKey: ["payroll", "run", branchId, payrollMonth],
    queryFn: () =>
      api<PayrollRun | null>(`/payroll/runs${toQueryString({ branchId, payrollMonth })}`),
    enabled: Boolean(branchId && payrollMonth),
  });
}

/**
 * Idempotent for the run itself — POSTing for an existing (branch, month)
 * just returns it, but the API also syncs in any staff newly eligible for
 * this branch since generation, so refresh the item/batch lists too.
 */
export function useGeneratePayrollRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: GeneratePayrollRunInput) =>
      api<PayrollRun>("/payroll/runs", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: (run) => {
      queryClient.setQueryData(["payroll", "run", run.branchId, run.payrollMonth], run);
      invalidateRun(queryClient, run.id);
    },
  });
}

/** User-triggered on button click (not passively rendered) — a GET wrapped in useMutation, like the other actions here. */
export function usePreviewPayrollRun() {
  return useMutation({
    mutationFn: (input: GetPayrollRunQuery) =>
      api<PayrollRunPreview>(`/payroll/runs/preview${toQueryString(input)}`),
  });
}

const PAGE_SIZE = 25;

export function usePayrollItems(runId: string | undefined, tab: PayrollTab, page: number) {
  return useQuery({
    queryKey: ["payroll", "items", runId, tab, page, PAGE_SIZE],
    queryFn: () =>
      api<Paginated<PayrollItemSummary>>(
        `/payroll/runs/${runId}/items${toQueryString({ tab, page, pageSize: PAGE_SIZE })}`,
      ),
    enabled: Boolean(runId),
  });
}

/** Lightweight batch menu — no nested items; see usePayrollBatchItems for one batch's paginated items. */
export function usePayrollBatches(runId: string | undefined, tab: "approved" | "rejected") {
  return useQuery({
    queryKey: ["payroll", "batches", runId, tab],
    queryFn: () => api<PayrollBatch[]>(`/payroll/runs/${runId}/batches${toQueryString({ tab })}`),
    enabled: Boolean(runId),
  });
}

export function usePayrollBatchItems(runId: string | undefined, batchId: string | undefined, page: number) {
  return useQuery({
    queryKey: ["payroll", "batchItems", runId, batchId, page, PAGE_SIZE],
    queryFn: () =>
      api<Paginated<PayrollItemSummary>>(
        `/payroll/runs/${runId}/batches/${batchId}/items${toQueryString({ page, pageSize: PAGE_SIZE })}`,
      ),
    enabled: Boolean(runId && batchId),
  });
}

export function usePayrollItem(itemId: string | undefined) {
  return useQuery({
    queryKey: ["payroll", "item", itemId],
    queryFn: () => api<PayrollItemDetail>(`/payroll/items/${itemId}`),
    enabled: Boolean(itemId),
  });
}

function invalidateRun(queryClient: ReturnType<typeof useQueryClient>, runId: string) {
  queryClient.invalidateQueries({ queryKey: ["payroll", "items", runId] });
  queryClient.invalidateQueries({ queryKey: ["payroll", "batches", runId] });
  queryClient.invalidateQueries({ queryKey: ["payroll", "batchItems", runId] });
}

export function useEditPayrollItem(runId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, input }: { itemId: string; input: EditPayrollItemInput }) =>
      api<PayrollItemDetail>(`/payroll/items/${itemId}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    onSuccess: (detail) => {
      queryClient.setQueryData(["payroll", "item", detail.id], detail);
      invalidateRun(queryClient, runId);
    },
  });
}

function useItemAction(runId: string, action: "approve" | "reject" | "mark-paid" | "revert" | "recompute") {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, reason }: { itemId: string; reason?: string }) =>
      api<PayrollItemDetail>(`/payroll/items/${itemId}/${action}`, {
        method: "POST",
        body: action === "reject" ? JSON.stringify({ reason }) : undefined,
      }),
    onSuccess: (detail) => {
      queryClient.setQueryData(["payroll", "item", detail.id], detail);
      invalidateRun(queryClient, runId);
    },
  });
}

export const useApprovePayrollItem = (runId: string) => useItemAction(runId, "approve");
export const useRejectPayrollItem = (runId: string) => useItemAction(runId, "reject");
export const useMarkPayrollItemPaid = (runId: string) => useItemAction(runId, "mark-paid");
export const useRevertPayrollItem = (runId: string) => useItemAction(runId, "revert");
export const useRecomputePayrollItem = (runId: string) => useItemAction(runId, "recompute");

export function useBulkApprovePayrollItems(runId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: BulkPayrollActionInput) =>
      api<void>(`/payroll/runs/${runId}/bulk-approve`, { method: "POST", body: JSON.stringify(input) }),
    onSuccess: () => invalidateRun(queryClient, runId),
  });
}

export function useBulkRejectPayrollItems(runId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: BulkPayrollActionInput) =>
      api<void>(`/payroll/runs/${runId}/bulk-reject`, { method: "POST", body: JSON.stringify(input) }),
    onSuccess: () => invalidateRun(queryClient, runId),
  });
}

export function useBulkMarkPayrollItemsPaid(runId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: BulkPayrollActionInput) =>
      api<void>(`/payroll/runs/${runId}/bulk-mark-paid`, { method: "POST", body: JSON.stringify(input) }),
    onSuccess: () => invalidateRun(queryClient, runId),
  });
}

export function useBulkRevertPayrollItems(runId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: BulkPayrollActionInput) =>
      api<void>(`/payroll/runs/${runId}/bulk-revert`, { method: "POST", body: JSON.stringify(input) }),
    onSuccess: () => invalidateRun(queryClient, runId),
  });
}

export function useBulkRecomputePayrollItems(runId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: BulkPayrollActionInput) =>
      api<void>(`/payroll/runs/${runId}/bulk-recompute`, { method: "POST", body: JSON.stringify(input) }),
    onSuccess: () => invalidateRun(queryClient, runId),
  });
}

/** Not a query — triggers a browser download of the rendered PDF. */
export async function downloadPayslipPdf(itemId: string, locale: string, filenameHint: string) {
  const res = await fetch(`/api/proxy/payroll/items/${itemId}/payslip.pdf?locale=${locale}`);
  if (!res.ok) throw new Error("Failed to download payslip");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${filenameHint}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

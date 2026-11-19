"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CheckoutInput, Invoice, Paginated, Product, WalkIn } from "@keystonehr/shared";
import { api } from "@/lib/api-client";
import { toQueryString } from "@/lib/queries/query-string";

export interface ProductListParams {
  page?: number;
  pageSize?: number;
  status?: "active" | "inactive";
  branchId?: string;
  search?: string;
}

export function useProducts(params: ProductListParams) {
  return useQuery({
    queryKey: ["products", params],
    queryFn: () => api<Paginated<Product>>(`/products${toQueryString(params)}`),
    enabled: !!params.branchId,
  });
}

/** Tax components for a branch — same shape computeInvoiceTotals() wants, so the
 *  POS screen's displayed totals match the server's to the baisa. */
export interface PosBranch {
  currency: string;
  taxComponents: { name: string; ratePercent: number }[];
}

export function usePosBranch(branchId: string | undefined) {
  return useQuery({
    queryKey: ["pos-branch", branchId],
    queryFn: async (): Promise<PosBranch> => {
      const b = await api<{
        currency: string;
        taxProfile: { components: { name: string; ratePercent: string | number }[] } | null;
      }>(`/branches/${branchId}`);
      return {
        currency: b.currency,
        taxComponents: (b.taxProfile?.components ?? []).map((c) => ({
          name: c.name,
          ratePercent: Number(c.ratePercent),
        })),
      };
    },
    enabled: !!branchId,
  });
}

export function useInvoice(invoiceId: string | null) {
  return useQuery({
    queryKey: ["invoice", invoiceId],
    queryFn: () => api<Invoice>(`/pos/invoices/${invoiceId}`),
    enabled: !!invoiceId,
  });
}

export function useCheckout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CheckoutInput) =>
      api<Invoice>("/pos/checkout", {
        method: "POST",
        body: JSON.stringify(input),
        // idempotency: one key per submit attempt — a retried network call reuses it
        headers: { "idempotency-key": crypto.randomUUID() },
      }),
    // A walk-in checkout flips the queue entry to completed — refresh the queue list/board/stats.
    // A checkout with a customerId bumps that customer's visits/totalSpendMinor server-side; one
    // with an appointmentId links the invoice back onto it — refresh whichever is already open.
    onSuccess: (_invoice, input) => {
      if (input.walkInId) {
        void qc.invalidateQueries({ queryKey: ["walk-ins"] });
        void qc.invalidateQueries({ queryKey: ["walk-in"] });
        void qc.invalidateQueries({ queryKey: ["walk-in-stats"] });
      }
      if (input.customerId) {
        void qc.invalidateQueries({ queryKey: ["customers"] });
        void qc.invalidateQueries({ queryKey: ["customer", input.customerId] });
      }
      if (input.appointmentId) {
        void qc.invalidateQueries({ queryKey: ["appointments"] });
        void qc.invalidateQueries({ queryKey: ["appointment", input.appointmentId] });
      }
    },
  });
}

/** Walk-in → POS prefill via the pos.use-gated endpoint (a cashier may lack walkin.view). */
export function useWalkInForCheckout(walkInId: string | null) {
  return useQuery({
    queryKey: ["walk-in", walkInId, "checkout"],
    queryFn: () => api<WalkIn>(`/pos/walk-ins/${walkInId}`),
    enabled: !!walkInId,
  });
}

/** Not a query — triggers a browser download of the rendered PDF. */
export async function downloadInvoicePdf(invoiceId: string, locale: string, filenameHint: string) {
  const res = await fetch(`/api/proxy/pos/invoices/${invoiceId}/invoice.pdf?locale=${locale}`);
  if (!res.ok) throw new Error("Failed to download invoice");
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

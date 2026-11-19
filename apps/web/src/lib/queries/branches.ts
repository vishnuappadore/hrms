"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  Branch,
  BranchStats,
  CreateBranchInput,
  Paginated,
  UpdateBranchInput,
} from "@keystonehr/shared";
import { api } from "@/lib/api-client";
import { toQueryString } from "@/lib/queries/query-string";

export interface BranchListParams {
  page?: number;
  pageSize?: number;
  sort?: string;
  type?: "corporate" | "franchise";
  status?: "active" | "inactive";
  search?: string;
}

/** Full branch payload returned by GET /branches/:id (form prefill). */
export type BranchDetail = Branch & {
  managerUserId: string | null;
  mobile: string;
  landphone: string | null;
  email: string;
  whatsapp: string | null;
  state: string;
  address: string;
  googleMapsUrl: string | null;
  workingHours: { openingTime: string; closingTime: string; weeklyOffDays: string[] };
  allowOnlineBooking: boolean;
  allowWalkIns: boolean;
  enableLoyalty: boolean;
  enableProductSales: boolean;
  branchServices: { serviceId: string; isAvailable: boolean }[];
  franchiseDetails: {
    franchiseOwnerId: string;
    agreementStartDate: string;
    agreementExpiryDate: string;
    owner: { id: string; ownerName: string; companyName: string };
  } | null;
  createdAt: string | Date;
  updatedAt: string | Date;
};

export function useBranches(params: BranchListParams) {
  return useQuery({
    queryKey: ["branches", params],
    queryFn: () => api<Paginated<Branch>>(`/branches${toQueryString(params)}`),
  });
}

export function useBranchStats() {
  return useQuery({
    queryKey: ["branches", "stats"],
    queryFn: () => api<BranchStats>("/branches/stats"),
  });
}

export function useBranch(branchId: string) {
  return useQuery({
    queryKey: ["branch", branchId],
    queryFn: () => api<BranchDetail>(`/branches/${branchId}`),
  });
}

export function useCreateBranch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateBranchInput) =>
      api<BranchDetail>("/branches", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["branches"] }),
  });
}

export function useUpdateBranch(branchId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateBranchInput) =>
      api<BranchDetail>(`/branches/${branchId}`, { method: "PATCH", body: JSON.stringify(input) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["branches"] });
      queryClient.invalidateQueries({ queryKey: ["branch", branchId] });
    },
  });
}

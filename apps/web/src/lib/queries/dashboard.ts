"use client";

import { useQuery } from "@tanstack/react-query";
import type { DashboardResponse } from "@keystonehr/shared";
import { api } from "@/lib/api-client";
import { toQueryString } from "@/lib/queries/query-string";

export function useDashboard(params: { branchId?: string }) {
  return useQuery({
    queryKey: ["dashboard", params],
    queryFn: () => api<DashboardResponse>(`/dashboard${toQueryString(params)}`),
    refetchInterval: 60_000,
  });
}

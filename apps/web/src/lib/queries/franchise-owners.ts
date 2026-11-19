"use client";

import { useQuery } from "@tanstack/react-query";
import type { FranchiseOwner, Paginated } from "@keystonehr/shared";
import { api } from "@/lib/api-client";

/** Dropdown feed — first 100 owners is plenty at salon-chain scale. */
export function useFranchiseOwners(enabled = true) {
  return useQuery({
    queryKey: ["franchise-owners"],
    queryFn: () => api<Paginated<FranchiseOwner>>("/franchise-owners?pageSize=100"),
    enabled,
  });
}

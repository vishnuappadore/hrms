"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  PayrollComponent,
  PayrollComponentCategory,
  SavePayrollComponentsInput,
} from "@keystonehr/shared";
import { api } from "@/lib/api-client";
import { toQueryString } from "@/lib/queries/query-string";

export function usePayrollComponents(category?: PayrollComponentCategory) {
  return useQuery({
    queryKey: ["payroll-components", category],
    queryFn: () =>
      api<PayrollComponent[]>(`/payroll-components${toQueryString({ category })}`),
  });
}

/** One bulk call replacing the full active set for `category` — the Settings screen's "Save Changes". */
export function useSavePayrollComponents(category: PayrollComponentCategory) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SavePayrollComponentsInput) =>
      api<PayrollComponent[]>(`/payroll-components${toQueryString({ category })}`, {
        method: "PUT",
        body: JSON.stringify(input),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["payroll-components"] }),
  });
}

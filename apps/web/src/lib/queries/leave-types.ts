"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateLeaveTypeInput, LeaveType, UpdateLeaveTypeInput } from "@keystonehr/shared";
import { api } from "@/lib/api-client";
import { toQueryString } from "@/lib/queries/query-string";

export function useLeaveTypes(includeInactive = false) {
  return useQuery({
    queryKey: ["leave-types", { includeInactive }],
    queryFn: () => api<LeaveType[]>(`/leave-types${toQueryString({ includeInactive })}`),
  });
}

export function useCreateLeaveType() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateLeaveTypeInput) =>
      api<LeaveType>("/leave-types", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["leave-types"] }),
  });
}

export function useUpdateLeaveType() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateLeaveTypeInput }) =>
      api<LeaveType>(`/leave-types/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["leave-types"] }),
  });
}

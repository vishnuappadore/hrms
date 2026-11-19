"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateRoleInput, RoleDetail, RoleSummary, UpdateRoleInput } from "@keystonehr/shared";
import { api } from "@/lib/api-client";

export function useRoleSummaries() {
  return useQuery({
    queryKey: ["roles", "summaries"],
    queryFn: () => api<RoleSummary[]>("/roles/summaries"),
  });
}

export function useRoleDetail(roleId: string | undefined) {
  return useQuery({
    queryKey: ["roles", "detail", roleId],
    queryFn: () => api<RoleDetail>(`/roles/${roleId}`),
    enabled: !!roleId,
  });
}

function invalidateRoleQueries(queryClient: ReturnType<typeof useQueryClient>, roleId?: string) {
  queryClient.invalidateQueries({ queryKey: ["roles"] });
  if (roleId) queryClient.invalidateQueries({ queryKey: ["roles", "detail", roleId] });
}

export function useCreateRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateRoleInput) =>
      api<RoleDetail>("/roles", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: () => invalidateRoleQueries(queryClient),
  });
}

export function useUpdateRole(roleId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateRoleInput) =>
      api<RoleDetail>(`/roles/${roleId}`, { method: "PATCH", body: JSON.stringify(input) }),
    onSuccess: () => invalidateRoleQueries(queryClient, roleId),
  });
}

export function useDeleteRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (roleId: string) => api<void>(`/roles/${roleId}`, { method: "DELETE" }),
    onSuccess: () => invalidateRoleQueries(queryClient),
  });
}

"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AuthUser,
  CreateStaffInput,
  Paginated,
  Role,
  Staff,
  UpdateStaffInput,
  User,
} from "@keystonehr/shared";
import { api } from "@/lib/api-client";
import { toQueryString } from "@/lib/queries/query-string";

export interface UserListParams {
  page?: number;
  pageSize?: number;
  sort?: string;
  roleId?: string;
  branchId?: string;
  status?: "active" | "inactive";
  search?: string;
}

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: () => api<AuthUser>("/users/me"),
    staleTime: 5 * 60_000,
  });
}

export function useUsers(params: UserListParams) {
  return useQuery({
    queryKey: ["users", params],
    queryFn: () => api<Paginated<User>>(`/users${toQueryString(params)}`),
  });
}

export function useUser(userId: string) {
  return useQuery({
    queryKey: ["user", userId],
    queryFn: () => api<Staff>(`/users/${userId}`),
  });
}

export function useRoles() {
  return useQuery({
    queryKey: ["roles"],
    queryFn: () => api<Role[]>("/roles"),
    staleTime: 5 * 60_000, // seeded system roles barely change
  });
}

export function useCreateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateStaffInput) =>
      api<Staff>("/users", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["users"] }),
  });
}

export function useUpdateUser(userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateStaffInput) =>
      api<Staff>(`/users/${userId}`, { method: "PATCH", body: JSON.stringify(input) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      queryClient.invalidateQueries({ queryKey: ["user", userId] });
    },
  });
}

export function useResetUserPassword() {
  return useMutation({
    mutationFn: ({ userId, password }: { userId: string; password: string }) =>
      api<{ success: true }>(`/users/${userId}/reset-password`, {
        method: "POST",
        body: JSON.stringify({ password }),
      }),
  });
}

"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AuthUser,
  CreateEmployeeInput,
  Employee,
  Paginated,
  Role,
  UpdateEmployeeInput,
  User,
} from "@keystonehr/shared";
import { api } from "@/lib/api-client";
import { toQueryString } from "@/lib/queries/query-string";

export interface EmployeeListParams {
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
    queryFn: () => api<AuthUser>("/employees/me"),
    staleTime: 5 * 60_000,
  });
}

export function useEmployees(params: EmployeeListParams) {
  return useQuery({
    queryKey: ["employees", params],
    queryFn: () => api<Paginated<User>>(`/employees${toQueryString(params)}`),
  });
}

export function useEmployee(userId: string) {
  return useQuery({
    queryKey: ["employee", userId],
    queryFn: () => api<Employee>(`/employees/${userId}`),
  });
}

export function useRoles() {
  return useQuery({
    queryKey: ["roles"],
    queryFn: () => api<Role[]>("/roles"),
    staleTime: 5 * 60_000, // seeded system roles barely change
  });
}

export function useCreateEmployee() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateEmployeeInput) =>
      api<Employee>("/employees", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["employees"] }),
  });
}

export function useUpdateEmployee(userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateEmployeeInput) =>
      api<Employee>(`/employees/${userId}`, { method: "PATCH", body: JSON.stringify(input) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      queryClient.invalidateQueries({ queryKey: ["employee", userId] });
    },
  });
}

export function useResetEmployeePassword() {
  return useMutation({
    mutationFn: ({ userId, password }: { userId: string; password: string }) =>
      api<{ success: true }>(`/employees/${userId}/reset-password`, {
        method: "POST",
        body: JSON.stringify({ password }),
      }),
  });
}

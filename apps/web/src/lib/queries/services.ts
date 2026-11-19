"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateServiceCategoryInput,
  CreateServiceInput,
  Paginated,
  Service,
  ServiceCategory,
  UpdateServiceCategoryInput,
  UpdateServiceInput,
} from "@keystonehr/shared";
import { api } from "@/lib/api-client";
import { toQueryString } from "@/lib/queries/query-string";

export interface ServiceListParams {
  page?: number;
  pageSize?: number;
  sort?: string;
  categoryId?: string;
  status?: "active" | "inactive";
  /** only services offered at this branch (exception rows respected) */
  branchId?: string;
  search?: string;
}

export function useServiceCategories() {
  return useQuery({
    queryKey: ["service-categories"],
    queryFn: () => api<ServiceCategory[]>("/service-categories"),
  });
}

export function useCreateServiceCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateServiceCategoryInput) =>
      api<ServiceCategory>("/service-categories", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["service-categories"] }),
  });
}

export function useUpdateServiceCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateServiceCategoryInput & { id: string }) =>
      api<ServiceCategory>(`/service-categories/${id}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["service-categories"] });
      queryClient.invalidateQueries({ queryKey: ["services"] });
    },
  });
}

export function useServices(params: ServiceListParams) {
  return useQuery({
    queryKey: ["services", params],
    queryFn: () => api<Paginated<Service>>(`/services${toQueryString(params)}`),
  });
}

export function useService(serviceId: string) {
  return useQuery({
    queryKey: ["service", serviceId],
    queryFn: () => api<Service>(`/services/${serviceId}`),
  });
}

export function useCreateService() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateServiceInput) =>
      api<Service>("/services", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["services"] });
      queryClient.invalidateQueries({ queryKey: ["service-categories"] });
    },
  });
}

export function useUpdateService(serviceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateServiceInput) =>
      api<Service>(`/services/${serviceId}`, { method: "PATCH", body: JSON.stringify(input) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["services"] });
      queryClient.invalidateQueries({ queryKey: ["service", serviceId] });
      queryClient.invalidateQueries({ queryKey: ["service-categories"] });
    },
  });
}

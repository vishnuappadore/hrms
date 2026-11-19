"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateCustomerInput,
  Customer,
  CustomerTier,
  Paginated,
  PresignCustomerPhotoInput,
  PresignedUpload,
  UpdateCustomerInput,
} from "@keystonehr/shared";
import { api } from "@/lib/api-client";
import { toQueryString } from "@/lib/queries/query-string";

export interface CustomerListParams {
  page?: number;
  pageSize?: number;
  sort?: string;
  tier?: CustomerTier;
  search?: string;
}

export function useCustomers(params: CustomerListParams) {
  return useQuery({
    queryKey: ["customers", params],
    queryFn: () => api<Paginated<Customer>>(`/customers${toQueryString(params)}`),
  });
}

export function useCustomer(customerId: string) {
  return useQuery({
    queryKey: ["customer", customerId],
    queryFn: () => api<Customer>(`/customers/${customerId}`),
    enabled: !!customerId,
  });
}

export function useCreateCustomer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCustomerInput) =>
      api<Customer>("/customers", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["customers"] }),
  });
}

export function useUpdateCustomer(customerId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateCustomerInput) =>
      api<Customer>(`/customers/${customerId}`, { method: "PATCH", body: JSON.stringify(input) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      queryClient.invalidateQueries({ queryKey: ["customer", customerId] });
    },
  });
}

export function useCustomerPhotoUploadUrl() {
  return useMutation({
    mutationFn: (input: PresignCustomerPhotoInput) =>
      api<PresignedUpload>("/customers/photo-upload-url", { method: "POST", body: JSON.stringify(input) }),
  });
}

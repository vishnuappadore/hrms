"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CancelLeaveRequestInput,
  CreateLeaveRequestInput,
  LeaveBalance,
  LeaveKpis,
  LeaveRequestDetail,
  LeaveRequestSummary,
  LeaveTab,
  Paginated,
  PresignedUpload,
  PresignLeaveAttachmentInput,
  RejectLeaveRequestInput,
} from "@keystonehr/shared";
import { api } from "@/lib/api-client";
import { toQueryString } from "@/lib/queries/query-string";

export interface LeaveListParams {
  tab?: LeaveTab;
  branchId?: string;
  leaveTypeId?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export function useLeaveRequests(params: LeaveListParams) {
  return useQuery({
    queryKey: ["leave", "requests", params],
    queryFn: () => api<Paginated<LeaveRequestSummary>>(`/leave/requests${toQueryString(params)}`),
  });
}

export interface MyLeaveListParams {
  tab?: LeaveTab;
  page?: number;
  pageSize?: number;
}

export function useMyLeaveRequests(params: MyLeaveListParams) {
  return useQuery({
    queryKey: ["leave", "requests", "me", params],
    queryFn: () => api<Paginated<LeaveRequestSummary>>(`/leave/requests/me${toQueryString(params)}`),
  });
}

export function useLeaveKpis(branchId?: string) {
  return useQuery({
    queryKey: ["leave", "kpis", branchId],
    queryFn: () => api<LeaveKpis>(`/leave/kpis${toQueryString({ branchId })}`),
  });
}

export function useMyLeaveBalances() {
  return useQuery({
    queryKey: ["leave", "balances", "me"],
    queryFn: () => api<LeaveBalance[]>("/leave/balances/me"),
  });
}

export function useLeaveBalances(employeeProfileId: string | undefined) {
  return useQuery({
    queryKey: ["leave", "balances", employeeProfileId],
    queryFn: () => api<LeaveBalance[]>(`/leave/balances/${employeeProfileId}`),
    enabled: !!employeeProfileId,
  });
}

export function useCreateLeaveRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateLeaveRequestInput) =>
      api<LeaveRequestSummary>("/leave/requests", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["leave"] }),
  });
}

export function useApproveLeaveRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<LeaveRequestSummary>(`/leave/requests/${id}/approve`, { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["leave"] }),
  });
}

export function useRejectLeaveRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: RejectLeaveRequestInput }) =>
      api<LeaveRequestSummary>(`/leave/requests/${id}/reject`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["leave"] }),
  });
}

export function useCancelLeaveRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: CancelLeaveRequestInput }) =>
      api<LeaveRequestSummary>(`/leave/requests/${id}/cancel`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["leave"] }),
  });
}

export function useWithdrawLeaveRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<LeaveRequestSummary>(`/leave/requests/${id}/withdraw`, { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["leave"] }),
  });
}

export function useLeaveRequestDetail(id: string | undefined) {
  return useQuery({
    queryKey: ["leave", "requests", "detail", id],
    queryFn: () => api<LeaveRequestDetail>(`/leave/requests/${id}`),
    enabled: !!id,
  });
}

export function usePresignLeaveAttachment() {
  return useMutation({
    mutationFn: (input: PresignLeaveAttachmentInput) =>
      api<PresignedUpload>("/leave/attachments/presign-upload", { method: "POST", body: JSON.stringify(input) }),
  });
}

export function useLeaveAttachmentUrl() {
  return useMutation({
    mutationFn: (id: string) => api<{ url: string }>(`/leave/requests/${id}/attachment-url`),
  });
}

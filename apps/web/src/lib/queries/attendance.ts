"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AttendanceDayDetail,
  AttendanceDaySummary,
  AttendanceKpis,
  AttendanceMonthlyAggregate,
  AttendanceMonthlyDetail,
  AttendanceScope,
  MyAttendanceToday,
  Paginated,
  UpdateAttendanceDayInput,
} from "@keystonehr/shared";
import { api } from "@/lib/api-client";
import { toQueryString } from "@/lib/queries/query-string";

export interface AttendanceListParams {
  scope: AttendanceScope;
  date?: string;
  month?: string;
  branchId?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export function useAttendanceList(params: AttendanceListParams) {
  return useQuery({
    queryKey: ["attendance", "list", params],
    queryFn: () =>
      api<Paginated<AttendanceDaySummary | AttendanceMonthlyAggregate>>(
        `/attendance${toQueryString(params)}`,
      ),
  });
}

export function useAttendanceKpis(params: Omit<AttendanceListParams, "page" | "pageSize">) {
  return useQuery({
    queryKey: ["attendance", "kpis", params],
    queryFn: () => api<AttendanceKpis>(`/attendance/kpis${toQueryString(params)}`),
  });
}

export function useAttendanceDay(employeeProfileId: string | undefined, date: string | undefined) {
  return useQuery({
    queryKey: ["attendance", "day", employeeProfileId, date],
    queryFn: () => api<AttendanceDayDetail>(`/attendance/${employeeProfileId}/days/${date}`),
    enabled: !!employeeProfileId && !!date,
  });
}

export function useAttendanceMonthlyDetail(employeeProfileId: string | undefined, month: string | undefined) {
  return useQuery({
    queryKey: ["attendance", "monthly-detail", employeeProfileId, month],
    queryFn: () => api<AttendanceMonthlyDetail>(`/attendance/${employeeProfileId}/monthly?month=${month}`),
    enabled: !!employeeProfileId && !!month,
  });
}

export function useUpdateAttendanceDay() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      employeeProfileId,
      date,
      input,
    }: {
      employeeProfileId: string;
      date: string;
      input: UpdateAttendanceDayInput;
    }) =>
      api<AttendanceDayDetail>(`/attendance/${employeeProfileId}/days/${date}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["attendance"] }),
  });
}

export function useMyAttendanceToday() {
  return useQuery({
    queryKey: ["attendance", "me", "today"],
    queryFn: () => api<MyAttendanceToday>("/attendance/me/today"),
  });
}

export function useCheckIn() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api<MyAttendanceToday>("/attendance/check-in", { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["attendance"] }),
  });
}

export function useCheckOut() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api<MyAttendanceToday>("/attendance/check-out", { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["attendance"] }),
  });
}

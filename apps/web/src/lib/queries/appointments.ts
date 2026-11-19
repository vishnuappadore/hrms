"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  Appointment,
  AppointmentBarber,
  AppointmentSlot,
  AppointmentStatus,
  CreateAppointmentInput,
  Paginated,
  UpdateAppointmentInput,
} from "@keystonehr/shared";
import { api } from "@/lib/api-client";
import { toQueryString } from "@/lib/queries/query-string";

export interface AppointmentListParams {
  page?: number;
  pageSize?: number;
  sort?: string;
  branchId?: string;
  status?: AppointmentStatus;
  barberId?: string;
  customerId?: string;
  search?: string;
  from?: string;
  to?: string;
}

/** The status-machine actions exposed on the Appointment Details modal. */
export type AppointmentAction = "confirm" | "start" | "complete" | "cancel";

export function useAppointments(params: AppointmentListParams) {
  return useQuery({
    queryKey: ["appointments", params],
    queryFn: () => api<Paginated<Appointment>>(`/appointments${toQueryString(params)}`),
    // the dashboard always operates within one selected branch; don't fetch
    // (unscoped) until it's known — a customerId query (Customer Details'
    // visit history) is the one case that's intentionally unscoped, spanning
    // every branch the caller can see.
    enabled: !!params.branchId || !!params.customerId,
  });
}

export function useAppointment(appointmentId: string | null) {
  return useQuery({
    queryKey: ["appointment", appointmentId],
    queryFn: () => api<Appointment>(`/appointments/${appointmentId}`),
    enabled: !!appointmentId,
  });
}

export function useAppointmentBarbers(branchId: string | undefined) {
  return useQuery({
    queryKey: ["appointment-barbers", branchId],
    queryFn: () => api<AppointmentBarber[]>(`/appointments/barbers${toQueryString({ branchId })}`),
    enabled: !!branchId,
  });
}

export function useAppointmentSlots(params: {
  branchId?: string;
  barberId?: string;
  date?: string;
  durationMinutes?: number;
  /** editing this appointment — exclude its own current slot from the "taken" check */
  excludeAppointmentId?: string;
}) {
  const ready = !!params.branchId && !!params.barberId && !!params.date && !!params.durationMinutes;
  return useQuery({
    queryKey: ["appointment-slots", params],
    queryFn: () => api<AppointmentSlot[]>(`/appointments/slots${toQueryString(params)}`),
    enabled: ready,
  });
}

export function useCreateAppointment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAppointmentInput) =>
      api<Appointment>("/appointments", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["appointments"] }),
  });
}

export function useUpdateAppointment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateAppointmentInput }) =>
      api<Appointment>(`/appointments/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["appointments"] });
      queryClient.invalidateQueries({ queryKey: ["appointment", id] });
    },
  });
}

export function useAppointmentAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: AppointmentAction }) =>
      api<Appointment>(`/appointments/${id}/${action}`, { method: "POST" }),
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["appointments"] });
      queryClient.invalidateQueries({ queryKey: ["appointment", id] });
    },
  });
}

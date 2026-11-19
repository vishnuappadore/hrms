"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AssignWalkInBarberInput,
  CreateWalkInInput,
  Paginated,
  UpdateWalkInInput,
  WalkIn,
  WalkInStats,
  WalkInStatus,
} from "@keystonehr/shared";
import { api } from "@/lib/api-client";
import { toQueryString } from "@/lib/queries/query-string";

export interface WalkInListParams {
  page?: number;
  pageSize?: number;
  sort?: string;
  branchId?: string;
  status?: WalkInStatus;
  search?: string;
  /** ISO instant — board mode, see ListWalkInsQuerySchema.boardSince */
  boardSince?: string;
}

/** The status-machine actions exposed on the Walk-in Queue's row/card actions. */
export type WalkInAction = "start" | "complete" | "cancel";

export function useWalkIns(params: WalkInListParams) {
  return useQuery({
    queryKey: ["walk-ins", params],
    queryFn: () => api<Paginated<WalkIn>>(`/walk-ins${toQueryString(params)}`),
    enabled: !!params.branchId,
  });
}

export function useWalkIn(walkInId: string | null) {
  return useQuery({
    queryKey: ["walk-in", walkInId],
    queryFn: () => api<WalkIn>(`/walk-ins/${walkInId}`),
    enabled: !!walkInId,
  });
}

export function useWalkInStats(branchId: string | undefined) {
  return useQuery({
    queryKey: ["walk-in-stats", branchId],
    queryFn: () => api<WalkInStats>(`/walk-ins/stats${toQueryString({ branchId })}`),
    enabled: !!branchId,
  });
}

export function useCreateWalkIn() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateWalkInInput) =>
      api<WalkIn>("/walk-ins", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["walk-ins"] });
      queryClient.invalidateQueries({ queryKey: ["walk-in-stats"] });
    },
  });
}

export function useUpdateWalkIn() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateWalkInInput }) =>
      api<WalkIn>(`/walk-ins/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["walk-ins"] });
      queryClient.invalidateQueries({ queryKey: ["walk-in", id] });
      queryClient.invalidateQueries({ queryKey: ["walk-in-stats"] });
    },
  });
}

export function useAssignWalkInBarber() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: AssignWalkInBarberInput }) =>
      api<WalkIn>(`/walk-ins/${id}/barber`, { method: "PATCH", body: JSON.stringify(input) }),
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["walk-ins"] });
      queryClient.invalidateQueries({ queryKey: ["walk-in", id] });
    },
  });
}

export function useWalkInAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: WalkInAction }) =>
      api<WalkIn>(`/walk-ins/${id}/${action}`, { method: "POST" }),
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["walk-ins"] });
      queryClient.invalidateQueries({ queryKey: ["walk-in", id] });
      queryClient.invalidateQueries({ queryKey: ["walk-in-stats"] });
    },
  });
}

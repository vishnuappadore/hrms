"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { GeneralSettings, UpdateGeneralSettingsInput } from "@keystonehr/shared";
import { api } from "@/lib/api-client";

export function useGeneralSettings() {
  return useQuery({
    queryKey: ["general-settings"],
    queryFn: () => api<GeneralSettings>("/settings/general"),
  });
}

export function useUpdateGeneralSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateGeneralSettingsInput) =>
      api<GeneralSettings>("/settings/general", { method: "PATCH", body: JSON.stringify(input) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["general-settings"] }),
  });
}

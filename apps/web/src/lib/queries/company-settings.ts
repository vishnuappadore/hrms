"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CompanySettings,
  PresignCompanyLogoInput,
  PresignedCompanyLogoUpload,
  UpdateCompanySettingsInput,
} from "@keystonehr/shared";
import { api } from "@/lib/api-client";

export function useCompanySettings() {
  return useQuery({
    queryKey: ["company-settings"],
    queryFn: () => api<CompanySettings>("/settings/company"),
  });
}

export function useUpdateCompanySettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateCompanySettingsInput) =>
      api<CompanySettings>("/settings/company", { method: "PATCH", body: JSON.stringify(input) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["company-settings"] }),
  });
}

export function useCompanyLogoUploadUrl() {
  return useMutation({
    mutationFn: (input: PresignCompanyLogoInput) =>
      api<PresignedCompanyLogoUpload>("/settings/company/logo-upload-url", {
        method: "POST",
        body: JSON.stringify(input),
      }),
  });
}

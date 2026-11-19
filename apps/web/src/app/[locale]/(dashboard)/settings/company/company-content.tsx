"use client";

import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { Building2, Upload } from "lucide-react";
import { UpdateCompanySettingsSchema, type UpdateCompanySettingsInput } from "@keystonehr/shared";
import { ApiError } from "@/lib/api-client";
import { BackLink } from "@/components/back-link";
import { Link } from "@/i18n/navigation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { useCompanyLogoUploadUrl, useCompanySettings, useUpdateCompanySettings } from "@/lib/queries/company-settings";

export function CompanyContent() {
  const t = useTranslations("settings.companyInfo");
  const tc = useTranslations("common");
  const { showToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data, isLoading, isError } = useCompanySettings();
  const update = useUpdateCompanySettings();
  const presignLogo = useCompanyLogoUploadUrl();

  const [localLogoPreview, setLocalLogoPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<UpdateCompanySettingsInput>({
    resolver: zodResolver(UpdateCompanySettingsSchema),
    defaultValues: { name: "" },
  });

  useEffect(() => {
    if (!data) return;
    reset({
      name: data.name,
      contactPhone: data.contactPhone ?? "",
      contactEmail: data.contactEmail ?? "",
      address: data.address ?? "",
      taxNumber: data.taxNumber ?? "",
      commercialRegistrationNo: data.commercialRegistrationNo ?? "",
    });
  }, [data, reset]);

  async function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError(null);
    setUploading(true);
    try {
      const { uploadUrl, key } = await presignLogo.mutateAsync({
        fileName: file.name,
        contentType: file.type || "application/octet-stream",
      });
      const res = await fetch(uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
      if (!res.ok) throw new Error("upload failed");
      setValue("logoKey", key, { shouldDirty: true });
      setLocalLogoPreview(URL.createObjectURL(file));
    } catch {
      setUploadError(t("logoUploadFailed"));
    } finally {
      setUploading(false);
    }
  }

  async function onSubmit(values: UpdateCompanySettingsInput) {
    setServerError(null);
    try {
      await update.mutateAsync(values);
      showToast(tc("savedSuccessfully"));
    } catch (error) {
      const code = error instanceof ApiError && error.code === "VALIDATION_FAILED" ? error.code : "GENERIC";
      setServerError(tc(`errors.${code}`));
    }
  }

  const logoSrc = localLogoPreview ?? data?.logoUrl ?? null;

  return (
    <div>
      <BackLink href="/settings" label={t("backToSettings")} />
      <h1 className="mb-1 text-xl font-semibold">{t("title")}</h1>
      <p className="mb-6 text-sm text-muted-foreground">{t("subtitle")}</p>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">{tc("loading")}</p>
      ) : isError ? (
        <Alert>{tc("loadFailed")}</Alert>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} className="max-w-2xl space-y-6" noValidate>
          {serverError && <Alert>{serverError}</Alert>}

          <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold">{t("logoSection")}</h2>
            <div className="flex items-center gap-4">
              <span className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-dashed border-input bg-muted/40">
                {logoSrc ? (
                  <img src={logoSrc} alt="" className="h-full w-full object-contain" />
                ) : (
                  <Building2 className="h-6 w-6 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
                )}
              </span>
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleLogoChange}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={uploading}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
                  {uploading ? t("uploadingLogo") : t("uploadLogo")}
                </Button>
                {uploadError && <p className="mt-1 text-xs text-destructive">{uploadError}</p>}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 rounded-xl border border-border bg-card p-4 shadow-sm sm:grid-cols-2">
            <Field label={t("fields.name")} htmlFor="company-name" required error={errors.name?.message}>
              <Input id="company-name" {...register("name")} />
            </Field>
            <Field label={t("fields.contactPhone")} htmlFor="company-phone" error={errors.contactPhone?.message}>
              <Input id="company-phone" dir="ltr" {...register("contactPhone")} />
            </Field>
            <Field label={t("fields.contactEmail")} htmlFor="company-email" error={errors.contactEmail?.message}>
              <Input id="company-email" dir="ltr" type="email" {...register("contactEmail")} />
            </Field>
            <Field label={t("fields.address")} htmlFor="company-address" error={errors.address?.message}>
              <Input id="company-address" {...register("address")} />
            </Field>
            <Field label={t("fields.taxNumber")} htmlFor="company-tax" error={errors.taxNumber?.message}>
              <Input id="company-tax" dir="ltr" {...register("taxNumber")} />
            </Field>
            <Field
              label={t("fields.commercialRegistrationNo")}
              htmlFor="company-cr"
              error={errors.commercialRegistrationNo?.message}
            >
              <Input id="company-cr" dir="ltr" {...register("commercialRegistrationNo")} />
            </Field>
          </div>

          <Link href="/settings/general" className="block text-sm text-primary hover:underline">
            {t("generalSettingsLink")}
          </Link>

          <div className="flex justify-end">
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? tc("saving") : t("saveChanges")}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

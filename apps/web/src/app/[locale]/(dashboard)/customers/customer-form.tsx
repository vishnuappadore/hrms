"use client";

import { useRef, useState } from "react";
import { Controller, useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { Upload } from "lucide-react";
import {
  CUSTOMER_TIERS,
  CreateCustomerSchema,
  type Customer,
  type CreateCustomerInput,
} from "@keystonehr/shared";
import { Link } from "@/i18n/navigation";
import { ApiError } from "@/lib/api-client";
import { usePermissions } from "@/lib/permissions";
import { useMe } from "@/lib/queries/users";
import { Alert } from "@/components/ui/alert";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { FormDrawerFooter } from "@/components/ui/form-drawer-footer";
import { Input } from "@/components/ui/input";
import { MobileInput } from "@/components/ui/mobile-input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useCreateCustomer, useCustomerPhotoUploadUrl, useUpdateCustomer } from "@/lib/queries/customers";

export function CustomerForm({ customer, onDone }: { customer?: Customer; onDone: () => void }) {
  const t = useTranslations("customers");
  const tc = useTranslations("common");
  const { data: me } = useMe();
  const createCustomer = useCreateCustomer();
  const updateCustomer = useUpdateCustomer(customer?.id ?? "");
  const presignPhoto = useCustomerPhotoUploadUrl();
  const permissions = usePermissions();
  const canSave = permissions.includes(customer ? "customers.update" : "customers.create");
  const [serverError, setServerError] = useState<string | null>(null);
  const [takenMobile, setTakenMobile] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [localPhotoPreview, setLocalPhotoPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<CreateCustomerInput>({
    // zod input type (pre-default) differs from CreateCustomerInput (post-default tier)
    resolver: zodResolver(CreateCustomerSchema) as unknown as Resolver<CreateCustomerInput>,
    defaultValues: customer
      ? { mobile: customer.mobile, name: customer.name, email: customer.email, tier: customer.tier }
      : { mobile: "", tier: "new" },
  });
  const mobile = watch("mobile");
  const photoSrc = localPhotoPreview ?? customer?.photoUrl ?? null;

  async function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError(null);
    setUploading(true);
    try {
      const { uploadUrl, key } = await presignPhoto.mutateAsync({
        fileName: file.name,
        contentType: file.type || "application/octet-stream",
      });
      const res = await fetch(uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
      if (!res.ok) throw new Error("upload failed");
      setValue("photoKey", key, { shouldDirty: true });
      setLocalPhotoPreview(URL.createObjectURL(file));
    } catch {
      setUploadError(t("form.photoUploadFailed"));
    } finally {
      setUploading(false);
    }
  }

  async function onSubmit(values: CreateCustomerInput) {
    setServerError(null);
    setTakenMobile(null);
    try {
      if (customer) await updateCustomer.mutateAsync(values);
      else await createCustomer.mutateAsync(values);
      onDone();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "NETWORK";
      if (code === "CUSTOMER_MOBILE_EXISTS") {
        setError("mobile", { message: "mobileExists" });
        setTakenMobile(values.mobile);
      } else if (code === "CUSTOMER_EMAIL_EXISTS") {
        setError("email", { message: "emailExists" });
      } else {
        setServerError(
          code === "VALIDATION_FAILED" ? tc("errors.VALIDATION_FAILED") : tc("errors.GENERIC"),
        );
      }
    }
  }

  async function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!mobile) {
      setError("mobile", { message: "mobileRequired" });
      return;
    }
    await handleSubmit(onSubmit)(e);
  }

  const err = (path: keyof CreateCustomerInput): string | undefined => {
    const message = errors[path]?.message;
    if (!message) return undefined;
    if (message === "mobileExists") return t("form.errors.mobileExists");
    if (message === "mobileRequired") return t("form.errors.mobileRequired");
    if (path === "mobile") return t("form.errors.mobileInvalid");
    if (message === "nameTooShort") return t("form.errors.nameTooShort");
    if (message === "emailExists") return t("form.errors.emailExists");
    return t("form.errors.invalid");
  };

  return (
    <form onSubmit={handleFormSubmit} className="flex h-full flex-col" noValidate>
      <div className="flex-1 space-y-4">
        <div className="flex items-center gap-4">
          <Avatar name={watch("name") || "?"} src={photoSrc} className="h-16 w-16 text-lg" />
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handlePhotoChange}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
              {uploading ? t("form.uploadingPhoto") : t("form.uploadPhoto")}
            </Button>
            {uploadError && <p className="mt-1 text-xs text-destructive">{uploadError}</p>}
          </div>
        </div>
        <Field label={t("form.mobile")} htmlFor="mobile-number" required error={err("mobile")}>
          <MobileInput
            id="mobile-number"
            value={mobile}
            onChange={(v) => setValue("mobile", v, { shouldValidate: false })}
            defaultCurrency={me?.currency}
          />
        </Field>
        <Field label={t("form.name")} htmlFor="name" required error={err("name")}>
          <Input id="name" {...register("name")} />
        </Field>
        <Field label={t("form.email")} htmlFor="email" error={err("email")}>
          <Input
            id="email"
            type="email"
            dir="ltr"
            {...register("email", { setValueAs: (v: unknown) => (v === "" ? null : v) })}
          />
        </Field>
        <Field label={t("form.tier")} htmlFor="tier">
          <Controller
            control={control}
            name="tier"
            render={({ field }) => (
              <SegmentedControl
                aria-label={t("form.tier")}
                value={field.value}
                onChange={field.onChange}
                options={CUSTOMER_TIERS.map((tier) => ({ value: tier, label: t(`tiers.${tier}`) }))}
              />
            )}
          />
        </Field>

        {takenMobile && (
          <p className="text-sm text-muted-foreground">
            <Link
              href={`/customers?search=${encodeURIComponent(takenMobile)}`}
              className="font-medium text-primary hover:underline"
            >
              {t("form.viewExisting")}
            </Link>
          </p>
        )}

        {serverError && <Alert>{serverError}</Alert>}
      </div>

      <FormDrawerFooter
        onClose={onDone}
        closeLabel={tc("close")}
        submitLabel={isSubmitting ? tc("saving") : customer ? tc("save") : t("addCustomer")}
        submitting={isSubmitting}
        canSubmit={canSave}
      />
    </form>
  );
}

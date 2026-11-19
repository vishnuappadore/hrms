"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { CURRENCY_EXPONENTS, UpdateGeneralSettingsSchema, WEEKDAYS, type UpdateGeneralSettingsInput } from "@keystonehr/shared";
import { ApiError } from "@/lib/api-client";
import { BackLink } from "@/components/back-link";
import { Alert } from "@/components/ui/alert";
import { BoxedToggle } from "@/components/ui/boxed-toggle";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { useGeneralSettings, useUpdateGeneralSettings } from "@/lib/queries/general-settings";

const CURRENCIES = Object.keys(CURRENCY_EXPONENTS);

export function GeneralContent() {
  const t = useTranslations("settings.generalSettings");
  const tDays = useTranslations("branches.days");
  const tc = useTranslations("common");
  const { showToast } = useToast();

  const { data, isLoading, isError } = useGeneralSettings();
  const update = useUpdateGeneralSettings();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<UpdateGeneralSettingsInput>({
    resolver: zodResolver(UpdateGeneralSettingsSchema),
    defaultValues: {
      defaultLocale: "en",
      timezone: "Asia/Muscat",
      defaultCurrency: "OMR",
      useWesternNumeralsInArabic: true,
      weekStartsOn: "sunday",
    },
  });

  useEffect(() => {
    if (!data) return;
    reset({
      defaultLocale: data.defaultLocale as "en" | "ar",
      timezone: data.timezone,
      defaultCurrency: data.defaultCurrency,
      useWesternNumeralsInArabic: data.useWesternNumeralsInArabic,
      weekStartsOn: data.weekStartsOn,
    });
  }, [data, reset]);

  async function onSubmit(values: UpdateGeneralSettingsInput) {
    setServerError(null);
    try {
      await update.mutateAsync(values);
      showToast(tc("savedSuccessfully"));
    } catch (error) {
      const code =
        error instanceof ApiError && error.code === "TENANT_CURRENCY_LOCKED"
          ? error.code
          : error instanceof ApiError && error.code === "VALIDATION_FAILED"
            ? error.code
            : "GENERIC";
      setServerError(code === "TENANT_CURRENCY_LOCKED" ? t("errors.currencyLocked") : tc(`errors.${code}`));
    }
  }

  const currencyLocked = (data?.branchCount ?? 0) > 0;
  const useWesternNumeralsInArabic = watch("useWesternNumeralsInArabic");
  const weekStartsOn = watch("weekStartsOn");

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

          <div className="grid grid-cols-1 gap-4 rounded-xl border border-border bg-card p-4 shadow-sm sm:grid-cols-2">
            <Field label={t("fields.defaultLocale")} htmlFor="general-locale" error={errors.defaultLocale?.message}>
              <Select id="general-locale" {...register("defaultLocale")}>
                <option value="en">{t("locales.en")}</option>
                <option value="ar">{t("locales.ar")}</option>
              </Select>
            </Field>
            <Field label={t("fields.timezone")} htmlFor="general-timezone" error={errors.timezone?.message}>
              <Input id="general-timezone" dir="ltr" placeholder="Asia/Muscat" {...register("timezone")} />
            </Field>
            <Field
              label={t("fields.defaultCurrency")}
              htmlFor="general-currency"
              error={errors.defaultCurrency?.message}
              hint={currencyLocked ? t("currencyLockedHint") : undefined}
            >
              <Select id="general-currency" disabled={currencyLocked} {...register("defaultCurrency")}>
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("fields.weekStartsOn")} htmlFor="general-week-start">
              <Select
                id="general-week-start"
                value={weekStartsOn}
                onChange={(e) => setValue("weekStartsOn", e.target.value as UpdateGeneralSettingsInput["weekStartsOn"], { shouldDirty: true })}
              >
                {WEEKDAYS.map((day) => (
                  <option key={day} value={day}>
                    {tDays(day)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold">{t("displaySection")}</h2>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium">{t("fields.useWesternNumeralsInArabic")}</p>
                <p className="text-xs text-muted-foreground">{t("useWesternNumeralsHint")}</p>
              </div>
              <BoxedToggle
                aria-label={t("fields.useWesternNumeralsInArabic")}
                value={useWesternNumeralsInArabic ? "on" : "off"}
                options={[
                  { value: "on", label: tc("on") },
                  { value: "off", label: tc("off") },
                ]}
                onChange={(v) => setValue("useWesternNumeralsInArabic", v === "on", { shouldDirty: true })}
                shadow={false}
              />
            </div>
          </div>

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

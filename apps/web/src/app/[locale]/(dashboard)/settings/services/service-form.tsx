"use client";

import { useMemo, useState } from "react";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocale, useTranslations } from "next-intl";
import {
  CreateServiceSchema,
  currencyExponent,
  fromMinorUnits,
  toMinorUnits,
  type CreateServiceInput,
  type Service,
} from "@keystonehr/shared";
import { useRouter } from "@/i18n/navigation";
import { ApiError } from "@/lib/api-client";
import { usePermissions } from "@/lib/permissions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { FormSection } from "@/components/ui/form-section";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useBranches } from "@/lib/queries/branches";
import { useMe } from "@/lib/queries/users";
import {
  useCreateService,
  useServiceCategories,
  useUpdateService,
} from "@/lib/queries/services";

/** Per-branch editor row (exceptions model — see shared schema docs). */
interface OverrideRow {
  available: boolean;
  /** override price in MAJOR units as typed; "" = base price */
  priceMajor: string;
}

export function ServiceForm({ service }: { service?: Service }) {
  const t = useTranslations("services");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const { data: me } = useMe();
  const permissions = usePermissions();
  const categories = useServiceCategories();
  const branches = useBranches({ pageSize: 100 });
  const createService = useCreateService();
  const updateService = useUpdateService(service?.id ?? "");
  const [serverError, setServerError] = useState<string | null>(null);

  const currency = me?.currency ?? "OMR";
  const step = 1 / 10 ** currencyExponent(currency);

  const [overrides, setOverrides] = useState<Record<string, OverrideRow>>(() => {
    const initial: Record<string, OverrideRow> = {};
    for (const o of service?.branchOverrides ?? []) {
      initial[o.branchId] = {
        available: o.isAvailable,
        priceMajor:
          o.priceOverrideMinor != null
            ? String(fromMinorUnits(o.priceOverrideMinor, currency))
            : "",
      };
    }
    return initial;
  });

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<CreateServiceInput>({
    resolver: zodResolver(CreateServiceSchema) as unknown as Resolver<CreateServiceInput>,
    defaultValues: service
      ? {
          categoryId: service.categoryId,
          nameEn: service.nameEn,
          nameAr: service.nameAr,
          durationMinutes: service.durationMinutes,
          bufferMinutes: service.bufferMinutes,
          priceMinor: service.priceMinor,
          status: service.status,
          branchOverrides: [],
        }
      : { status: "active", bufferMinutes: 0, branchOverrides: [] },
  });

  const priceMinor = watch("priceMinor");
  const priceDisplay = useMemo(
    () => (priceMinor != null && !Number.isNaN(priceMinor) ? fromMinorUnits(priceMinor, currency) : ""),
    [priceMinor, currency],
  );

  function setRow(branchId: string, patch: Partial<OverrideRow>) {
    setOverrides((prev) => ({
      ...prev,
      [branchId]: { available: true, priceMajor: "", ...prev[branchId], ...patch },
    }));
  }

  async function onSubmit(values: CreateServiceInput) {
    setServerError(null);

    // exceptions only: emit a row when the branch differs from the default
    const branchOverrides: CreateServiceInput["branchOverrides"] = [];
    for (const [branchId, row] of Object.entries(overrides)) {
      const major = row.priceMajor.trim() === "" ? null : Number(row.priceMajor);
      if (major !== null && (Number.isNaN(major) || major < 0)) {
        setServerError(t("form.errors.badOverride"));
        return;
      }
      const priceOverrideMinor = major !== null ? toMinorUnits(major, currency) : null;
      if (!row.available || priceOverrideMinor !== null) {
        branchOverrides.push({ branchId, priceOverrideMinor, isAvailable: row.available });
      }
    }

    try {
      const payload = { ...values, branchOverrides };
      if (service) await updateService.mutateAsync(payload);
      else await createService.mutateAsync(payload);
      router.replace("/settings/services");
      router.refresh();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "NETWORK";
      setServerError(
        code === "VALIDATION_FAILED" ? tc("errors.VALIDATION_FAILED") : tc("errors.GENERIC"),
      );
    }
  }

  const err = (key: keyof CreateServiceInput): string | undefined =>
    errors[key]?.message ? t("form.errors.invalid") : undefined;

  const catName = (c: { nameEn: string; nameAr: string }) =>
    locale === "ar" ? c.nameAr : c.nameEn;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
      <FormSection title={t("form.details")}>
        <Field label={t("form.category")} htmlFor="categoryId" required error={err("categoryId")}>
          <Select id="categoryId" {...register("categoryId")}>
            <option value="">—</option>
            {(categories.data ?? []).map((category) => (
              <option key={category.id} value={category.id}>
                {catName(category)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("form.status")} htmlFor="status" required>
          <Select id="status" {...register("status")}>
            <option value="active">{tc("active")}</option>
            <option value="inactive">{tc("inactive")}</option>
          </Select>
        </Field>
        <Field label={t("form.nameEn")} htmlFor="nameEn" required error={err("nameEn")}>
          <Input id="nameEn" dir="ltr" {...register("nameEn")} />
        </Field>
        <Field label={t("form.nameAr")} htmlFor="nameAr" required error={err("nameAr")}>
          <Input id="nameAr" dir="rtl" {...register("nameAr")} />
        </Field>
      </FormSection>

      <FormSection title={t("form.timeAndPrice")}>
        <Field
          label={t("form.duration")}
          htmlFor="durationMinutes"
          required
          error={err("durationMinutes")}
        >
          <Input
            id="durationMinutes"
            type="number"
            min={5}
            max={480}
            step={5}
            {...register("durationMinutes", { valueAsNumber: true })}
          />
        </Field>
        <Field label={t("form.buffer")} htmlFor="bufferMinutes" error={err("bufferMinutes")}>
          <Input
            id="bufferMinutes"
            type="number"
            min={0}
            max={120}
            step={5}
            {...register("bufferMinutes", { valueAsNumber: true })}
          />
        </Field>
        <Field
          label={t("form.price", { currency })}
          htmlFor="price"
          required
          error={err("priceMinor")}
        >
          <Input
            id="price"
            type="number"
            inputMode="decimal"
            dir="ltr"
            min={0}
            step={step}
            defaultValue={priceDisplay}
            onChange={(e) => {
              const major = Number(e.target.value);
              setValue(
                "priceMinor",
                e.target.value === "" || Number.isNaN(major) || major < 0
                  ? (NaN as unknown as number)
                  : toMinorUnits(major, currency),
                { shouldValidate: true },
              );
            }}
          />
        </Field>
        <p className="self-end pb-2 text-xs text-muted-foreground">{t("form.priceHint")}</p>
      </FormSection>

      <FormSection title={t("form.branchAvailability")} wide>
        <p className="text-xs text-muted-foreground sm:col-span-2">
          {t("form.branchAvailabilityHint")}
        </p>
        {(branches.data?.data ?? []).map((branch) => {
          const row = overrides[branch.id] ?? { available: true, priceMajor: "" };
          return (
            <div
              key={branch.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-3 py-2.5 sm:col-span-2"
            >
              <Switch
                checked={row.available}
                onCheckedChange={(v) => setRow(branch.id, { available: v })}
                aria-label={t("form.availableAt", {
                  branch: locale === "ar" ? branch.nameAr : branch.nameEn,
                })}
              />
              <span className="min-w-0 flex-1 truncate text-sm">
                {locale === "ar" ? branch.nameAr : branch.nameEn}
                <span className="ms-2 text-xs text-muted-foreground">{branch.code}</span>
              </span>
              <Input
                type="number"
                inputMode="decimal"
                dir="ltr"
                min={0}
                step={step}
                disabled={!row.available}
                value={row.priceMajor}
                onChange={(e) => setRow(branch.id, { priceMajor: e.target.value })}
                placeholder={t("form.basePrice")}
                className="w-36"
                aria-label={t("form.overridePrice")}
              />
            </div>
          );
        })}
      </FormSection>

      {serverError && <Alert>{serverError}</Alert>}

      <div className="flex items-center gap-3">
        {permissions.includes("services.manage") && (
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? tc("saving") : tc("save")}
          </Button>
        )}
        <Button variant="outline" onClick={() => router.back()}>
          {tc("cancel")}
        </Button>
      </div>
    </form>
  );
}

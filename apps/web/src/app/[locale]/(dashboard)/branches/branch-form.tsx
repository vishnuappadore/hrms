"use client";

import { type KeyboardEvent, type ReactNode, useState } from "react";
import { Controller, useForm, type FieldPath, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { CreateBranchSchema, type CreateBranchInput } from "@keystonehr/shared";
import { useRouter } from "@/i18n/navigation";
import { ApiError } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { usePermissions } from "@/lib/permissions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Field } from "@/components/ui/field";
import { FormSection } from "@/components/ui/form-section";
import { Input } from "@/components/ui/input";
import { MobileInput } from "@/components/ui/mobile-input";
import { Select } from "@/components/ui/select";
import { Stepper } from "@/components/ui/stepper";
import { useCreateBranch, useUpdateBranch, type BranchDetail } from "@/lib/queries/branches";
import { useEmployees, useMe } from "@/lib/queries/employees";

const WEEK_DAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

const CURRENCIES = ["AED", "SAR", "QAR", "KWD", "BHD", "OMR", "USD", "EUR"] as const;

/** "" from empty inputs → undefined/null so optional zod fields validate. */
const emptyToUndefined = { setValueAs: (v: unknown) => (v === "" ? undefined : v) };
const emptyToNull = { setValueAs: (v: unknown) => (v === "" ? null : v) };

export function BranchForm({ branch }: { branch?: BranchDetail }) {
  const t = useTranslations("branches");
  const tc = useTranslations("common");
  const router = useRouter();
  const createBranch = useCreateBranch();
  const updateBranch = useUpdateBranch(branch?.id ?? "");
  const permissions = usePermissions();
  const canSave = permissions.includes(branch ? "branches.update" : "branches.create");
  const [serverError, setServerError] = useState<string | null>(null);

  const [step, setStep] = useState(0);
  const { data: me } = useMe();

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    trigger,
    formState: { errors, isSubmitting },
  } = useForm<CreateBranchInput>({
    // zod input type (pre-default/pre-coercion) differs from CreateBranchInput
    resolver: zodResolver(CreateBranchSchema) as unknown as Resolver<CreateBranchInput>,
    shouldUnregister: true,
    defaultValues: branch
      ? {
          nameEn: branch.nameEn,
          nameAr: branch.nameAr,
          status: branch.status,
          managerUserId: branch.managerUserId,
          mobile: branch.mobile,
          landphone: branch.landphone,
          email: branch.email,
          whatsapp: branch.whatsapp,
          country: branch.country,
          state: branch.state,
          city: branch.city,
          address: branch.address,
          googleMapsUrl: branch.googleMapsUrl,
          workingHours: {
            openingTime: branch.workingHours.openingTime,
            closingTime: branch.workingHours.closingTime,
            weeklyOffDays: branch.workingHours
              .weeklyOffDays as CreateBranchInput["workingHours"]["weeklyOffDays"],
          },
          currency: branch.currency,
        }
      : {
          status: "active",
        },
  });

  const users = useEmployees({ pageSize: 100 });

  type F = FieldPath<CreateBranchInput>;
  const steps: { key: string; title: string; fields: F[] }[] = [
    {
      key: "details",
      title: t("form.stepDetails"),
      fields: [
        "nameEn",
        "nameAr",
        "status",
        "mobile",
        "landphone",
        "email",
        "whatsapp",
        "country",
        "state",
        "city",
        "googleMapsUrl",
        "address",
      ],
    },
    {
      key: "managerHours",
      title: t("form.stepManagerHours"),
      fields: [
        "managerUserId",
        "workingHours.openingTime",
        "workingHours.closingTime",
        "workingHours.weeklyOffDays",
        "currency",
      ],
    },
    { key: "review", title: t("form.stepReview"), fields: [] },
  ];

  const current = step;
  const currentStep = steps[current]!;
  const isLast = current === steps.length - 1;
  const show = (key: string) => (currentStep.key === key ? undefined : "hidden");

  async function goNext() {
    const ok = await trigger(currentStep.fields);
    if (ok) setStep(current + 1);
  }
  function goBack() {
    setStep(Math.max(0, current - 1));
  }
  function onKeyDown(e: KeyboardEvent<HTMLFormElement>) {
    // Enter advances the step instead of submitting early (submit is last-step only).
    if (e.key === "Enter" && !isLast && (e.target as HTMLElement).tagName !== "TEXTAREA") {
      e.preventDefault();
      void goNext();
    }
  }

  async function onSubmit(values: CreateBranchInput) {
    setServerError(null);
    try {
      if (branch) await updateBranch.mutateAsync(values);
      else await createBranch.mutateAsync(values);
      router.replace("/branches");
      router.refresh();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "NETWORK";
      setServerError(
        code === "VALIDATION_FAILED" ? tc("errors.VALIDATION_FAILED") : tc("errors.GENERIC"),
      );
    }
  }

  const err = (path: string): string | undefined => {
    // react-hook-form nests errors along the path
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const node = path.split(".").reduce<any>((acc, key) => acc?.[key], errors);
    if (!node?.message) return undefined;
    if (path === "mobile") return t("form.errors.mobileInvalid");
    return t(`form.errors.invalid`);
  };

  const managerName = users.data?.data.find((u) => u.id === watch("managerUserId"))?.name;

  return (
    <form onSubmit={handleSubmit(onSubmit)} onKeyDown={onKeyDown} className="space-y-5" noValidate>
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">
          {t("form.stepProgress", {
            current: current + 1,
            total: steps.length,
            title: currentStep.title,
          })}
        </p>
        <Stepper steps={steps} current={current} />
      </div>

      <div className={cn("space-y-4", show("details"))}>
        <FormSection title={t("form.basicInfo")}>
          <Field label={t("form.nameEn")} htmlFor="nameEn" required error={err("nameEn")}>
            <Input id="nameEn" dir="ltr" {...register("nameEn")} />
          </Field>
          <Field label={t("form.nameAr")} htmlFor="nameAr" required error={err("nameAr")}>
            <Input id="nameAr" dir="rtl" {...register("nameAr")} />
          </Field>
          <Field label={t("form.status")} htmlFor="status" required>
            <Select id="status" {...register("status")}>
              <option value="active">{tc("active")}</option>
              <option value="inactive">{tc("inactive")}</option>
            </Select>
          </Field>
        </FormSection>

        <FormSection title={t("form.contactInfo")}>
          <Field label={t("form.mobile")} htmlFor="mobile" required error={err("mobile")}>
            <MobileInput
              id="mobile"
              value={watch("mobile") ?? ""}
              onChange={(v) => setValue("mobile", v, { shouldValidate: false })}
              defaultCurrency={me?.currency}
            />
          </Field>
          <Field label={t("form.landphone")} htmlFor="landphone" error={err("landphone")}>
            <Input id="landphone" dir="ltr" {...register("landphone", emptyToNull)} />
          </Field>
          <Field label={t("form.email")} htmlFor="email" required error={err("email")}>
            <Input id="email" type="email" dir="ltr" {...register("email")} />
          </Field>
          <Field label={t("form.whatsapp")} htmlFor="whatsapp" error={err("whatsapp")}>
            <Input id="whatsapp" dir="ltr" {...register("whatsapp", emptyToNull)} />
          </Field>
        </FormSection>

        <FormSection title={t("form.locationInfo")}>
          <Field label={t("form.country")} htmlFor="country" required error={err("country")}>
            <Input id="country" {...register("country")} />
          </Field>
          <Field label={t("form.state")} htmlFor="state" required error={err("state")}>
            <Input id="state" {...register("state")} />
          </Field>
          <Field label={t("form.city")} htmlFor="city" required error={err("city")}>
            <Input id="city" {...register("city")} />
          </Field>
          <Field
            label={t("form.googleMapsUrl")}
            htmlFor="googleMapsUrl"
            error={err("googleMapsUrl")}
          >
            <Input id="googleMapsUrl" dir="ltr" {...register("googleMapsUrl", emptyToNull)} />
          </Field>
          <div className="sm:col-span-2">
            <Field label={t("form.address")} htmlFor="address" required error={err("address")}>
              <Input id="address" {...register("address")} />
            </Field>
          </div>
        </FormSection>
      </div>

      <div className={cn("space-y-4", show("managerHours"))}>
        <FormSection>
          <Field label={t("form.manager")} htmlFor="managerUserId">
            <Select id="managerUserId" {...register("managerUserId", emptyToNull)}>
              <option value="">{t("form.noManager")}</option>
              {(users.data?.data ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </Field>
        </FormSection>

        <FormSection title={t("form.businessInfo")}>
          <Field
            label={t("form.openingTime")}
            htmlFor="openingTime"
            required
            error={err("workingHours.openingTime")}
          >
            <Input id="openingTime" type="time" {...register("workingHours.openingTime")} />
          </Field>
          <Field
            label={t("form.closingTime")}
            htmlFor="closingTime"
            required
            error={err("workingHours.closingTime")}
          >
            <Input id="closingTime" type="time" {...register("workingHours.closingTime")} />
          </Field>
          <Field label={t("form.weeklyOffDays")} htmlFor="weeklyOffDays">
            <Controller
              control={control}
              name="workingHours.weeklyOffDays"
              render={({ field }) => {
                const selected = new Set(field.value ?? []);
                function toggleDay(day: (typeof WEEK_DAYS)[number]) {
                  const next = new Set(selected);
                  if (next.has(day)) {
                    next.delete(day);
                  } else {
                    next.add(day);
                  }
                  field.onChange([...next]);
                }
                return (
                  <div id="weeklyOffDays" className="flex flex-wrap gap-2">
                    {WEEK_DAYS.map((day) => (
                      <Chip key={day} pressed={selected.has(day)} onClick={() => toggleDay(day)}>
                        {t(`days.${day}`)}
                      </Chip>
                    ))}
                  </div>
                );
              }}
            />
          </Field>
        </FormSection>

        <FormSection title={t("form.financialConfig")}>
          <Field label={t("form.currency")} htmlFor="currency" error={err("currency")}>
            <Select id="currency" {...register("currency", emptyToUndefined)}>
              <option value="">{t("form.companyDefaultCurrency")}</option>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
        </FormSection>
      </div>

      <div className={cn("space-y-4", show("review"))}>
        <p className="text-sm text-muted-foreground">{t("form.reviewIntro")}</p>
        <section className="rounded-xl border border-border bg-card p-5">
          <dl className="divide-y divide-border/60">
            <ReviewRow label={t("form.nameEn")} value={watch("nameEn")} />
            <ReviewRow label={t("form.country")} value={watch("country")} />
            <ReviewRow label={t("form.city")} value={watch("city")} />
            <ReviewRow label={t("form.mobile")} value={watch("mobile")} />
            <ReviewRow label={t("form.manager")} value={managerName} />
            <ReviewRow
              label={t("form.businessInfo")}
              value={
                watch("workingHours.openingTime") && watch("workingHours.closingTime")
                  ? `${watch("workingHours.openingTime")} – ${watch("workingHours.closingTime")}`
                  : undefined
              }
            />
            {branch && <ReviewRow label={t("list.employees")} value={branch.employeeCount} />}
            <ReviewRow
              label={t("form.currency")}
              value={watch("currency") || t("form.companyDefaultCurrency")}
            />
          </dl>
        </section>
      </div>

      {serverError && <Alert>{serverError}</Alert>}

      <div className="flex items-center justify-between gap-3">
        <Button variant="outline" type="button" onClick={() => router.back()}>
          {tc("cancel")}
        </Button>
        <div className="flex gap-3">
          {current > 0 && (
            <Button variant="outline" type="button" onClick={goBack}>
              {tc("back")}
            </Button>
          )}
          {isLast ? (
            canSave && (
              <Button type="button" disabled={isSubmitting} onClick={handleSubmit(onSubmit)}>
                {isSubmitting ? tc("saving") : tc("save")}
              </Button>
            )
          ) : (
            <Button type="button" onClick={goNext}>
              {tc("next")}
            </Button>
          )}
        </div>
      </div>
    </form>
  );
}

function ReviewRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2 text-sm first:pt-0 last:pb-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value || value === 0 ? value : "—"}</dd>
    </div>
  );
}

"use client";

import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  Controller,
  useForm,
  type FieldPath,
  type Resolver,
  type UseFormRegisterReturn,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocale, useTranslations } from "next-intl";
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
import { StepperInput } from "@/components/ui/stepper-input";
import { useCreateBranch, useUpdateBranch, type BranchDetail } from "@/lib/queries/branches";
import { useFranchiseOwners } from "@/lib/queries/franchise-owners";
import { useServices } from "@/lib/queries/services";
import { useMe, useUsers } from "@/lib/queries/users";

const WEEK_DAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

const CURRENCIES = ["OMR", "AED", "SAR", "QAR", "KWD", "BHD", "USD", "EUR"] as const;

/** "" from empty inputs → undefined/null so optional zod fields validate. */
const emptyToUndefined = { setValueAs: (v: unknown) => (v === "" ? undefined : v) };
const emptyToNull = { setValueAs: (v: unknown) => (v === "" ? null : v) };

function toDateInputValue(value: string | Date | undefined): string {
  if (!value) return "";
  return new Date(value).toISOString().slice(0, 10);
}

export function BranchForm({ branch }: { branch?: BranchDetail }) {
  const t = useTranslations("branches");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const createBranch = useCreateBranch();
  const updateBranch = useUpdateBranch(branch?.id ?? "");
  const permissions = usePermissions();
  const canSave = permissions.includes(branch ? "branches.update" : "branches.create");
  const [serverError, setServerError] = useState<string | null>(null);
  const [ownerMode, setOwnerMode] = useState<"existing" | "new">(
    branch?.franchiseDetails ? "existing" : "new",
  );

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
          type: branch.type,
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
          chairCount: branch.chairCount,
          allowOnlineBooking: branch.allowOnlineBooking,
          allowWalkIns: branch.allowWalkIns,
          enableLoyalty: branch.enableLoyalty,
          enableProductSales: branch.enableProductSales,
          franchiseDetails: branch.franchiseDetails
            ? {
                franchiseOwnerId: branch.franchiseDetails.franchiseOwnerId,
                agreementStartDate: toDateInputValue(
                  branch.franchiseDetails.agreementStartDate,
                ) as unknown as Date,
                agreementExpiryDate: toDateInputValue(
                  branch.franchiseDetails.agreementExpiryDate,
                ) as unknown as Date,
              }
            : null,
        }
      : {
          type: "corporate",
          status: "active",
          chairCount: 1,
          allowOnlineBooking: true,
          allowWalkIns: true,
          enableLoyalty: true,
          enableProductSales: true,
        },
  });

  const type = watch("type");
  const users = useUsers({ pageSize: 100 });
  const owners = useFranchiseOwners(type === "franchise");
  const services = useServices({ status: "active", pageSize: 100 });

  const [selectedServiceIds, setSelectedServiceIds] = useState<Set<string>>(new Set());
  const [servicesSeeded, setServicesSeeded] = useState(false);

  useEffect(() => {
    if (!services.data || servicesSeeded) return;
    const offIds = new Set(
      (branch?.branchServices ?? []).filter((r) => !r.isAvailable).map((r) => r.serviceId),
    );
    setSelectedServiceIds(
      new Set(services.data.data.filter((s) => !offIds.has(s.id)).map((s) => s.id)),
    );
    setServicesSeeded(true);
  }, [services.data, servicesSeeded, branch]);

  function toggleService(id: string) {
    setSelectedServiceIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /* Wizard: 4 steps, each grouping several of the original topic sections.
     Franchise fields are only validated for franchise branches (matches the
     conditional section + `shouldUnregister` behaviour). */
  type F = FieldPath<CreateBranchInput>;
  const franchiseFields: F[] =
    ownerMode === "existing"
      ? [
          "franchiseDetails.franchiseOwnerId",
          "franchiseDetails.agreementStartDate",
          "franchiseDetails.agreementExpiryDate",
        ]
      : [
          "franchiseDetails.newOwner.ownerName",
          "franchiseDetails.newOwner.companyName",
          "franchiseDetails.newOwner.commercialRegistrationNo",
          "franchiseDetails.agreementStartDate",
          "franchiseDetails.agreementExpiryDate",
        ];

  const steps: { key: string; title: string; fields: F[] }[] = [
    {
      key: "details",
      title: t("form.stepDetails"),
      fields: [
        "nameEn",
        "nameAr",
        "type",
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
        ...(type === "franchise" ? franchiseFields : []),
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
    {
      key: "capacityServices",
      title: t("form.stepCapacityServices"),
      fields: ["chairCount", "allowOnlineBooking", "allowWalkIns", "enableLoyalty", "enableProductSales"],
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
    const payload = { ...values, serviceIds: [...selectedServiceIds] };
    try {
      if (branch) await updateBranch.mutateAsync(payload);
      else await createBranch.mutateAsync(payload);
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
          <Field label={t("form.type")} htmlFor="type" required>
            <Select id="type" {...register("type")}>
              <option value="corporate">{t("type.corporate")}</option>
              <option value="franchise">{t("type.franchise")}</option>
            </Select>
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

        {type === "franchise" && (
          <FormSection title={t("form.franchiseInfo")}>
            <div className="sm:col-span-2 flex gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="ownerMode"
                  checked={ownerMode === "existing"}
                  onChange={() => setOwnerMode("existing")}
                  className="accent-primary"
                />
                {t("form.existingOwner")}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="ownerMode"
                  checked={ownerMode === "new"}
                  onChange={() => setOwnerMode("new")}
                  className="accent-primary"
                />
                {t("form.newOwner")}
              </label>
            </div>

            {ownerMode === "existing" ? (
              <Field
                label={t("form.franchiseOwner")}
                htmlFor="franchiseOwnerId"
                required
                error={err("franchiseDetails.franchiseOwnerId")}
              >
                <Select
                  id="franchiseOwnerId"
                  {...register("franchiseDetails.franchiseOwnerId", emptyToUndefined)}
                >
                  <option value="">—</option>
                  {(owners.data?.data ?? []).map((owner) => (
                    <option key={owner.id} value={owner.id}>
                      {owner.ownerName} — {owner.companyName}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : (
              <>
                <Field
                  label={t("form.ownerName")}
                  htmlFor="ownerName"
                  required
                  error={err("franchiseDetails.newOwner.ownerName")}
                >
                  <Input id="ownerName" {...register("franchiseDetails.newOwner.ownerName")} />
                </Field>
                <Field
                  label={t("form.companyName")}
                  htmlFor="companyName"
                  required
                  error={err("franchiseDetails.newOwner.companyName")}
                >
                  <Input
                    id="companyName"
                    {...register("franchiseDetails.newOwner.companyName")}
                  />
                </Field>
                <Field
                  label={t("form.commercialRegistrationNo")}
                  htmlFor="crNo"
                  required
                  error={err("franchiseDetails.newOwner.commercialRegistrationNo")}
                >
                  <Input
                    id="crNo"
                    dir="ltr"
                    {...register("franchiseDetails.newOwner.commercialRegistrationNo")}
                  />
                </Field>
                <Field
                  label={t("form.taxNumber")}
                  htmlFor="taxNumber"
                  error={err("franchiseDetails.newOwner.taxNumber")}
                >
                  <Input
                    id="taxNumber"
                    dir="ltr"
                    {...register("franchiseDetails.newOwner.taxNumber", emptyToNull)}
                  />
                </Field>
              </>
            )}

            <Field
              label={t("form.agreementStartDate")}
              htmlFor="agreementStartDate"
              required
              error={err("franchiseDetails.agreementStartDate")}
            >
              <Input
                id="agreementStartDate"
                type="date"
                {...register("franchiseDetails.agreementStartDate")}
              />
            </Field>
            <Field
              label={t("form.agreementExpiryDate")}
              htmlFor="agreementExpiryDate"
              required
              error={err("franchiseDetails.agreementExpiryDate")}
            >
              <Input
                id="agreementExpiryDate"
                type="date"
                {...register("franchiseDetails.agreementExpiryDate")}
              />
            </Field>
          </FormSection>
        )}
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
              <option value="">{t("form.tenantDefaultCurrency")}</option>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
        </FormSection>
      </div>

      <div className={cn("space-y-4", show("capacityServices"))}>
        <FormSection>
          <Field label={t("form.chairCount")} htmlFor="chairCount">
            <Controller
              control={control}
              name="chairCount"
              render={({ field }) => (
                <StepperInput
                  id="chairCount"
                  value={field.value ?? 1}
                  onChange={field.onChange}
                  min={1}
                  max={100}
                />
              )}
            />
          </Field>
        </FormSection>

        <FormSection title={t("form.branchSettings")}>
          <ToggleField
            label={t("form.allowOnlineBooking")}
            registration={register("allowOnlineBooking")}
            watchValue={watch("allowOnlineBooking") ?? true}
          />
          <ToggleField
            label={t("form.allowWalkIns")}
            registration={register("allowWalkIns")}
            watchValue={watch("allowWalkIns") ?? true}
          />
          <ToggleField
            label={t("form.enableLoyalty")}
            registration={register("enableLoyalty")}
            watchValue={watch("enableLoyalty") ?? true}
          />
          <ToggleField
            label={t("form.enableProductSales")}
            registration={register("enableProductSales")}
            watchValue={watch("enableProductSales") ?? true}
          />
        </FormSection>

        <section className="rounded-xl border border-border bg-card p-5">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("form.servicesOffered")}
          </h3>
          {services.data?.data.length ? (
            <div className="flex flex-wrap gap-2">
              {services.data.data.map((s) => (
                <Chip
                  key={s.id}
                  pressed={selectedServiceIds.has(s.id)}
                  onClick={() => toggleService(s.id)}
                >
                  {locale === "ar" ? s.nameAr : s.nameEn}
                </Chip>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t("form.noActiveServices")}</p>
          )}
        </section>
      </div>

      <div className={cn("space-y-4", show("review"))}>
        <p className="text-sm text-muted-foreground">{t("form.reviewIntro")}</p>
        <section className="rounded-xl border border-border bg-card p-5">
          <dl className="divide-y divide-border/60">
            <ReviewRow label={t("form.nameEn")} value={watch("nameEn")} />
            <ReviewRow label={t("form.country")} value={watch("country")} />
            <ReviewRow label={t("form.city")} value={watch("city")} />
            <ReviewRow
              label={t("form.type")}
              value={watch("type") ? t(`type.${watch("type")}`) : undefined}
            />
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
            <ReviewRow label={t("form.chairCount")} value={watch("chairCount")} />
            {branch && <ReviewRow label={t("list.staff")} value={branch.staffCount} />}
            <ReviewRow
              label={t("form.currency")}
              value={watch("currency") || t("form.tenantDefaultCurrency")}
            />
            <ReviewRow label={t("form.servicesOffered")} value={selectedServiceIds.size} />
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

/** Checkbox registered with RHF but rendered as a switch-style row. */
function ToggleField({
  label,
  registration,
  watchValue,
}: {
  label: string;
  registration: UseFormRegisterReturn;
  watchValue: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
      <span className="text-sm">{label}</span>
      <input type="checkbox" className="peer sr-only" {...registration} />
      <span
        aria-hidden="true"
        className={`inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
          watchValue ? "bg-primary" : "bg-input"
        }`}
      >
        <span
          className={`h-4 w-4 rounded-full bg-card shadow-sm transition-[margin] ${
            watchValue ? "ms-[18px]" : "ms-0.5"
          }`}
        />
      </span>
    </label>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { Check } from "lucide-react";
import {
  MobileSchema,
  formatMoney,
  type Appointment,
  type Branch,
  type CreateAppointmentInput,
  type Customer,
  type Paginated,
  type Service,
} from "@keystonehr/shared";
import { ApiError, api } from "@/lib/api-client";
import { toQueryString } from "@/lib/queries/query-string";
import { Alert } from "@/components/ui/alert";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { MobileInput } from "@/components/ui/mobile-input";
import { Stepper } from "@/components/ui/stepper";
import { cn } from "@/lib/cn";
import { useServices } from "@/lib/queries/services";
import { useMe } from "@/lib/queries/users";
import {
  useAppointmentBarbers,
  useAppointmentSlots,
  useCreateAppointment,
  useUpdateAppointment,
} from "@/lib/queries/appointments";
import { useCustomer } from "@/lib/queries/customers";

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

interface WizardProps {
  branch: Branch;
  mode: "create" | "edit";
  /** Required when `mode === "edit"` — prefills services/barber/schedule. */
  appointment?: Appointment;
  /** "Book Appointment" from Customer Details — prefills the Confirm step's customer identity,
   *  same one-shot prefill pattern as POS's own `?customerId=` handoff. */
  initialCustomerId?: string;
  onDone: () => void;
}

/**
 * The booking wizard's 4 steps (Services → Barber → Schedule → Confirm),
 * reused for both Add and Edit. Edit is scoped to barber/services/schedule
 * only (customer identity isn't re-linkable); the component is remounted
 * fresh per drawer session (keyed by the caller), so this file doesn't need
 * its own `open`-driven reset effect — initial state is just read once.
 */
export function AppointmentWizard({ branch, mode, appointment, initialCustomerId, onDone }: WizardProps) {
  const t = useTranslations("appointments.wizard");
  const tc = useTranslations("common");
  const locale = useLocale();

  const [step, setStep] = useState(0);
  const [serviceIds, setServiceIds] = useState<string[]>(
    () => appointment?.services.map((s) => s.serviceId) ?? [],
  );
  const [barberId, setBarberId] = useState<string | undefined>(() => appointment?.barberId);
  const [date, setDate] = useState<string | undefined>(() =>
    appointment ? ymd(new Date(appointment.scheduledStart)) : undefined,
  );
  const [slotIso, setSlotIso] = useState<string | undefined>(() =>
    appointment ? new Date(appointment.scheduledStart).toISOString() : undefined,
  );
  const { data: me } = useMe();
  const [mobile, setMobile] = useState("");
  const [name, setName] = useState("");
  const [matchedCustomerId, setMatchedCustomerId] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const servicesQuery = useServices({ branchId: branch.id, status: "active", pageSize: 100 });
  const services = servicesQuery.data?.data ?? [];
  const barbersQuery = useAppointmentBarbers(branch.id);
  const barbers = barbersQuery.data ?? [];

  const priceFor = (s: Service) =>
    s.branchOverrides.find((o) => o.branchId === branch.id)?.priceOverrideMinor ?? s.priceMinor;

  const selectedServices = services.filter((s) => serviceIds.includes(s.id));
  const totalMinor = selectedServices.reduce((sum, s) => sum + priceFor(s), 0);
  const totalDuration = selectedServices.reduce(
    (sum, s) => sum + s.durationMinutes + s.bufferMinutes,
    0,
  );

  const slotsQuery = useAppointmentSlots({
    branchId: branch.id,
    barberId,
    date,
    durationMinutes: totalDuration || undefined,
    excludeAppointmentId: mode === "edit" ? appointment?.id : undefined,
  });
  const slots = slotsQuery.data ?? [];

  // customer lookup by mobile (debounced), auto-fills name / links existing —
  // create mode only, customer identity isn't editable on an existing appointment
  const [mobileQuery, setMobileQuery] = useState("");
  useEffect(() => {
    if (mode !== "create") return;
    const handle = setTimeout(() => {
      const m = mobile.trim();
      setMobileQuery(m.length >= 4 ? m : "");
    }, 350);
    return () => clearTimeout(handle);
  }, [mode, mobile]);

  const lookup = useQuery({
    queryKey: ["customer-lookup", mobileQuery],
    queryFn: () =>
      api<Paginated<Customer>>(`/customers${toQueryString({ search: mobileQuery, pageSize: 5 })}`),
    enabled: mode === "create" && !!mobileQuery,
  });
  const exactMatch = lookup.data?.data.find((c) => c.mobile === mobile.trim());
  useEffect(() => {
    if (exactMatch) {
      setMatchedCustomerId(exactMatch.id);
      setName(exactMatch.name);
    } else {
      // match cleared (mobile edited to a non-match / cleared): drop the link and
      // the auto-filled name so a new-customer booking doesn't carry a stale name
      setMatchedCustomerId((prev) => {
        if (prev) setName("");
        return null;
      });
    }
  }, [exactMatch?.id]);

  // "Book Appointment" from Customer Details, once — same one-shot prefill pattern as POS's
  // own `?customerId=` handoff (pos-content.tsx).
  const prefillCustomerQuery = useCustomer(mode === "create" ? (initialCustomerId ?? "") : "");
  const prefilledCustomer = useRef(false);
  useEffect(() => {
    const c = prefillCustomerQuery.data;
    if (!c || prefilledCustomer.current) return;
    prefilledCustomer.current = true;
    setMatchedCustomerId(c.id);
    setMobile(c.mobile);
    setName(c.name);
  }, [prefillCustomerQuery.data]);

  const dateCards = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekdayFmt = new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en", { weekday: "short" });
    const dayFmt = new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en", {
      day: "2-digit",
      month: "short",
    });
    return Array.from({ length: 14 }, (_, i) => {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      const label = i === 0 ? t("schedule.today") : i === 1 ? t("schedule.tomorrow") : weekdayFmt.format(d);
      return { value: ymd(d), label, sub: dayFmt.format(d) };
    });
  }, [locale, t]);

  const create = useCreateAppointment();
  const update = useUpdateAppointment();
  const saving = mode === "edit" ? update.isPending : create.isPending;

  const steps = [
    { key: "services", title: t("steps.services") },
    { key: "barber", title: t("steps.barber") },
    { key: "schedule", title: t("steps.schedule") },
    { key: "confirm", title: t("steps.confirm") },
  ];

  const canNext =
    step === 0 ? serviceIds.length > 0 : step === 1 ? !!barberId : step === 2 ? !!slotIso : true;

  function toggleService(id: string) {
    setServiceIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    setSlotIso(undefined);
  }

  const mobileError =
    !matchedCustomerId && mobile.trim() && !MobileSchema.safeParse(mobile.trim()).success
      ? t("errors.mobileInvalid")
      : undefined;

  async function submit() {
    if (!barberId || !slotIso || mobileError) return;
    setServerError(null);
    try {
      if (mode === "edit" && appointment) {
        await update.mutateAsync({
          id: appointment.id,
          input: { barberId, serviceIds, scheduledStart: new Date(slotIso) },
        });
      } else {
        const input: CreateAppointmentInput = {
          branchId: branch.id,
          barberId,
          serviceIds,
          scheduledStart: new Date(slotIso),
          customerId: matchedCustomerId ?? undefined,
          customerMobile: !matchedCustomerId && mobile.trim() ? mobile.trim() : undefined,
          customerName: !matchedCustomerId && name.trim() ? name.trim() : undefined,
        };
        await create.mutateAsync(input);
      }
      onDone();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "NETWORK";
      setServerError(
        code === "VALIDATION_FAILED"
          ? t("errors.validation")
          : code === "APPOINTMENT_NOT_EDITABLE"
            ? t("errors.notEditable")
            : t("errors.generic"),
      );
    }
  }

  return (
    <div>
      <div className="mb-5">
        <Stepper steps={steps} current={step} />
      </div>

      <div className="max-h-[60vh] overflow-y-auto pe-1">
        {step === 0 && (
          <section className="space-y-2">
            <h3 className="text-sm font-medium text-muted-foreground">{t("services.heading")}</h3>
            {services.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">{t("services.empty")}</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {services.map((s) => {
                  const active = serviceIds.includes(s.id);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => toggleService(s.id)}
                      className={cn(
                        "flex items-center justify-between gap-3 rounded-lg border p-3 text-start transition",
                        active
                          ? "border-primary bg-primary-muted"
                          : "border-border bg-card hover:bg-muted/50",
                      )}
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">
                          {locale === "ar" ? s.nameAr : s.nameEn}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {t("services.minutes", { minutes: s.durationMinutes })}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="whitespace-nowrap text-sm font-medium">
                          {formatMoney(priceFor(s), branch.currency, locale)}
                        </span>
                        {active ? <Check className="h-4 w-4 text-primary" strokeWidth={2} /> : null}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
            {selectedServices.length > 0 ? (
              <div className="flex items-center justify-between border-t border-border pt-3 text-sm font-medium">
                <span>{t("services.total")}</span>
                <span>{formatMoney(totalMinor, branch.currency, locale)}</span>
              </div>
            ) : null}
          </section>
        )}

        {step === 1 && (
          <section className="space-y-2">
            <h3 className="text-sm font-medium text-muted-foreground">{t("barber.heading")}</h3>
            {barbers.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">{t("barber.empty")}</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {barbers.map((b) => {
                  const active = barberId === b.id;
                  return (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => {
                        setBarberId(b.id);
                        setSlotIso(undefined);
                      }}
                      className={cn(
                        "flex items-center gap-3 rounded-lg border p-3 text-start transition",
                        active
                          ? "border-primary bg-primary-muted"
                          : "border-border bg-card hover:bg-muted/50",
                      )}
                    >
                      <Avatar name={b.name} className="h-9 w-9 shrink-0 rounded-full bg-primary/12" />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{b.name}</div>
                        <div
                          className={cn(
                            "text-xs",
                            b.busy ? "text-destructive" : "text-positive",
                          )}
                        >
                          {b.busy ? t("barber.busy") : t("barber.available")}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {step === 2 && (
          <section className="space-y-4">
            <h3 className="text-sm font-medium text-muted-foreground">{t("schedule.heading")}</h3>
            <div className="flex flex-wrap gap-2">
              {dateCards.map((d) => (
                <button
                  key={d.value}
                  type="button"
                  onClick={() => {
                    setDate(d.value);
                    setSlotIso(undefined);
                  }}
                  className={cn(
                    "flex min-w-20 flex-col items-center rounded-lg border px-3 py-2 text-center transition",
                    date === d.value
                      ? "border-primary bg-primary-muted"
                      : "border-border bg-card hover:bg-muted/50",
                  )}
                >
                  <span className="text-xs font-medium">{d.label}</span>
                  <span className="text-[11px] text-muted-foreground">{d.sub}</span>
                </button>
              ))}
            </div>

            {date ? (
              slotsQuery.isLoading ? (
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                  {Array.from({ length: 12 }).map((_, i) => (
                    <div key={i} className="h-9 animate-pulse rounded-lg bg-muted" />
                  ))}
                </div>
              ) : slots.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">{t("schedule.noSlots")}</p>
              ) : (
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                  {slots.map((slot) => {
                    const iso = new Date(slot.startsAt).toISOString();
                    const active = slotIso === iso;
                    return (
                      <button
                        key={slot.time}
                        type="button"
                        onClick={() => setSlotIso(iso)}
                        dir="ltr"
                        className={cn(
                          "h-9 rounded-lg border text-xs font-medium transition",
                          active
                            ? "border-primary bg-primary text-primary-foreground"
                            : slot.taken
                              ? "border-border bg-muted/40 text-muted-foreground"
                              : "border-input bg-card hover:bg-muted/50",
                        )}
                        title={slot.taken ? t("schedule.taken") : undefined}
                      >
                        {slot.time}
                      </button>
                    );
                  })}
                </div>
              )
            ) : null}
          </section>
        )}

        {step === 3 && (
          <section className="space-y-4">
            <h3 className="text-sm font-medium text-muted-foreground">{t("confirm.heading")}</h3>
            {mode === "edit" ? (
              <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
                <div className="text-xs text-muted-foreground">{t("confirm.customer")}</div>
                <div className="mt-0.5 font-medium">
                  {appointment?.customer ? (
                    <>
                      {appointment.customer.name}{" "}
                      <span dir="ltr" className="text-muted-foreground">
                        {appointment.customer.mobile}
                      </span>
                    </>
                  ) : (
                    t("confirm.walkIn")
                  )}
                </div>
              </div>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={t("confirm.mobile")} error={mobileError}>
                    <MobileInput value={mobile} onChange={setMobile} defaultCurrency={me?.currency} />
                  </Field>
                  <Field label={t("confirm.name")}>
                    <Input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder={t("confirm.namePlaceholder")}
                      disabled={!!matchedCustomerId}
                    />
                  </Field>
                </div>
                {matchedCustomerId ? (
                  <p className="text-xs font-medium text-positive">{t("confirm.existing")}</p>
                ) : null}
              </>
            )}

            <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
              <div className="mb-2 font-medium">{t("confirm.summary")}</div>
              <dl className="space-y-1.5 text-muted-foreground">
                <div className="flex justify-between gap-3">
                  <dt>{t("steps.services")}</dt>
                  <dd className="text-end text-foreground">
                    {selectedServices
                      .map((s) => (locale === "ar" ? s.nameAr : s.nameEn))
                      .join(locale === "ar" ? "، " : ", ")}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>{t("confirm.barber")}</dt>
                  <dd className="text-foreground">
                    {barbers.find((b) => b.id === barberId)?.name ?? "—"}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>{t("confirm.when")}</dt>
                  <dd dir="ltr" className="text-end text-foreground">
                    {slotIso
                      ? new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en", {
                          weekday: "short",
                          day: "2-digit",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        }).format(new Date(slotIso))
                      : "—"}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>{t("confirm.total")}</dt>
                  <dd className="font-semibold text-foreground">
                    {formatMoney(totalMinor, branch.currency, locale)}
                  </dd>
                </div>
              </dl>
            </div>

            {serverError ? <Alert>{serverError}</Alert> : null}
          </section>
        )}
      </div>

      <div className="mt-5 flex items-center justify-between gap-2 border-t border-border pt-4">
        <Button variant="ghost" onClick={onDone}>
          {tc("cancel")}
        </Button>
        <div className="flex items-center gap-2">
          {step > 0 ? (
            <Button variant="outline" onClick={() => setStep((s) => s - 1)}>
              {tc("back")}
            </Button>
          ) : null}
          {step < 3 ? (
            <Button onClick={() => setStep((s) => s + 1)} disabled={!canNext}>
              {tc("next")}
            </Button>
          ) : (
            <Button onClick={submit} disabled={saving || !!mobileError}>
              {mode === "edit"
                ? saving
                  ? t("confirm.saving")
                  : t("confirm.save")
                : saving
                  ? t("confirm.booking")
                  : t("confirm.book")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

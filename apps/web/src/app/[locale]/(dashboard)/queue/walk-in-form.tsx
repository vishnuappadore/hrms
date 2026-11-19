"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { Check } from "lucide-react";
import {
  MobileSchema,
  formatMoney,
  type Branch,
  type CreateWalkInInput,
  type Customer,
  type Paginated,
  type UpdateWalkInInput,
  type WalkIn,
} from "@keystonehr/shared";
import { ApiError, api } from "@/lib/api-client";
import { toQueryString } from "@/lib/queries/query-string";
import { Alert } from "@/components/ui/alert";
import { Field } from "@/components/ui/field";
import { FormDrawerFooter } from "@/components/ui/form-drawer-footer";
import { Input } from "@/components/ui/input";
import { MobileInput } from "@/components/ui/mobile-input";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/cn";
import { useServices } from "@/lib/queries/services";
import { useAppointmentBarbers } from "@/lib/queries/appointments";
import { useCreateWalkIn, useUpdateWalkIn } from "@/lib/queries/walk-ins";
import { useMe } from "@/lib/queries/users";

export function WalkInForm({
  branch,
  entry,
  onDone,
}: {
  branch: Branch;
  entry?: WalkIn;
  onDone: () => void;
}) {
  const t = useTranslations("walkIn.form");
  const tc = useTranslations("common");
  const locale = useLocale();

  const { data: me } = useMe();
  const [mobile, setMobile] = useState(entry?.mobileNumber ?? "");
  const [name, setName] = useState(entry?.customerName ?? "");
  const [matchedCustomerId, setMatchedCustomerId] = useState<string | null>(entry?.customerId ?? null);
  const [serviceIds, setServiceIds] = useState<string[]>(() => entry?.services.map((s) => s.serviceId) ?? []);
  const [barberStaffId, setBarberStaffId] = useState("");
  const [serverError, setServerError] = useState<string | null>(null);
  const [servicesTouched, setServicesTouched] = useState(false);

  const servicesQuery = useServices({ branchId: branch.id, status: "active", pageSize: 100 });
  const services = servicesQuery.data?.data ?? [];
  const barbersQuery = useAppointmentBarbers(branch.id);
  const barbers = barbersQuery.data ?? [];

  const priceFor = (serviceId: string) => {
    const s = services.find((x) => x.id === serviceId);
    if (!s) return 0;
    return s.branchOverrides.find((o) => o.branchId === branch.id)?.priceOverrideMinor ?? s.priceMinor;
  };
  const selectedServices = services.filter((s) => serviceIds.includes(s.id));
  const totalMinor = selectedServices.reduce((sum, s) => sum + priceFor(s.id), 0);

  function toggleService(id: string) {
    setServicesTouched(true);
    setServiceIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  // customer lookup by mobile (debounced), auto-fills name / links existing —
  // mirrors AppointmentWizard's confirm-step lookup exactly. In edit mode the
  // seeded mobile/name/match already reflect the entry's current state, so
  // this is skipped until the user actually changes the mobile field — a
  // lookup race (query not yet resolved) would otherwise momentarily read as
  // "no match" and wipe the pre-filled name before the real result arrives.
  const initialMobileRef = useRef(entry?.mobileNumber ?? "");
  const [mobileQuery, setMobileQuery] = useState("");
  useEffect(() => {
    const handle = setTimeout(() => {
      const m = mobile.trim();
      setMobileQuery(m.length >= 4 ? m : "");
    }, 350);
    return () => clearTimeout(handle);
  }, [mobile]);

  const lookup = useQuery({
    queryKey: ["customer-lookup", mobileQuery],
    queryFn: () =>
      api<Paginated<Customer>>(`/customers${toQueryString({ search: mobileQuery, pageSize: 5 })}`),
    enabled: !!mobileQuery,
  });
  const exactMatch = lookup.data?.data.find((c) => c.mobile === mobile.trim());
  useEffect(() => {
    if (mobile.trim() === initialMobileRef.current.trim()) return;
    if (exactMatch) {
      setMatchedCustomerId(exactMatch.id);
      setName(exactMatch.name);
    } else {
      setMatchedCustomerId((prev) => {
        if (prev) setName("");
        return null;
      });
    }
  }, [exactMatch?.id]);

  const create = useCreateWalkIn();
  const update = useUpdateWalkIn();
  const isSaving = create.isPending || update.isPending;
  const canSubmit = serviceIds.length > 0;
  const mobileError =
    mobile.trim() && !MobileSchema.safeParse(mobile.trim()).success ? t("errors.mobileInvalid") : undefined;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setServicesTouched(true);
    if (!canSubmit || mobileError) return;
    setServerError(null);
    try {
      if (entry) {
        const input: UpdateWalkInInput = {
          mobileNumber: mobile.trim() || null,
          customerName: name.trim() || null,
          serviceIds,
        };
        await update.mutateAsync({ id: entry.id, input });
      } else {
        const input: CreateWalkInInput = {
          branchId: branch.id,
          mobileNumber: mobile.trim() || undefined,
          customerName: name.trim() || undefined,
          serviceIds,
          barberStaffId: barberStaffId || undefined,
        };
        await create.mutateAsync(input);
      }
      onDone();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "NETWORK";
      setServerError(
        code === "VALIDATION_FAILED"
          ? tc("errors.VALIDATION_FAILED")
          : code === "WALKIN_NOT_EDITABLE"
            ? t("errors.notEditable")
            : tc("errors.GENERIC"),
      );
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex h-full flex-col" noValidate>
      <div className="flex-1 space-y-4">
        <Field label={t("mobile")} htmlFor="walkin-mobile" error={mobileError}>
          <MobileInput id="walkin-mobile" value={mobile} onChange={setMobile} defaultCurrency={me?.currency} />
        </Field>
        <Field label={t("name")} htmlFor="walkin-name">
          <Input
            id="walkin-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("namePlaceholder")}
            disabled={!!matchedCustomerId}
          />
        </Field>

        <div className="space-y-2">
          <h3 className="text-sm font-medium text-muted-foreground">{t("services")}</h3>
          {services.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">{t("noServices")}</p>
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
                      active ? "border-primary bg-primary-muted" : "border-border bg-card hover:bg-muted/50",
                    )}
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">
                        {locale === "ar" ? s.nameAr : s.nameEn}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {t("minutes", { minutes: s.durationMinutes })}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="whitespace-nowrap text-sm font-medium">
                        {formatMoney(priceFor(s.id), branch.currency, locale)}
                      </span>
                      {active ? <Check className="h-4 w-4 text-primary" strokeWidth={2} /> : null}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
          {servicesTouched && !canSubmit ? (
            <p className="text-xs text-destructive">{t("errors.servicesRequired")}</p>
          ) : null}
        </div>

        {selectedServices.length > 0 ? (
          <div className="flex items-center justify-between border-t border-border pt-3 text-sm font-medium">
            <span>{t("total")}</span>
            <span>{formatMoney(totalMinor, branch.currency, locale)}</span>
          </div>
        ) : null}

        {entry ? null : (
        <Field label={t("barber")} htmlFor="walkin-barber">
          <Select
            id="walkin-barber"
            value={barberStaffId}
            onChange={(e) => setBarberStaffId(e.target.value)}
          >
            <option value="">{t("unassigned")}</option>
            {barbers.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </Field>
        )}

        {serverError ? <Alert>{serverError}</Alert> : null}
      </div>

      <FormDrawerFooter
        onClose={onDone}
        closeLabel={tc("close")}
        submitLabel={isSaving ? tc("saving") : entry ? tc("save") : t("addWalkIn")}
        submitting={isSaving}
      />
    </form>
  );
}

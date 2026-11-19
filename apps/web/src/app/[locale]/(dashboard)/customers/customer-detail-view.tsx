"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  CalendarCheck,
  CalendarDays,
  CalendarX,
  Gift,
  Pencil,
  ShoppingCart,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { formatMoney, type Customer } from "@keystonehr/shared";
import { Link } from "@/i18n/navigation";
import { usePermissions } from "@/lib/permissions";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { TimelineRow } from "@/components/ui/timeline";
import { KpiCard } from "@/components/kpi-card";
import { useAppointments } from "@/lib/queries/appointments";
import { STATUS_ICON, STATUS_ICON_CLASS } from "../appointments/appointment-card";
import { TIER_BADGE_VARIANT } from "./customer-tier";

/** Full customer detail — summary, stats, appointment history — shared by the standalone profile
 *  route and the drawer's "view" mode so the layout only lives in one place. Matches Appointments'/
 *  Walk-in Queue's detail-view skeleton: identity header with only Edit up top, stats, a
 *  connected-dot history timeline, and a bottom justify-end row of icon+label pill buttons. */
export function CustomerDetailView({ customer, onEdit }: { customer: Customer; onEdit: () => void }) {
  const t = useTranslations("customers");
  const ts = useTranslations("appointments");
  const tc = useTranslations("common");
  const locale = useLocale();
  const permissions = usePermissions();

  const dateFmt = useMemo(
    () => new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en", { dateStyle: "medium" }),
    [locale],
  );
  const dateTimeFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
    [locale],
  );

  const stats: { label: string; value: string; icon: LucideIcon }[] = [
    { label: t("profile.visits"), value: String(customer.visits), icon: CalendarCheck },
    { label: t("profile.points"), value: String(customer.points), icon: Gift },
    {
      label: t("profile.totalSpend"),
      value: formatMoney(customer.totalSpendMinor, customer.currency, locale),
      icon: Wallet,
    },
    {
      label: t("profile.customerSince"),
      value: dateFmt.format(new Date(customer.createdAt)),
      icon: CalendarDays,
    },
  ];

  const canViewHistory = permissions.includes("appointments.view");
  const historyQuery = useAppointments({
    customerId: canViewHistory ? customer.id : undefined,
    pageSize: 10,
    sort: "-scheduledStart",
  });
  const history = historyQuery.data?.data ?? [];

  return (
    <div className="space-y-4">
      {/* Identity header — not a card, so it reads as the screen's title area */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <Avatar name={customer.name} src={customer.photoUrl} className="h-12 w-12 text-base" />
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-lg font-semibold">{customer.name}</h1>
              <Badge variant={TIER_BADGE_VARIANT[customer.tier]}>{t(`tiers.${customer.tier}`)}</Badge>
            </div>
            <div dir="ltr" className="text-start text-sm text-muted-foreground">
              {customer.mobile}
              {customer.email ? ` · ${customer.email}` : ""}
            </div>
          </div>
        </div>
        {permissions.includes("customers.update") && (
          <button
            type="button"
            onClick={onEdit}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium transition hover:bg-muted"
          >
            <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />
            {tc("edit")}
          </button>
        )}
      </div>

      {/* Statistics — two rows of two, so they stay comfortably sized inside the drawer's width */}
      <div className="grid grid-cols-2 gap-3">
        {stats.map((s) => (
          <KpiCard key={s.label} label={s.label} value={s.value} icon={s.icon} size="compact" />
        ))}
      </div>

      {/* Appointment history — a real visit list once there's data, same connected-dot timeline
       *  design as Appointments' own status-change history. */}
      <div className="text-sm">
        <div className="mb-3 text-xs text-muted-foreground">{t("profile.appointmentHistory")}</div>
        {history.length > 0 ? (
          <div>
            {history.map((a, i) => {
              const serviceNames = a.services.map((s) => (locale === "ar" ? s.nameAr : s.nameEn)).join(", ");
              return (
                <TimelineRow
                  key={a.id}
                  icon={STATUS_ICON[a.status]}
                  iconClassName={STATUS_ICON_CLASS[a.status]}
                  label={`${serviceNames || "—"} · ${ts(`status.${a.status}`)}`}
                  timestamp={<span dir="ltr">{dateTimeFmt.format(new Date(a.scheduledStart))}</span>}
                  isLast={i === history.length - 1}
                />
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-card py-16 text-center">
            <CalendarX className="h-8 w-8 text-muted-foreground" strokeWidth={1.5} aria-hidden="true" />
            <p className="text-sm text-muted-foreground">{t("profile.noAppointments")}</p>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
        {permissions.includes("appointments.create") ? (
          <Link
            href={`/appointments?newForCustomerId=${customer.id}`}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3.5 text-sm font-medium transition hover:bg-muted"
          >
            <CalendarCheck className="h-3.5 w-3.5" strokeWidth={1.75} />
            {t("profile.bookAppointment")}
          </Link>
        ) : null}
        {permissions.includes("pos.use") ? (
          <Link
            href={`/pos?customerId=${customer.id}`}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-tint-warning-border bg-tint-warning-bg px-3.5 text-sm font-medium text-warning transition hover:brightness-110"
          >
            <ShoppingCart className="h-3.5 w-3.5" strokeWidth={1.75} />
            {t("profile.newSale")}
          </Link>
        ) : null}
      </div>
    </div>
  );
}

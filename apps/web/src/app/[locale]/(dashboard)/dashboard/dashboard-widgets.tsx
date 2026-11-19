"use client";

import type { ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  formatMoney,
  type LowStockAlert,
  type RecentAppointment,
  type SalesByPaymentMethod,
  type TodaysSummary,
  type TopBranch,
  type TopService,
} from "@keystonehr/shared";
import { Badge, type BadgeVariant } from "@/components/ui/badge";

function WidgetCard({ title, loading, empty, children }: { title: string; loading?: boolean; empty?: boolean; children: ReactNode }) {
  const t = useTranslations("dashboard.kpis");
  return (
    <div className="flex h-64 flex-col rounded-xl border border-border bg-card p-4 shadow-sm">
      <p className="mb-2 text-sm font-medium">{title}</p>
      {loading ? (
        <div className="flex-1 animate-pulse rounded-lg bg-muted" />
      ) : empty ? (
        <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">{t("noData")}</div>
      ) : (
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">{children}</div>
      )}
    </div>
  );
}

function moneyLine(byCurrency: { currency: string; amountMinor: number }[], locale: string): string {
  return byCurrency.map((c) => formatMoney(c.amountMinor, c.currency, locale)).join(" · ");
}

export function TopBranchesWidget({ data }: { data?: TopBranch[] }) {
  const t = useTranslations("dashboard.kpis");
  const locale = useLocale();
  return (
    <WidgetCard title={t("topBranches")} loading={!data} empty={data?.length === 0}>
      {data?.map((b, i) => (
        <div key={b.branchId} className="flex items-center justify-between gap-2 text-sm">
          <span className="flex min-w-0 items-center gap-2">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium text-muted-foreground">
              {i + 1}
            </span>
            <span className="truncate">{locale === "ar" ? b.nameAr : b.nameEn}</span>
          </span>
          <span className="shrink-0 font-medium tabular-nums">
            {formatMoney(b.netRevenue.amountMinor, b.netRevenue.currency, locale)}
          </span>
        </div>
      ))}
    </WidgetCard>
  );
}

export function SalesByPaymentMethodWidget({ data }: { data?: SalesByPaymentMethod[] }) {
  const t = useTranslations("dashboard.kpis");
  const tPos = useTranslations("pos.methods");
  const locale = useLocale();
  return (
    <WidgetCard title={t("salesByPayment")} loading={!data} empty={data?.length === 0}>
      {data?.map((m) => (
        <div key={m.method} className="flex items-center justify-between gap-2 text-sm">
          <span className="truncate">{tPos(m.method)}</span>
          <span className="shrink-0 font-medium tabular-nums">{moneyLine(m.byCurrency, locale)}</span>
        </div>
      ))}
    </WidgetCard>
  );
}

export function TopServicesWidget({ data }: { data?: TopService[] }) {
  const t = useTranslations("dashboard.kpis");
  const locale = useLocale();
  return (
    <WidgetCard title={t("topServices")} loading={!data} empty={data?.length === 0}>
      {data?.map((s, i) => (
        <div key={s.serviceId} className="flex items-center justify-between gap-2 text-sm">
          <span className="flex min-w-0 items-center gap-2">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium text-muted-foreground">
              {i + 1}
            </span>
            <span className="truncate">{locale === "ar" ? s.nameAr : s.nameEn}</span>
          </span>
          <span className="shrink-0 tabular-nums text-muted-foreground">{s.completedCount}</span>
        </div>
      ))}
    </WidgetCard>
  );
}

export function LowStockWidget({ data }: { data?: LowStockAlert[] }) {
  const t = useTranslations("dashboard.kpis");
  const locale = useLocale();
  return (
    <WidgetCard title={t("lowStock")} loading={!data} empty={data?.length === 0}>
      {data?.map((p) => (
        <div key={`${p.productId}-${p.branchId}`} className="flex items-center justify-between gap-2 text-sm">
          <span className="min-w-0 truncate">
            {locale === "ar" && p.nameAr ? p.nameAr : p.nameEn}
            <span className="ms-1.5 text-xs text-muted-foreground">· {p.branchNameEn}</span>
          </span>
          <Badge variant="warning">
            {p.quantity}/{p.reorderLevel}
          </Badge>
        </div>
      ))}
    </WidgetCard>
  );
}

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  waiting: "muted",
  confirmed: "info",
  in_progress: "warning",
  completed: "success",
  cancelled: "destructive",
};

export function RecentAppointmentsWidget({ data }: { data?: RecentAppointment[] }) {
  const t = useTranslations("dashboard.kpis");
  const tStatus = useTranslations("appointments.status");
  const locale = useLocale();
  const timeFmt = new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en", { hour: "2-digit", minute: "2-digit" });
  return (
    <WidgetCard title={t("recentAppointments")} loading={!data} empty={data?.length === 0}>
      {data?.map((a) => (
        <div key={a.id} className="flex items-center justify-between gap-2 text-sm">
          <span className="min-w-0 truncate">
            {a.customerName ?? a.appointmentNo}
            <span className="ms-1.5 text-xs text-muted-foreground">
              {a.barberName} · {timeFmt.format(new Date(a.scheduledStart))}
            </span>
          </span>
          <Badge variant={STATUS_VARIANT[a.status] ?? "muted"}>{tStatus(a.status)}</Badge>
        </div>
      ))}
    </WidgetCard>
  );
}

export function TodaysSummaryWidget({ data }: { data?: TodaysSummary }) {
  const t = useTranslations("dashboard.kpis");
  const tSummary = useTranslations("dashboard.todaysSummary");
  if (!data) {
    return (
      <div className="flex h-64 flex-col rounded-xl border border-border bg-card p-4 shadow-sm">
        <p className="mb-2 text-sm font-medium">{t("todaysSummary")}</p>
        <div className="flex-1 animate-pulse rounded-lg bg-muted" />
      </div>
    );
  }
  const rows: { label: string; value: number | string }[] = [
    { label: tSummary("walkIns"), value: data.walkIns },
    { label: tSummary("appointmentsCompleted"), value: data.appointmentsCompleted },
    { label: tSummary("servicesDelivered"), value: data.servicesDelivered },
    { label: tSummary("productsSold"), value: data.productsSold },
    { label: tSummary("newCustomers"), value: data.newCustomers },
    { label: tSummary("loyaltyRedeemed"), value: data.loyaltyRedeemed ?? "—" },
  ];
  return (
    <div className="flex h-64 flex-col rounded-xl border border-border bg-card p-4 shadow-sm">
      <p className="mb-2 text-sm font-medium">{t("todaysSummary")}</p>
      <div className="grid flex-1 grid-cols-2 content-start gap-3">
        {rows.map((r) => (
          <div key={r.label}>
            <p className="text-xs text-muted-foreground">{r.label}</p>
            <p className="text-lg font-semibold tabular-nums">{r.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

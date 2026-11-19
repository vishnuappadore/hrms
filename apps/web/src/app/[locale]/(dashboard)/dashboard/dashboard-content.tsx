"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CalendarClock, Footprints, Gift, UserCheck, Wallet } from "lucide-react";
import { formatMoney } from "@keystonehr/shared";
import { KpiCard } from "@/components/kpi-card";
import { Select } from "@/components/ui/select";
import { usePermissions } from "@/lib/permissions";
import { useMe } from "@/lib/queries/users";
import { useBranches } from "@/lib/queries/branches";
import { useDashboard } from "@/lib/queries/dashboard";
import { MyPanelWidget } from "./my-panel-widget";
import { RevenueOverviewChart } from "./revenue-overview-chart";
import {
  LowStockWidget,
  RecentAppointmentsWidget,
  SalesByPaymentMethodWidget,
  TodaysSummaryWidget,
  TopBranchesWidget,
  TopServicesWidget,
} from "./dashboard-widgets";

export function DashboardContent() {
  const t = useTranslations("dashboard");
  const tKpis = useTranslations("dashboard.kpis");
  const locale = useLocale();
  const permissions = usePermissions();
  const { data: me } = useMe();

  const { data: branchesData } = useBranches({ page: 1, pageSize: 100, status: "active" });
  const branches = branchesData?.data ?? [];
  const [branchId, setBranchId] = useState<string | undefined>(undefined);
  const { data, isLoading } = useDashboard({ branchId });

  // A single-branch caller never sees a filter implying a cross-branch view the Dashboard spec
  // explicitly forbids them (docs/MODULES/dashboard.md's RBAC rule).
  const showBranchFilter = me?.allBranches || (me?.branchIds.length ?? 0) > 1;

  const canRevenue = permissions.includes("pos.use") || permissions.includes("invoices.view");
  const canAppointments = permissions.includes("appointments.view");
  const canWalkIns = permissions.includes("walkin.view");
  const canLoyalty = permissions.includes("loyalty.view");
  const canTopServices = canRevenue || permissions.includes("services.view");
  const canLowStock = permissions.includes("inventory.view");
  const canTodaysSummary = canWalkIns || canAppointments;

  const money = (byCurrency?: { currency: string; amountMinor: number }[]) =>
    !byCurrency || byCurrency.length === 0
      ? undefined
      : byCurrency.length === 1
        ? formatMoney(byCurrency[0]!.amountMinor, byCurrency[0]!.currency, locale)
        : byCurrency.map((c) => formatMoney(c.amountMinor, c.currency, locale)).join(" · ");

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="mb-1 text-xl font-semibold">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        {showBranchFilter && (
          <Select
            value={branchId ?? ""}
            onChange={(e) => setBranchId(e.target.value || undefined)}
            className="min-w-0 max-w-56"
          >
            <option value="">{t("allBranches")}</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.nameEn}
              </option>
            ))}
          </Select>
        )}
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {canRevenue && (
          <KpiCard
            label={tKpis("revenueToday")}
            icon={Wallet}
            loading={isLoading}
            value={money(data?.revenueToday?.byCurrency)}
            delta={data?.revenueToday ? { pct: data.revenueToday.deltaByCurrency[0]?.changePct ?? null } : undefined}
          />
        )}
        {canRevenue && (
          <KpiCard
            label={tKpis("revenueMonth")}
            icon={Wallet}
            loading={isLoading}
            value={money(data?.revenueMonth?.byCurrency)}
            delta={data?.revenueMonth ? { pct: data.revenueMonth.deltaByCurrency[0]?.changePct ?? null } : undefined}
          />
        )}
        {canAppointments && (
          <KpiCard
            label={tKpis("appointmentsToday")}
            icon={CalendarClock}
            loading={isLoading}
            value={data?.appointmentsToday?.today}
            delta={data?.appointmentsToday ? { pct: data.appointmentsToday.changePct } : undefined}
          />
        )}
        {canLoyalty && (
          <KpiCard label={tKpis("activeMembers")} icon={UserCheck} loading={isLoading} value={undefined} />
        )}
        {canWalkIns && (
          <KpiCard label={tKpis("walkIns")} icon={Footprints} loading={isLoading} value={data?.walkIns?.today} />
        )}
        {canLoyalty && (
          <KpiCard label={tKpis("loyaltyRedeemed")} icon={Gift} loading={isLoading} value={undefined} />
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <MyPanelWidget />
        {canRevenue && <RevenueOverviewChart data={data?.revenueOverview} />}
        {canRevenue && <TopBranchesWidget data={data?.topBranches} />}
        {canRevenue && <SalesByPaymentMethodWidget data={data?.salesByPaymentMethod} />}
        {canTopServices && <TopServicesWidget data={data?.topServices} />}
        {canLowStock && <LowStockWidget data={data?.lowStockAlerts} />}
        {canAppointments && <RecentAppointmentsWidget data={data?.recentAppointments} />}
        {canTodaysSummary && <TodaysSummaryWidget data={data?.todaysSummary} />}
      </div>
    </div>
  );
}

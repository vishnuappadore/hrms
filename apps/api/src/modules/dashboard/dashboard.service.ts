import { Injectable } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import {
  DASHBOARD_SECTION_PERMISSIONS,
  type AppointmentsTodayKpi,
  type DashboardQuery,
  type DashboardResponse,
  type LowStockAlert,
  type MoneyByCurrency,
  type RecentAppointment,
  type RevenueKpi,
  type RevenueOverviewPoint,
  type SalesByPaymentMethod,
  type TodaysSummary,
  type TopBranch,
  type TopService,
} from "@keystonehr/shared";
import { CLS_KEYS, getEffectiveBranchIds } from "../../common/request-context";
import { PermissionSetService } from "../../common/permission-set.service";
import { PrismaService } from "../../database/prisma.service";
import { WalkInsService } from "../walk-ins/walk-ins.service";

interface DateRange {
  start: Date;
  end: Date;
}

/**
 * `TREND_WINDOW_DAYS`: the spec (docs/MODULES/dashboard.md) doesn't pin a default window for
 * the "Revenue Overview" trend chart (flagged as an open question there) — 14 days is a
 * reasonable default for an admin dashboard, adjustable later without an API shape change.
 */
const TREND_WINDOW_DAYS = 14;

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService,
    private readonly permissionSet: PermissionSetService,
    private readonly walkIns: WalkInsService,
  ) {}

  async get(query: DashboardQuery): Promise<DashboardResponse> {
    const roleId = this.cls.get(CLS_KEYS.roleId) as string;
    const perms = await this.permissionSet.getPermissionSet(roleId);
    const can = (keys: readonly string[]) => keys.some((k) => perms.has(k));

    // @BranchScoped("branchId") on the controller already rejected a branchId outside the
    // caller's assigned branches, so trusting it here is safe.
    const effective = query.branchId ? [query.branchId] : getEffectiveBranchIds(this.cls);
    const ranges = this.buildDateRanges();

    const sections: DashboardResponse = {};
    const tasks: Promise<void>[] = [];

    if (can(DASHBOARD_SECTION_PERMISSIONS.revenueToday)) {
      tasks.push(
        this.revenue(effective, ranges.today, ranges.yesterday).then((r) => {
          sections.revenueToday = r;
        }),
      );
    }
    if (can(DASHBOARD_SECTION_PERMISSIONS.revenueMonth)) {
      tasks.push(
        this.revenue(effective, ranges.monthToDate, ranges.prevMonthSamePeriod).then((r) => {
          sections.revenueMonth = r;
        }),
      );
    }
    if (can(DASHBOARD_SECTION_PERMISSIONS.appointmentsToday)) {
      tasks.push(
        this.appointmentsToday(effective, ranges).then((r) => {
          sections.appointmentsToday = r;
        }),
      );
    }
    // Active Members / Loyalty Redeemed: permitted but no data source — there is no Loyalty
    // module/table in the schema at all (confirmed). Literal null (not omitted) distinguishes
    // "you can see this, it's just empty" from "you can't see this" (an absent key).
    if (can(DASHBOARD_SECTION_PERMISSIONS.activeMembers)) sections.activeMembers = null;
    if (can(DASHBOARD_SECTION_PERMISSIONS.loyaltyRedeemed)) sections.loyaltyRedeemed = null;
    if (can(DASHBOARD_SECTION_PERMISSIONS.walkIns)) {
      tasks.push(
        this.walkIns.stats(query.branchId).then((r) => {
          sections.walkIns = { today: r.doneToday };
        }),
      );
    }
    if (can(DASHBOARD_SECTION_PERMISSIONS.revenueOverview)) {
      tasks.push(
        this.revenueOverview(effective, ranges.trendWindow).then((r) => {
          sections.revenueOverview = r;
        }),
      );
    }
    if (can(DASHBOARD_SECTION_PERMISSIONS.topBranches)) {
      tasks.push(
        this.topBranches(effective, ranges.monthToDate).then((r) => {
          sections.topBranches = r;
        }),
      );
    }
    if (can(DASHBOARD_SECTION_PERMISSIONS.salesByPaymentMethod)) {
      tasks.push(
        this.salesByPaymentMethod(effective, ranges.monthToDate).then((r) => {
          sections.salesByPaymentMethod = r;
        }),
      );
    }
    if (can(DASHBOARD_SECTION_PERMISSIONS.topServices)) {
      tasks.push(
        this.topServices(effective, ranges.monthToDate).then((r) => {
          sections.topServices = r;
        }),
      );
    }
    if (can(DASHBOARD_SECTION_PERMISSIONS.lowStockAlerts)) {
      tasks.push(
        this.lowStockAlerts(effective).then((r) => {
          sections.lowStockAlerts = r;
        }),
      );
    }
    if (can(DASHBOARD_SECTION_PERMISSIONS.recentAppointments)) {
      tasks.push(
        this.recentAppointments(effective).then((r) => {
          sections.recentAppointments = r;
        }),
      );
    }
    if (can(DASHBOARD_SECTION_PERMISSIONS.todaysSummary)) {
      tasks.push(
        this.todaysSummary(effective, ranges.today, query.branchId).then((r) => {
          sections.todaysSummary = r;
        }),
      );
    }

    await Promise.all(tasks);
    return sections;
  }

  /* ── sections ─────────────────────────────────────────────────────────── */

  /** First-ever reader of finance_transactions. Grouped by currency (never blended — see
   *  dashboard.ts's module comment) and by direction, so refunds (direction "out", once a
   *  category exists for them) net out for free the day POS gets a refund endpoint. */
  private async revenue(
    effective: string[] | undefined,
    current: DateRange,
    previous: DateRange,
  ): Promise<RevenueKpi> {
    const branchWhere = effective ? { branchId: { in: effective } } : {};
    const [currentRows, previousRows] = await Promise.all([
      this.prisma.client.financeTransaction.groupBy({
        by: ["currency", "direction"],
        where: { ...branchWhere, category: "sale_revenue", occurredAt: { gte: current.start, lt: current.end } },
        _sum: { amountMinor: true },
      }),
      this.prisma.client.financeTransaction.groupBy({
        by: ["currency", "direction"],
        where: { ...branchWhere, category: "sale_revenue", occurredAt: { gte: previous.start, lt: previous.end } },
        _sum: { amountMinor: true },
      }),
    ]);

    const netByCurrency = (rows: typeof currentRows) => {
      const net = new Map<string, number>();
      for (const r of rows) {
        const amount = Number(r._sum.amountMinor ?? 0n);
        const signed = r.direction === "out" ? -amount : amount;
        net.set(r.currency, (net.get(r.currency) ?? 0) + signed);
      }
      return net;
    };
    const currentNet = netByCurrency(currentRows);
    const previousNet = netByCurrency(previousRows);

    const currencies = new Set([...currentNet.keys(), ...previousNet.keys()]);
    const byCurrency: MoneyByCurrency[] = [];
    const deltaByCurrency: { currency: string; changePct: number | null }[] = [];
    for (const currency of currencies) {
      const currentAmount = currentNet.get(currency) ?? 0;
      const previousAmount = previousNet.get(currency) ?? 0;
      byCurrency.push({ currency, amountMinor: currentAmount });
      deltaByCurrency.push({
        currency,
        changePct: previousAmount === 0 ? null : round1(((currentAmount - previousAmount) / previousAmount) * 100),
      });
    }
    return { byCurrency, deltaByCurrency };
  }

  private async revenueOverview(
    effective: string[] | undefined,
    window: DateRange,
  ): Promise<RevenueOverviewPoint[]> {
    const branchWhere = effective ? { branchId: { in: effective } } : {};
    // Prisma can't group by a truncated date on a DateTime column — fetch the (bounded, small at
    // small-salon scale) window and bucket by day in JS, mirroring the house "fetch rows, reduce
    // in JS" pattern (attendance.service.ts's getKpis()).
    const rows = await this.prisma.client.financeTransaction.findMany({
      where: { ...branchWhere, category: "sale_revenue", occurredAt: { gte: window.start, lt: window.end } },
      select: { currency: true, direction: true, amountMinor: true, occurredAt: true },
    });

    const byDay = new Map<string, Map<string, number>>();
    for (const r of rows) {
      const day = toLocalDateKey(r.occurredAt);
      const perCurrency = byDay.get(day) ?? new Map<string, number>();
      const amount = Number(r.amountMinor);
      const signed = r.direction === "out" ? -amount : amount;
      perCurrency.set(r.currency, (perCurrency.get(r.currency) ?? 0) + signed);
      byDay.set(day, perCurrency);
    }

    const points: RevenueOverviewPoint[] = [];
    for (let d = new Date(window.start); d < window.end; d.setDate(d.getDate() + 1)) {
      // Local date components, not toISOString — window.start/end are local-midnight instants
      // (buildDateRanges()'s convention), and toISOString reports the UTC calendar date, which
      // rolls back a day for any positive UTC offset (e.g. IST) and silently drops "today".
      const day = toLocalDateKey(d);
      const perCurrency = byDay.get(day);
      points.push({
        date: day,
        byCurrency: perCurrency
          ? [...perCurrency.entries()].map(([currency, amountMinor]) => ({ currency, amountMinor }))
          : [],
      });
    }
    return points;
  }

  private async appointmentsToday(
    effective: string[] | undefined,
    ranges: Ranges,
  ): Promise<AppointmentsTodayKpi> {
    const branchWhere = effective ? { branchId: { in: effective } } : {};
    const [today, yesterday, statusRows] = await Promise.all([
      this.prisma.client.appointment.count({
        where: { ...branchWhere, scheduledStart: { gte: ranges.today.start, lt: ranges.today.end } },
      }),
      this.prisma.client.appointment.count({
        where: { ...branchWhere, scheduledStart: { gte: ranges.yesterday.start, lt: ranges.yesterday.end } },
      }),
      this.prisma.client.appointment.groupBy({
        by: ["status"],
        where: { ...branchWhere, scheduledStart: { gte: ranges.today.start, lt: ranges.today.end } },
        _count: true,
      }),
    ]);
    return {
      today,
      yesterday,
      changePct: yesterday === 0 ? null : round1(((today - yesterday) / yesterday) * 100),
      byStatus: Object.fromEntries(statusRows.map((r) => [r.status, r._count])),
    };
  }

  /** `Payment` has no `currency` column, and Prisma's `groupBy` `by` clause is restricted to the
   *  queried model's own scalar fields (relational filters work in `where`, not `by`) — so this
   *  resolves each branch's currency first, then runs one groupBy per currency bucket (almost
   *  always a single bucket in practice). */
  private async salesByPaymentMethod(
    effective: string[] | undefined,
    range: DateRange,
  ): Promise<SalesByPaymentMethod[]> {
    const branches = await this.prisma.client.branch.findMany({
      where: effective ? { id: { in: effective } } : {},
      select: { id: true, currency: true },
    });
    const branchIdsByCurrency = new Map<string, string[]>();
    for (const b of branches) {
      const list = branchIdsByCurrency.get(b.currency) ?? [];
      list.push(b.id);
      branchIdsByCurrency.set(b.currency, list);
    }

    const methods = new Map<string, MoneyByCurrency[]>();
    await Promise.all(
      [...branchIdsByCurrency.entries()].map(async ([currency, branchIds]) => {
        const rows = await this.prisma.client.payment.groupBy({
          by: ["method"],
          where: {
            invoice: { branchId: { in: branchIds }, status: { not: "void" }, createdAt: { gte: range.start, lt: range.end } },
          },
          _sum: { amountMinor: true },
        });
        for (const r of rows) {
          const list = methods.get(r.method) ?? [];
          list.push({ currency, amountMinor: Number(r._sum.amountMinor ?? 0n) });
          methods.set(r.method, list);
        }
      }),
    );
    return [...methods.entries()].map(([method, byCurrency]) => ({ method, byCurrency }));
  }

  private async topBranches(effective: string[] | undefined, range: DateRange): Promise<TopBranch[]> {
    const branchWhere = effective ? { branchId: { in: effective } } : {};
    const rows = await this.prisma.client.financeTransaction.groupBy({
      by: ["branchId", "currency", "direction"],
      where: { ...branchWhere, category: "sale_revenue", occurredAt: { gte: range.start, lt: range.end } },
      _sum: { amountMinor: true },
    });

    const net = new Map<string, { currency: string; amountMinor: number }>();
    for (const r of rows) {
      const amount = Number(r._sum.amountMinor ?? 0n);
      const signed = r.direction === "out" ? -amount : amount;
      const key = r.branchId;
      const existing = net.get(key);
      net.set(key, { currency: r.currency, amountMinor: (existing?.amountMinor ?? 0) + signed });
    }

    const ranked = [...net.entries()].sort((a, b) => b[1].amountMinor - a[1].amountMinor).slice(0, 10);
    const branches = await this.prisma.client.branch.findMany({
      where: { id: { in: ranked.map(([id]) => id) } },
      select: { id: true, nameEn: true, nameAr: true },
    });
    const byId = new Map(branches.map((b) => [b.id, b]));
    return ranked.map(([branchId, revenue]) => ({
      branchId,
      nameEn: byId.get(branchId)?.nameEn ?? "—",
      nameAr: byId.get(branchId)?.nameAr ?? "—",
      netRevenue: revenue,
    }));
  }

  private async topServices(effective: string[] | undefined, range: DateRange): Promise<TopService[]> {
    const grouped = await this.prisma.client.invoiceItem.groupBy({
      by: ["itemId"],
      where: {
        itemType: "service",
        invoice: {
          ...(effective ? { branchId: { in: effective } } : {}),
          status: { not: "void" },
          createdAt: { gte: range.start, lt: range.end },
        },
      },
      _sum: { quantity: true },
      orderBy: { _sum: { quantity: "desc" } },
      take: 10,
    });
    const services = await this.prisma.client.service.findMany({
      where: { id: { in: grouped.map((g) => g.itemId) } },
      select: { id: true, nameEn: true, nameAr: true },
    });
    const byId = new Map(services.map((s) => [s.id, s]));
    return grouped.map((g) => ({
      serviceId: g.itemId,
      nameEn: byId.get(g.itemId)?.nameEn ?? "—",
      nameAr: byId.get(g.itemId)?.nameAr ?? "—",
      completedCount: g._sum.quantity ?? 0,
    }));
  }

  /** `StockLevel.quantity <= Product.reorderLevel` compares columns across two tables — Prisma
   *  can't express that in a `where` without raw SQL, and the tenancy Prisma extension only
   *  intercepts model operations (not `$queryRaw`/`$executeRaw`), so a bare raw query here would
   *  silently run with no tenant GUC set and return zero rows. Fetch-then-filter-in-JS (same
   *  pattern as attendance.service.ts) sidesteps that trap entirely at small-salon scale. */
  private async lowStockAlerts(effective: string[] | undefined): Promise<LowStockAlert[]> {
    const [stockLevels, products, branches] = await Promise.all([
      this.prisma.client.stockLevel.findMany({
        where: effective ? { branchId: { in: effective } } : {},
      }),
      this.prisma.client.product.findMany({
        where: { deletedAt: null },
        select: { id: true, nameEn: true, nameAr: true, reorderLevel: true },
      }),
      this.prisma.client.branch.findMany({
        where: effective ? { id: { in: effective } } : {},
        select: { id: true, nameEn: true },
      }),
    ]);
    const productById = new Map(products.map((p) => [p.id, p]));
    const branchById = new Map(branches.map((b) => [b.id, b]));

    return stockLevels
      .map((sl): LowStockAlert | null => {
        const product = productById.get(sl.productId);
        if (!product || sl.quantity > product.reorderLevel) return null;
        return {
          productId: sl.productId,
          nameEn: product.nameEn,
          nameAr: product.nameAr,
          branchId: sl.branchId,
          branchNameEn: branchById.get(sl.branchId)?.nameEn ?? "—",
          quantity: sl.quantity,
          reorderLevel: product.reorderLevel,
        };
      })
      .filter((x): x is LowStockAlert => x !== null)
      .sort((a, b) => a.quantity - b.quantity)
      .slice(0, 20);
  }

  private async recentAppointments(effective: string[] | undefined): Promise<RecentAppointment[]> {
    const rows = await this.prisma.client.appointment.findMany({
      where: effective ? { branchId: { in: effective } } : {},
      orderBy: { scheduledStart: "desc" },
      take: 10,
      include: {
        branch: { select: { nameEn: true } },
        barber: { select: { name: true } },
        customer: { select: { name: true } },
      },
    });
    return rows.map((a) => ({
      id: a.id,
      appointmentNo: a.appointmentNo,
      customerName: a.customer?.name ?? null,
      barberName: a.barber.name,
      branchNameEn: a.branch.nameEn,
      status: a.status,
      scheduledStart: a.scheduledStart.toISOString(),
    }));
  }

  /** `newCustomers` is tenant-wide even for a branch-scoped caller — `Customer` has no
   *  `branchId` column at all (confirmed), so there's no correct way to scope it; approximating
   *  via a customer's first appointment/invoice branch would be a different, more expensive, and
   *  questionably-defined query. Documented limitation, not silently guessed at. */
  private async todaysSummary(
    effective: string[] | undefined,
    today: DateRange,
    branchIdOverride: string | undefined,
  ): Promise<TodaysSummary> {
    const branchWhere = effective ? { branchId: { in: effective } } : {};
    const invoiceWhere = {
      status: { not: "void" as const },
      createdAt: { gte: today.start, lt: today.end },
      ...(effective ? { branchId: { in: effective } } : {}),
    };

    const [walkInStats, appointmentsCompleted, servicesSum, productsSum, newCustomers] = await Promise.all([
      this.walkIns.stats(branchIdOverride),
      this.prisma.client.appointment.count({
        where: { ...branchWhere, status: "completed", scheduledStart: { gte: today.start, lt: today.end } },
      }),
      this.prisma.client.invoiceItem.aggregate({
        where: { itemType: "service", invoice: invoiceWhere },
        _sum: { quantity: true },
      }),
      this.prisma.client.invoiceItem.aggregate({
        where: { itemType: "product", invoice: invoiceWhere },
        _sum: { quantity: true },
      }),
      this.prisma.client.customer.count({ where: { createdAt: { gte: today.start, lt: today.end } } }),
    ]);

    return {
      walkIns: walkInStats.doneToday,
      appointmentsCompleted,
      servicesDelivered: servicesSum._sum.quantity ?? 0,
      productsSold: productsSum._sum.quantity ?? 0,
      newCustomers,
      loyaltyRedeemed: null,
    };
  }

  /* ── date ranges ──────────────────────────────────────────────────────── */

  /**
   * Plain server-local date math (no explicit tenant-timezone conversion) — matches every other
   * module's existing day-boundary convention (e.g. walk-ins.service.ts's `stats()`,
   * attendance's KPIs): `docs/GLOBALIZATION.md` wants tenant-local midnight, but no module in
   * this codebase implements that yet (appointments.service.ts documents the same gap: "there is
   * no per-branch timezone model yet, so deployments must run the API in the salon's timezone").
   * Not a Dashboard-specific shortcut — a pre-existing, app-wide limitation.
   */
  private buildDateRanges(): Ranges {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);
    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);

    const monthStart = new Date(todayStart.getFullYear(), todayStart.getMonth(), 1);
    const daysElapsed = Math.floor((todayStart.getTime() - monthStart.getTime()) / 86_400_000) + 1;
    const prevMonthStart = new Date(todayStart.getFullYear(), todayStart.getMonth() - 1, 1);
    const prevMonthSamePeriodEnd = new Date(prevMonthStart);
    prevMonthSamePeriodEnd.setDate(prevMonthSamePeriodEnd.getDate() + daysElapsed);

    const trendStart = new Date(todayStart);
    trendStart.setDate(trendStart.getDate() - (TREND_WINDOW_DAYS - 1));

    return {
      today: { start: todayStart, end: tomorrowStart },
      yesterday: { start: yesterdayStart, end: todayStart },
      monthToDate: { start: monthStart, end: tomorrowStart },
      prevMonthSamePeriod: { start: prevMonthStart, end: prevMonthSamePeriodEnd },
      trendWindow: { start: trendStart, end: tomorrowStart },
    };
  }
}

interface Ranges {
  today: DateRange;
  yesterday: DateRange;
  monthToDate: DateRange;
  prevMonthSamePeriod: DateRange;
  trendWindow: DateRange;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Local (server-clock) calendar date as YYYY-MM-DD — never toISOString().slice(0,10), which
 *  reports the UTC calendar date and silently shifts by a day under any positive UTC offset. */
function toLocalDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

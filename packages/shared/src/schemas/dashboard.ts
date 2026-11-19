import { z } from "zod";

/**
 * Settings-free, read-only Dashboard module (docs/MODULES/dashboard.md). Every section is
 * OPTIONAL in the response: absent means the caller's role lacks the matching permission
 * (server-side omission, not a 403 for the whole page — see DASHBOARD_SECTION_PERMISSIONS).
 *
 * Money is NEVER a bare number here — `docs/GLOBALIZATION.md` defers cross-currency
 * consolidated reporting, and `Branch.currency` isn't schema-constrained to match the tenant
 * default, so every revenue figure is reported grouped by currency (almost always one entry
 * in practice, but never silently blended if a tenant's branches ever diverge).
 */

export const MoneyByCurrencySchema = z.object({
  currency: z.string(), // ISO 4217
  amountMinor: z.number().int(), // integer minor units — packages/shared/src/money.ts convention
});
export type MoneyByCurrency = z.infer<typeof MoneyByCurrencySchema>;

export const RevenueKpiSchema = z.object({
  byCurrency: z.array(MoneyByCurrencySchema),
  /** vs the prior equivalent period, computed PER currency — never blended. null = prior period
   *  had zero (undefined %). */
  deltaByCurrency: z.array(z.object({ currency: z.string(), changePct: z.number().nullable() })),
});
export type RevenueKpi = z.infer<typeof RevenueKpiSchema>;

export const AppointmentsTodayKpiSchema = z.object({
  today: z.number().int(),
  yesterday: z.number().int(),
  changePct: z.number().nullable(),
  byStatus: z.record(z.string(), z.number().int()),
});
export type AppointmentsTodayKpi = z.infer<typeof AppointmentsTodayKpiSchema>;

export const WalkInsKpiSchema = z.object({ today: z.number().int() });
export type WalkInsKpi = z.infer<typeof WalkInsKpiSchema>;

export const RevenueOverviewPointSchema = z.object({
  date: z.string(), // YYYY-MM-DD
  byCurrency: z.array(MoneyByCurrencySchema),
});
export type RevenueOverviewPoint = z.infer<typeof RevenueOverviewPointSchema>;

export const TopBranchSchema = z.object({
  branchId: z.string().uuid(),
  nameEn: z.string(),
  nameAr: z.string(),
  netRevenue: MoneyByCurrencySchema, // one branch = one currency
});
export type TopBranch = z.infer<typeof TopBranchSchema>;

export const SalesByPaymentMethodSchema = z.object({
  method: z.string(),
  byCurrency: z.array(MoneyByCurrencySchema),
});
export type SalesByPaymentMethod = z.infer<typeof SalesByPaymentMethodSchema>;

export const TopServiceSchema = z.object({
  serviceId: z.string().uuid(),
  nameEn: z.string(),
  nameAr: z.string(),
  completedCount: z.number().int(),
});
export type TopService = z.infer<typeof TopServiceSchema>;

export const LowStockAlertSchema = z.object({
  productId: z.string().uuid(),
  nameEn: z.string(),
  nameAr: z.string().nullable(),
  branchId: z.string().uuid(),
  branchNameEn: z.string(),
  quantity: z.number().int(),
  reorderLevel: z.number().int(),
});
export type LowStockAlert = z.infer<typeof LowStockAlertSchema>;

export const RecentAppointmentSchema = z.object({
  id: z.string().uuid(),
  appointmentNo: z.string(),
  customerName: z.string().nullable(),
  barberName: z.string(),
  branchNameEn: z.string(),
  status: z.string(),
  scheduledStart: z.string(),
});
export type RecentAppointment = z.infer<typeof RecentAppointmentSchema>;

export const TodaysSummarySchema = z.object({
  walkIns: z.number().int(),
  appointmentsCompleted: z.number().int(),
  servicesDelivered: z.number().int(),
  productsSold: z.number().int(),
  newCustomers: z.number().int(),
  /** Always null — no Loyalty module/table exists yet. */
  loyaltyRedeemed: z.null(),
});
export type TodaysSummary = z.infer<typeof TodaysSummarySchema>;

export const DashboardResponseSchema = z.object({
  revenueToday: RevenueKpiSchema.optional(),
  revenueMonth: RevenueKpiSchema.optional(),
  appointmentsToday: AppointmentsTodayKpiSchema.optional(),
  /** Present-but-null = permitted, no data source yet (no Loyalty module at all). */
  activeMembers: z.null().optional(),
  walkIns: WalkInsKpiSchema.optional(),
  loyaltyRedeemed: z.null().optional(),
  revenueOverview: z.array(RevenueOverviewPointSchema).optional(),
  topBranches: z.array(TopBranchSchema).optional(),
  salesByPaymentMethod: z.array(SalesByPaymentMethodSchema).optional(),
  topServices: z.array(TopServiceSchema).optional(),
  lowStockAlerts: z.array(LowStockAlertSchema).optional(),
  recentAppointments: z.array(RecentAppointmentSchema).optional(),
  todaysSummary: TodaysSummarySchema.optional(),
});
export type DashboardResponse = z.infer<typeof DashboardResponseSchema>;

export const DashboardQuerySchema = z.object({
  branchId: z.string().uuid().optional(),
});
export type DashboardQuery = z.infer<typeof DashboardQuerySchema>;

/**
 * ANY of these keys grants the section. Shared by the API's server-side section omission
 * (`DashboardService`) and the web's client-side hiding (`usePermissions()`), so the two never
 * drift apart.
 */
export const DASHBOARD_SECTION_PERMISSIONS: Record<keyof DashboardResponse, readonly string[]> = {
  revenueToday: ["pos.use", "invoices.view"],
  revenueMonth: ["pos.use", "invoices.view"],
  appointmentsToday: ["appointments.view"],
  activeMembers: ["loyalty.view"],
  walkIns: ["walkin.view"],
  loyaltyRedeemed: ["loyalty.view"],
  revenueOverview: ["pos.use", "invoices.view"],
  topBranches: ["pos.use", "invoices.view"],
  salesByPaymentMethod: ["pos.use", "invoices.view"],
  topServices: ["pos.use", "invoices.view", "services.view"],
  lowStockAlerts: ["inventory.view"],
  recentAppointments: ["appointments.view"],
  todaysSummary: ["walkin.view", "appointments.view"],
};

# Dashboard

```
status: BUILT — 11 of 13 KPIs (GET /dashboard + Settings-free Dashboard screen); Active Members
and Loyalty Redeemed render the existing empty state (no Loyalty module/table exists at all)
```

## Purpose

Central landing page after login. Real-time visibility into business performance, operational status, customer activity, appointments, revenue, inventory alerts, and branch performance across all Keystone HR Men Salon locations. Bilingual: every screen has English + Arabic (RTL) versions. Currency: OMR, 3 decimals (money stored as BIGINT baisa, 1 OMR = 1000 baisa).

## Primary users / permissions

- Super Admin
- Management Team
- Operations Manager
- Branch Manager (permission-based)
- Franchise Owner (permission-based)
- Custom-role users with access to specific KPI cards

### Access rules (RBAC + branch-level permissions)

**Super Admin** — all branches; consolidated reports; revenue, inventory, staff, customers across all branches; loyalty and finance data.

**Branch Admin / Branch Manager** — only branches assigned to their account: revenue, appointments, customers, staff, inventory, reports of assigned branches. **Cannot** access: other branches, corporate-wide reports, consolidated financial reports, global inventory data.

Implementation (as built): `getEffectiveBranchIds()` (`apps/api/src/common/request-context.ts`) resolves once per request to `undefined` (all branches) or a concrete branch-id array; every section query spreads `{ branchId: { in: effective } }` when defined, mirroring the established pattern from `BranchesService.stats()`/`AttendanceService.getKpis()`/`WalkInsService.stats()` — plain Prisma `count`/`groupBy`/`aggregate`, never raw SQL (the tenancy Prisma extension only intercepts model operations, not `$queryRaw`, which would silently return zero rows outside `withTenantTx`). `GET /dashboard` takes an optional `?branchId=` override, validated by the existing `@BranchScoped("branchId")` guard (403 `BRANCH_ACCESS_DENIED` if it's outside the caller's assigned branches).

**Per-KPI permission gating (beyond the page-level `dashboard.view` gate):** every section is independently gated by its own matching permission(s) — `DASHBOARD_SECTION_PERMISSIONS` (`packages/shared/src/schemas/dashboard.ts`) is the single source shared by the API (omits the key entirely from the response if the caller's role lacks it) and the web (hides the card/widget via the same `usePermissions()` convention used everywhere else). `dashboard.view` itself was previously held by only 4 of 7 seeded roles (Super Admin, Operations Manager, Branch Manager, Accountant) — added to Receptionist/Barber/Cashier too (backfilled via migration) so every role lands on a populated, correctly-scoped-down page rather than some roles getting no Dashboard at all.

**Currency safety:** `Branch.currency` is a free string, not FK-constrained to `Tenant.defaultCurrency` (`docs/GLOBALIZATION.md` defers cross-currency consolidated reporting) — every revenue figure is reported as `MoneyByCurrency[]`, grouped by currency, never blended into one number. In practice almost always one element; covered by a dedicated integration test with two branches in different currencies.

## KPI widgets (13) — exact formulas

1. **Revenue Today — BUILT.** `financeTransaction` grouped by currency, `direction:"in"` minus
   `direction:"out"` (so a future refund category nets out automatically — no refund endpoint
   exists yet, so the "out" leg is always 0 today; Membership Sales is already included for free
   since `FinanceTransaction.amountMinor` = the invoice total regardless of item-type mix, so no
   code change is needed once POS actually sells memberships/packages). vs-yesterday % computed
   per currency.
2. **Revenue This Month — BUILT.** Same aggregation, month-to-date vs same-elapsed-days-of-
   previous-month.
3. **Appointments Today — BUILT.** Count + status breakdown (`appointment.groupBy(["status"])`)
   + vs-yesterday %.
4. **Active Members — NOT BUILT (data source doesn't exist).** No Loyalty module/table anywhere
   in the schema. Permitted viewers (`loyalty.view`) see the existing `KpiCard` empty-state.
5. **Walk-ins — BUILT.** Reuses `WalkInsService.stats()`'s `doneToday`.
6. **Loyalty Redeemed — NOT BUILT.** Same reason as #4.
7. **Revenue Overview (chart) — BUILT.** 14-day trend (window length not pinned by the spec —
   flagged as an open question below the client doc too; 14 days is this build's default), one
   line per currency, Recharts. Fetch-then-bucket-in-JS (bounded window, small-salon scale), not
   a SQL-level date-truncate groupBy (Prisma can't express that without raw SQL).
8. **Top Branches — BUILT.** Ranked by net revenue (`financeTransaction.groupBy(["branchId",
   "currency","direction"])`, combined in JS).
9. **Sales by Payment Method — BUILT.** `Payment` has no `currency` column and Prisma's
   `groupBy`'s `by` clause can't include a relation field, so this resolves each branch's
   currency first and runs one `groupBy` per currency bucket (almost always a single bucket).
10. **Top Services — BUILT.** `InvoiceItem` (`itemType:"service"`) grouped by `itemId`, by count,
    joined back to the **current** service catalog name (not the invoice's point-in-time name
    snapshot).
11. **Low Stock Alerts — BUILT** (contrary to this doc's original assumption that it might be
    blocked — `apps/api/src/modules/inventory/` and the `StockLevel`/`Product.reorderLevel`
    schema both already exist, even though Inventory has no web screens yet). `quantity ≤
    reorderLevel` compares two tables' columns, which Prisma can't express without raw SQL —
    fetch-then-filter-in-JS instead (same house pattern as `attendance.service.ts`), since a bare
    `$queryRaw` outside `withTenantTx` would silently run with no tenant GUC set and return zero
    rows (the tenancy extension only intercepts model operations).
12. **Recent Appointments — BUILT.** Last 10 by `scheduledStart desc`.
13. **Today's Summary — BUILT, except its Loyalty Redeemed sub-metric.** `newCustomers` is
    **tenant-wide even for a branch-scoped caller** — `Customer` has no `branchId` column at all,
    so there's no correct way to scope it (approximating via a customer's first invoice/
    appointment branch would be a different, more expensive, questionably-defined query).

## Business rules

- All revenue figures are net of refunds and voided transactions (refunds are always 0 today —
  no POS refund endpoint exists yet; `pos.refund` is a catalog permission with no code behind it).
- Widget scoping: "all applicable stores" means all branches for Super Admin, assigned branches
  for branch-scoped roles — implemented via `getEffectiveBranchIds()`, same as every other
  module's branch-scoped list/stats endpoint.
- Freshness: TanStack Query `refetchInterval` 60s (the app's first use of this option) — built
  exactly as specced.
- Money is never a bare number in any Dashboard response field — every revenue figure is
  `{currency, amountMinor}[]`, grouped by currency (see RBAC section above).
- Day/month boundaries use plain server-local date math (no explicit tenant-timezone
  conversion) — matches every other module's existing convention (`walk-ins.service.ts`,
  attendance's KPIs; `appointments.service.ts` documents the same gap explicitly: "there is no
  per-branch timezone model yet, so deployments must run the API in the salon's timezone").
  `docs/GLOBALIZATION.md` wants tenant-local midnight; this is a pre-existing, app-wide
  limitation, not something Dashboard introduces or needs to fix alone.

## Data-model touchpoints

`finance_transactions` (revenue — Dashboard is the first code to ever read this ledger; POS is
the only writer, one `sale_revenue`/`direction:"in"` row per completed sale), `payments`
(sales by payment method), `invoice_items` (top services, today's summary services/products
delivered), `appointments` (appointments today, recent, today's summary), `customers` (new
customers — tenant-wide only, no `branchId` column exists), `stock_levels` +
`products.reorder_level` (low stock — Inventory's existing backend module, no screens yet),
`branches` (top branches, scoping). `loyalty_accounts`/`loyalty_transactions` do **not exist** —
Active Members/Loyalty Redeemed have no data source until a Loyalty module is built.

## Open questions

- ~~"Membership Sales" ... confirm whether membership purchase is an invoice item type~~ —
  resolved: `InvoiceItemType` already has `package`/`membership` variants, and since Dashboard's
  revenue comes from the invoice-level `finance_transactions` total (not summed per item type),
  membership/package revenue is included automatically the day POS starts selling them.
- Configured activity period for Active Members (default 180 days?) — still open; moot until a
  Loyalty module exists at all.
- Exact selected-period options for widgets 5–10 (day/week/month picker?) — **not built**: this
  pass ships fixed periods (today/month-to-date/14-day trend), no period selector UI. A future
  pass can add one without an API shape change (the query already accepts `?branchId=`; a
  `?period=` param would follow the same pattern).
- Revenue Overview's trend window length (14 days) is this build's own default, not specced
  anywhere — easy to change later (`TREND_WINDOW_DAYS` in `dashboard.service.ts`).

## Reconciliation vs 2026 client requirement doc

- Reviewed against the 2026 req (DASHBOARD section) — all 13 KPIs, their formulas, the Active-Member definition (three conditions), the Low-Stock condition (`Current Stock ≤ Minimum Stock Level`), and the RBAC/branch-scoping rules all match. No changes required.
- **Membership Sales** still appears in the Revenue Today / Revenue This Month formulas even though memberships are not modelled in v1 — this remains an open question above (treat as 0 until modelled).
- However, POS now promotes **Packages/Memberships** to in-scope cart items in the 2026 req — cross-check [[pos]] before finalizing how Membership Sales feeds these revenue formulas.

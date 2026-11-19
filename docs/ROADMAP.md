# Keystone HR — Roadmap (MVP build order & deferrals)

## How to use these docs

- **This file** is the phasing source of truth: what gets built, in what order, and what is explicitly deferred. It mirrors design-app.md §9.
- **`docs/MODULES/`** holds one self-contained product-requirement doc per module (screens, fields, validation, exact KPI formulas, status machines, business rules, data-model touchpoints, open questions), distilled from the client's 78-page requirement PDF — you should never need the PDF again. Each doc carries a build status header: `status: planned` (`status: scaffolded` for branches).
- When building a phase, read the corresponding module doc(s) first, resolve their "Open questions" section with the client/architect where they block the phase, and update the doc's status header as work lands.
- Global conventions everywhere: bilingual English + Arabic (RTL) for every screen; currency OMR with 3 decimals — money stored as BIGINT baisa (1 OMR = 1000 baisa); multi-tenant Postgres with RLS; RBAC + branch scoping.

Module docs: [auth](MODULES/auth.md) · [dashboard](MODULES/dashboard.md) · [branches](MODULES/branches.md) · [customers](MODULES/customers.md) · [appointments](MODULES/appointments.md) · [pos](MODULES/pos.md) · [staff](MODULES/staff.md) · [payroll](MODULES/payroll.md) · [attendance](MODULES/attendance.md) · [leave](MODULES/leave.md) · [leave-settings](MODULES/leave-settings.md) · [inventory](MODULES/inventory.md) · [procurement](MODULES/procurement.md) · [finance](MODULES/finance.md) · [loyalty](MODULES/loyalty.md) · [services](MODULES/services.md) · [settings](MODULES/settings.md) · [notifications](MODULES/notifications.md)

> **2026 requirement-doc refresh (2026-07-31).** All module docs (except branches) were reconciled
> against the client's updated requirement document. Net phasing changes captured below: **Payroll**
> and the **Procurement chain** move out of the deferred list into scope; **Services & Pricing** and a
> POS **Walk-In Queue** become first-class. The requirement doc is a *partial excerpt* — silence on a
> module (Notifications, Loyalty) is **not** a de-scope; those remain in scope. Where the new doc
> narrows a module (appointments 6→4-step wizard, single-step add-customer, dropped reserved-stock
> model, staff working-schedule/attendance surfaces), the specifics live in each doc's
> "⚠️ Changed in this revision" + "❓ Open questions" sections — resolve those before building the phase.

> **Staff module built ahead of sequence (2026-08).** Phase 7's staff management scope (4-step
> wizard, salary/commission, Payroll Components catalog) shipped before Phases 3–6
> (Appointments/POS/Loyalty/Dashboard). The *order* is otherwise unchanged — Appointments is still
> next — but Phase 7's demo checklist below now reflects partial completion rather than "not started."

## MVP build order (design-app.md §9)

Seven phases, strictly ordered; each ends in a demoable milestone. Week ranges are planning estimates for the 2–4 dev team; the *order* is the contract, dates may slip.

### Phase 1 — Foundations (weeks 1–3)
Monorepo (Turborepo + pnpm), CI, RLS + CLS tenancy plumbing, auth (JWT/argon2, cookies via Next BFF), RBAC guards + branch scoping, web shell with i18n/RTL (next-intl, logical-properties lint).
**De-risk RLS first** — prove transaction-local `set_config`, non-owner role + FORCE RLS, cross-tenant integration tests in week 1 (Risk #1).
**Demo:** log in as two tenants; each sees only its own data; Arabic RTL shell renders.
Docs: [auth](MODULES/auth.md), [settings](MODULES/settings.md) (roles & permissions seeding), [branches](MODULES/branches.md) (scaffolded).

### Phase 2 — Catalog + Customers (weeks 4–6) ✅
Service categories/services (EN/AR, durations, prices, branch overrides) — **built**. Customers — **built**: listing/search (name+mobile)/tier filter, **single-step add-customer with mobile-number dedupe** (`CUSTOMER_MOBILE_EXISTS` → surfaces the existing record), directly-editable loyalty tier (`new` default), and a profile (summary + statistics + appointment-history placeholder). Per the 2026 req the old two-step "existing-customer banner" wizard was dropped for single-step dedupe-on-save; visits/points/totalSpend are system-maintained counters (0 until POS/Appointments/Loyalty wire them).
**Demo:** register/search/edit customers; duplicate mobile blocked with a link to the existing record; manage the service catalog.
Docs: [customers](MODULES/customers.md), [branches](MODULES/branches.md).

### Phase 3 — Appointments (weeks 7–10)
Status machine (booked → confirmed → checked_in → in_progress → completed / cancelled / no_show), staff availability from schedules, 6-step booking wizard (verify customer → details → schedule & services → staff selection incl. "Any Available" → loyalty & promotions stub → review & book), appointments list with KPIs/filters.
**Demo:** book end-to-end for existing and new customers; eligible-staff filtering works; slot reserved; appointment appears in customer history.
Docs: [appointments](MODULES/appointments.md), [staff](MODULES/staff.md) (schedules).

### Phase 4 — POS (weeks 11–14) — heart of the product
Single-screen checkout: walk-in/existing/new customer, services + products tabs with stock check, cart, order summary (discounts, VAT, totals), payment methods incl. mada and split payment, and the atomic checkout transaction (invoices → payments → inventory deduction → finance ledger → commissions → audit) with idempotency keys and deterministic stock locking (Risks #2–3).
**Demo:** complete a mixed service+product sale with split payment; stock decrements; invoice prints; ledger and commission rows written; baisa invariant `sum(lines)+VAT−discount === total === sum(payments)` holds.
Docs: [pos](MODULES/pos.md), [inventory](MODULES/inventory.md) (stock model), [finance](MODULES/finance.md) (ledger).

### Phase 5 — Loyalty (weeks 15–16)
Tiers (Bronze/Silver/Gold/Platinum), earn rules, earn/redeem inside POS checkout, FIFO expiry job, customer Loyalty Dashboard tab, wizard Step 5 goes live.
**Demo:** customer earns points on a sale, redeems on the next, sees balance/tier/expiring-soon on their profile.
Docs: [loyalty](MODULES/loyalty.md).

### Phase 6 — Dashboard + exports + notifications (weeks 17–19)
All 13 KPI widgets with exact formulas and branch-scoped access, DataTable exports (csv/xlsx/pdf with Arabic font), notification jobs (SES email; SMS via chosen vendor; appointment reminders hourly scan). WhatsApp template submission should already be in flight (weeks of approval lead time).
**Demo:** Super Admin sees network-wide KPIs, Branch Manager sees only assigned branches; export any list; booking confirmation message delivered.
Docs: [dashboard](MODULES/dashboard.md), [notifications](MODULES/notifications.md).

### Phase 7 — Inventory screens, settings, staff config (weeks 20–22)
Inventory list/add-item/item-details with manual stock adjustments and transfers, settings pages (general, company info, loyalty settings, notification toggles). **Staff management — built ahead of schedule:** 4-step Add/Edit Staff wizard (Basic Profile, Employment, Salary & Commission with allowances/statutory deductions, System Access), a tenant-configurable **Settings › Payroll Components** catalog backing it, live per-field validation and tenant-wide username/email uniqueness checks, branch-driven currency, and a Reset Password action (revokes sessions) — see [staff](MODULES/staff.md). **Still pending for this phase:** View Staff Profile screen, Staff Performance screen, and Salary History (append-only revisions). **Attendance + Leave capture — also built ahead of schedule:** self check-in/out, Today/Monthly views, session edit dialog, leave requests/approval, second-level approval, supporting documents, half-day requests, and a nightly leave-accrual job are all live — see [attendance](MODULES/attendance.md), [leave](MODULES/leave.md), and [leave-settings](MODULES/leave-settings.md) — resolving staff.md's former open question, and no longer blocking payroll's absence-deduction calc below (it has landed).
**Demo:** full back-office loop — add an item, adjust stock, watch low-stock alert appear on the dashboard; onboard a staff member with full HR profile, salary/commission config, and login access, check in/out, mark today's attendance, see Present Today / On Leave KPIs update, and file/approve a leave request (**already demoable today** — see [attendance](MODULES/attendance.md)/[leave](MODULES/leave.md)/[leave-settings](MODULES/leave-settings.md)).
Docs: [inventory](MODULES/inventory.md), [settings](MODULES/settings.md), [staff](MODULES/staff.md), [attendance](MODULES/attendance.md), [leave](MODULES/leave.md), [leave-settings](MODULES/leave-settings.md).

## Explicit deferrals (post-MVP; design-app.md §9)

Schema is shaped so these bolt on without migration surgery — do not build them in MVP, do not block MVP on their open questions:

1. ~~**Payroll runs / payslips**~~ — **NOW IN SCOPE (2026 req).** The requirement doc specs a full payroll module (per-branch monthly runs, Generated→Pending→Approved/Rejected→Paid, Net Pay = Base + Allowances + Commission − Deductions, payslips, reports). Consumes staff salary structures, attendance/leave deductions, and POS/appointment commissions; writes Payroll Expenses to finance. Payroll itself shipped as v1 by deliberately deferring Commission and Absence Deduction (see [payroll](MODULES/payroll.md) "Deferred v1 scope") since neither POS nor Attendance existed yet. Attendance/Leave are now built ([attendance](MODULES/attendance.md), [leave](MODULES/leave.md), [leave-settings](MODULES/leave-settings.md)) — payroll's absence-deduction/unpaid-leave proration reintroduction (documented in payroll.md) has landed. POS commissions remain unbuilt and still block that half.
2. **Full finance** — AR/AP aging, reconciliation, formal Branch P&L reports. MVP has only the unified `finance_transactions` ledger written by POS. *(Payroll Expenses now has a concrete upstream — the payroll module above.)*
3. ~~**Procurement chain (PR → PO → GRN)**~~ — **NOW IN SCOPE (2026 req).** The requirement doc presents the full PR → Approval → PO → GRN → Inventory-update chain and lists Goods-Receipt as a live stock-increase source. Manual stock adjustments in [inventory](MODULES/inventory.md) remain the fallback until the chain ships. See [procurement](MODULES/procurement.md).
4. **Stock transfer approvals** — direct transfers only in MVP.
5. ~~**Custom role builder UI**~~ — **NOW BUILT.** `Settings > Roles & Permissions` lets a Super Admin create/rename/delete roles and toggle their permission keys; every seeded role except Super Admin itself is fully editable. See [RBAC.md](RBAC.md) and `docs/MODULES/settings.md`'s "Roles & Permissions" section.
6. **WhatsApp channel** — deferred, but start template approval early (weeks of lead time).
7. **Promotions beyond percent/fixed discount codes** — no campaign engine in MVP.
8. **EKS migration** — launch on ECS Fargate.
9. **Mobile `api-client` package** — OpenAPI-generated client comes with the mobile app, later.
10. **Tenant onboarding surface (platform admin or invite-based)** — decided 2026-07: NOT in MVP, not even a CLI. `TenantsService.provisionTenant()` (used by seed + tests) stays the only path; MVP tenants are provisioned by hand. The future surface needs a platform-level authz design first (all current auth is within-tenant). Pairs with the invite/social-sign-in design note in [auth](MODULES/auth.md).
11. **Pricing, plans & subscription billing** — decided 2026-07: post-MVP. No plan/subscription tables, no metering, no payment provider integration in v1; `tenants.status` (active/suspended) is the only lever. Design billing together with #10 — the tenant-onboarding flow is where a plan gets chosen.

Also not modelled in v1 (surfaced by module docs; treat as future scope until decided): customer wallet (Top-Up/Deposit transaction types), customer ratings source. **Memberships/packages** are now flagged for scope: the 2026 req promotes them to in-scope POS cart categories ([pos](MODULES/pos.md)) — confirm the membership/package data model and how it intersects the loyalty engine ([loyalty](MODULES/loyalty.md)) before Phase 4/5.

Attendance (decided 2026-07): **basic capture is IN scope** as part of Phase 7, and is now built. Ownership moved from a `staff_attendance` table inside the staff module to two dedicated modules — [attendance](MODULES/attendance.md) (self check-in/check-out, sessions, Today/Monthly views) and [leave](MODULES/leave.md) (requests, approval, balances), backed by a tenant-configurable catalog in [leave-settings](MODULES/leave-settings.md) — per the 2026 Claude Design prototype. Payroll-grade processing (absence deduction, unpaid-leave proration) now feeds the in-scope payroll module (deferral #1, above) and has landed.

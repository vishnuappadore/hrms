# Keystone HR — Salon Management SaaS

Multi-tenant B2B SaaS for salon chains (corporate + franchise branches; one franchise owner can hold many branches). Launch market is Oman/GCC — **bilingual English/Arabic with full RTL** — but the product must stay geography-neutral: see `docs/GLOBALIZATION.md` before hard-coding anything market-specific.

## Read this first
- `docs/ARCHITECTURE.md` — the master design doc (locked decisions, request lifecycle, risks)
- `docs/ROADMAP.md` — what to build next and what is deliberately deferred
- `docs/MODULES/<module>.md` — distilled product requirements per module (the 78-page client PDF is fully captured there; never ask for the PDF)
- `docs/GIT-WORKFLOW.md` — trunk-based flow: NEVER commit directly to `main`; branch `<type>/<module>-<desc>` → PR → squash-merge. Commit style: `<module>: <imperative summary>`.

## Layout
| Path | What | Own CLAUDE.md |
|---|---|---|
| `apps/api` | NestJS API (also the BullMQ worker via `dist/worker.js`) | ✅ |
| `apps/web` | Next.js 15 App Router (BFF for cookies/proxy) | ✅ |
| `packages/shared` | zod schemas, enums, permission catalog, money helpers — the contract layer | ✅ |
| `packages/config` | tsconfig/eslint/prettier presets | — |
| `infra` | Terraform (designed, NOT yet applied to AWS) | ✅ |
| `docs` | architecture + module requirement docs | — |

## Commands
```bash
docker compose up -d            # postgres:16 (+ hayryou_app role), redis, mailpit, minio
pnpm install
pnpm db:migrate                 # prisma migrate deploy (owner connection)
pnpm db:seed                    # demo tenant — login admin@demo.hayryou / Admin@12345
pnpm dev                        # api :4000 (+ swagger at /api/docs), web :3000
pnpm lint && pnpm typecheck && pnpm test
pnpm test:integration           # needs docker services; includes the RLS isolation suite
```
pnpm may live at `~/Library/pnpm/pnpm` if not on PATH.

## Non-negotiable invariants
1. **Tenant isolation**: every tenant table has `tenant_id` + RLS (ENABLE **and** FORCE) + the `tenant_isolation` policy. Runtime connects as non-owner `hayryou_app`; migrations as `hayryou_migrator`. All queries go through `PrismaService.client` / `withTenantTx()` — never a raw PrismaClient. `AuthPrismaService` (RLS bypass) is allowed ONLY in auth/tenants/seed/tests. Details: `docs/MULTI-TENANCY.md`.
2. **Money is integer minor units + ISO 4217 currency** (`BIGINT`; exponent per currency — OMR=3, USD=2). All arithmetic via `packages/shared/src/money.ts`. Never floats, never per-line ad-hoc rounding, never mixed currencies in one calculation. Currency flows tenant default → branch → financial rows.
3. **RTL**: Tailwind logical properties only (`ms- me- ps- pe- text-start border-e`…). `scripts/check-rtl.mjs` (part of `pnpm lint`) fails the build on `ml-/mr-/pl-/pr-`. Every new screen gets checked in Arabic.
4. **API contract**: zod schema in `packages/shared` first → `createZodDto` in the API → same schema in web forms. Errors return stable `code`s from `ERROR_CODES`; clients never match on message text.
5. **Permissions**: keys live in `packages/shared/src/permissions.ts` (no DB catalog). Guards: `@Permissions(...)`, `@BranchScoped(...)`; list queries use `getEffectiveBranchIds()`. Details: `docs/RBAC.md`.
6. **DB migrations**: expand → migrate → contract; never rename/drop in one step (rolling deploys run old+new code simultaneously). New tenant tables MUST add RLS in the same migration (see `apps/api/prisma/rls.sql` pattern) — the integration suite fails otherwise.

## Current status (foundation + admin onboarding slice)
Built:
- **Foundation**: monorepo, auth (JWT + rotation), tenancy/RLS + tests, RBAC guards, audit service, BFF proxy, worker skeleton, CI, Terraform (unapplied).
- **Branches** (the reference module pattern): full API (CRUD + `/branches/stats` + `/franchise-owners`) AND web screens — list with KPI cards/filters, sectioned create/edit form with conditional franchise section.
- **User management** (`/staff` screens + `/users` API): create/edit users with role + branch assignment, admin password reset (revokes sessions), activate/deactivate, `GET /roles`. Self-lockout guard, stable conflict codes. List view shows avatar + mobile sub-line and a branch filter; edit form has clickable stepper tabs and jumps to the offending step on a validation error (previously failed silently). Gated on `staff.view`/`staff.create`/`staff.update`/`staff.employment.manage` (renamed from `users.view`/`users.manage` so the Roles & Permissions UI's "Staff" section actually controls them); the list/detail endpoints branch-scope via `getEffectiveBranchIds()`. Full staff HR profile stays Phase 7.
- **Services catalog** (`/settings/services` + `/services` API): list with category chips/search, create/edit form, category management dialog — gated on `services.view`/`services.manage`.
- **Customers** (`/customers` screens + `/customers` API): list with tier-colored badges (platinum/gold/silver/bronze/new) and a tier filter, three row actions (View/Sell/Edit). Add/Edit/View all open the same slide-in `Drawer` (not separate pages) — View shows the full profile (stats + appointment-history empty state), Edit reuses the same form, and "Sell" hands off to POS with the customer pre-selected. Mobile has a country-code + local-number picker (defaults from the tenant's currency, pure UX — validation stays the shared country-agnostic `MobileSchema`); both mobile and email are unique per tenant when provided (`CUSTOMER_MOBILE_EXISTS` / `CUSTOMER_EMAIL_EXISTS`); name requires 2+ characters.
- **Appointments** (`/appointments` screens + `/appointments` API): Calendar (Day/Week/Month; Day is a barber × time-slot grid with calendar-style overlap column-packing)/Kanban/List views, and a 4-step booking wizard that also drives Edit (barber/services/schedule, via `PATCH /appointments/:id`, blocked once past `waiting`/`confirmed` — `APPOINTMENT_NOT_EDITABLE`). Add/View/Edit all share one slide-in `Drawer` (`appointment-drawer.tsx`), mirroring Walk-in Queue; the List's row action is an Eye icon (not a text link), and Calendar/Kanban/List all show the same status `Badge`. The page header has a subtitle plus, in Calendar view, the Day/Week/Month mode switch; the filter row is right-aligned with the Calendar date nav or, for List/Kanban, a date-range picker defaulting to today (List/Kanban were previously all-time/unbounded — Kanban silently capped at 100 records). Kanban supports drag-and-drop status moves (`@dnd-kit/core`, the app's first DnD feature), reusing the same permission/transition rules as the Details drawer's action buttons, with invalid drop targets visually disabled while dragging. Status-transition actions (Confirm/Start/Complete/Cancel) and Edit are gated on the matching permission (`appointments.update`/`appointments.checkin`/`appointments.cancel`).
- **POS / Checkout** (`/pos` screens + `/pos` API): cart (services + products), manual discount, split payment, checkout gated on `pos.use`. Hands off from Appointments (`?appointmentId=`), Customers (`?customerId=`), and Walk-in Queue (`?walkInId=`), pre-selecting the customer/cart. Known gap: `pos.discount.manual`/`pos.refund` are catalog keys with no enforcing endpoint yet — the discount field is intentionally left ungated client-side too, since hiding it for some roles while the server accepts it from anyone would be worse than consistent non-enforcement.
- **Walk-in Queue** (`/queue` screens + `/walk-ins` API): registers walk-in customers (optional mobile → link-or-create a Customer, auto; or stays anonymous), List + Board views over the same waiting/serving/completed/cancelled data, inline barber reassignment, Start/Cancel/Complete actions, and a "Checkout" handoff into POS as its third checkout entry point (marks the entry Completed + links the invoice on successful payment). Add Walk-in reuses the Customers module's slide-in `Drawer` and the Appointments wizard's service-card picker; the same `Drawer` also has a "view" mode (an Eye action on every List row/Board card) showing a full details panel — inline barber reassignment and the same status actions work directly from there, plus a gated Edit flips to a form reusing Add Walk-in's own fields to edit customerName/mobileNumber/serviceIds via `PATCH /walk-ins/:walkInId` (blocked once completed/cancelled — `WALKIN_NOT_EDITABLE`). List/Board/details-view actions share one compact labeled-pill button style. Gated on `walkin.view`/`walkin.create`/`walkin.update`/`walkin.cancel`/`walkin.checkin`. See `docs/MODULES/pos.md` Part B.
- **Attendance** (`/attendance` screens + `/attendance` API): self check-in/check-out, Today and Monthly views, per-day session edit dialog, per-staff monthly daily log, and a Dashboard "My Panel" widget. All check-in/out times display in the viewer's local timezone (DB stores true UTC instants). Export is not yet wired (permission key reserved). See `docs/MODULES/attendance.md`.
- **Leave** (`/leave` screens + `/leave` API, plus `Settings > Leave Settings`): approval console, Request Leave dialog (self-service and admin-on-behalf-of), second-level approval, supporting-document upload, half-day requests, self-service withdraw, a nightly leave-accrual job, and action toasts throughout. The request reason is mandatory. See `docs/MODULES/leave.md` and `docs/MODULES/leave-settings.md`.
- **Payroll** (`/payroll` screens + `/payroll` API): generate a run per branch+month, 3-tab listing (Pending/Approved/Rejected) with Batch/List views (Approved/Rejected default to List), a redesigned payslip dialog (avatar/role/branch/DOJ header, kebab menu for Edit/Recompute/Download PDF) with editable allowance/deduction overrides + ad-hoc rows, bilingual PDF export (headless Chromium), individual + bulk approve/reject, mark paid, revert. Percentage-basis components recompute live from the staff member's current base salary. Commission remains deferred; Absence/Leave Deduction now land now that Attendance/Leave are built — see `docs/MODULES/payroll.md`.
- **Roles & Permissions** (`Settings > Roles & Permissions` + `/roles` API): create/rename/delete roles and toggle their permission sets against the real `module.action` catalog (`packages/shared/src/permissions.ts`), grouped by module in the UI with a Select All/Clear All toggle per module. Every role — including the 6 non-Super-Admin seeded roles — is fully editable/deletable; only Super Admin is locked, and a role held by any staff member can't be deleted until reassigned. Previously deferred (`docs/ROADMAP.md` deferral #5) — see `docs/RBAC.md`. Permission-based UI hiding (`usePermissions()`, `apps/web/src/lib/permissions.ts`) is now wired into every built module's nav, buttons, and action menus — the API's own `@Permissions()` guards remain the actual enforcement; client-side checks are convenience only.
- **Company Info** (`Settings > Company Info` + `/settings/company` API): tenant profile — name, logo,
  contact phone/email, address, tax/VAT number, commercial registration number — stored as nullable
  columns directly on `tenants` (no separate `tenant_settings` table needed yet). Logo upload reuses
  Leave's presigned-upload pattern (`StorageService`, MinIO/S3). Links out to General Settings for
  regional defaults (moved there — see below). Gated on `settings.company.manage` (Super Admin,
  Operations Manager); existing tenants backfilled the new permission via a data migration. The
  second of the 2026 client req's four confirmed Settings entries to land (after Services &
  Pricing/Roles & Permissions); Loyalty remains deferred. See `docs/MODULES/settings.md`.
- **General Settings** (`Settings > General Settings` + `/settings/general` API): tenant-wide
  regional defaults and display preferences — `defaultLocale`/`timezone`/`defaultCurrency`
  (promoted from Company Info's former read-only block) plus two new fields,
  `useWesternNumeralsInArabic` (wired into `money.ts`'s payslip-PDF formatting) and
  `weekStartsOn` (wired into the Appointments calendar, previously hardcoded Sunday-start).
  `defaultCurrency` is locked once the tenant has any branch (`TENANT_CURRENCY_LOCKED`) to avoid
  the mixed-currency state `docs/GLOBALIZATION.md` flags as unsupported. A literal date-format
  preference is explicitly deferred — no such mechanism exists anywhere in the app yet. Gated on
  `settings.general.manage` (Super Admin, Operations Manager). Not part of the 2026 req's four
  confirmed entries, but was already a thin prior-doc spec and the natural owner of Company Info's
  forward-referenced "future General Settings" fields. See `docs/MODULES/settings.md`.
- **Dashboard** (`/dashboard` + `GET /dashboard` API): 11 of the 13 spec'd KPIs with real data —
  Revenue Today/Month (+ vs-prior-period %), Appointments Today, Walk-ins, Revenue Overview trend
  chart (Recharts — the app's first charting library), Top Branches, Sales by Payment Method, Top
  Services, Low Stock Alerts, Recent Appointments, Today's Summary. Active Members and Loyalty
  Redeemed render the existing `KpiCard` empty-state (no Loyalty module/table exists at all).
  Revenue reads the previously write-only `finance_transactions` ledger for the first time, and
  reports every money figure grouped by currency (`MoneyByCurrency[]`) rather than a blended
  number — `Branch.currency` isn't schema-constrained to the tenant default, and
  `docs/GLOBALIZATION.md` defers cross-currency consolidated reporting. Every section is
  independently gated by its own matching permission (server-side omission, not just client-side
  hiding) via `DASHBOARD_SECTION_PERMISSIONS`; `dashboard.view` itself was backfilled onto the 3
  roles that previously lacked it (Receptionist/Barber/Cashier) so no role gets an empty page.
  The existing self-service "My Panel" attendance/leave widget is unchanged. See
  `docs/MODULES/dashboard.md`.
- **Web foundation**: light/dark theming with semantic tokens + two brand palettes (green default, champagne-gold via `data-brand="gold"`), deep-green sidebar shell with active nav states, self-hosted fonts (Inter + IBM Plex Sans Arabic), lucide icons, shared DataTable + ui primitives (including `ToastProvider`/`useToast`, `BoxedToggle`, `DropdownMenu`) + react-hook-form pattern on shared zod schemas. See `apps/web/CLAUDE.md`.

Not built yet: Loyalty, Inventory screens, Reports — see `docs/ROADMAP.md` for phasing. Copy the branches module pattern (API) and the branches/staff screens (web) when adding a module.

## Machine quirks & dev troubleshooting
`docs/DEVELOPMENT.md` — REQUIRED reading before installing packages or adding fonts on this machine (broken-IPv6 workaround for pnpm; `next/font/local` only), plus test-harness and git-workflow gotchas.

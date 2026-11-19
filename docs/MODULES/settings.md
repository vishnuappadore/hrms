# Settings

```
status: planned, except Payroll Components (built — GET,PUT /payroll-components + Settings screen; see [[staff]]),
Roles & Permissions (built — see docs/RBAC.md), Company Info (built — GET,PATCH /settings/company +
POST /settings/company/logo-upload-url + Settings screen), and General Settings (built —
GET,PATCH /settings/general + Settings screen)
```

## Purpose

Central administration area for system-wide configuration, access control, business rules, integrations, and preferences. Bilingual EN + AR (RTL). Settings is the umbrella that hosts the tenant's master configuration; individual areas are permission-gated per section.

## Primary users / permissions

Super Admin (full), Operations/Management (subset). Settings access is permission-gated per section (e.g., `settings.company.manage`, `settings.roles.manage`, `settings.loyalty.manage`). Guards via `@Permissions(...)` on keys from `packages/shared/src/permissions.ts` (code is the source of truth — no DB permission catalog).

## Settings tree

### 2026 client req (reaffirmed)

The 2026 requirement doc reduces the Settings navigation to **four** entries:

```
⚙️ Settings
├── Services & Pricing   → see [[services]] (extracted to its own module doc)
├── Payroll Components    (new — not in the 2026 req's 4-entry list, added to back the Staff module's Salary & Commission step)
├── Company Info
├── Roles & Permissions
└── Loyalty
```

The req supplies field-level detail only for **Services & Pricing**. `Company Info`, `Roles & Permissions`, and `Loyalty` appear as headers with no field spec in this section — their detail lives in their own docs (`[[services]]` for Services & Pricing; Roles & Permissions here + `docs/RBAC.md`; Loyalty in `[[loyalty]]`). **Payroll Components** is not part of the reaffirmed 4-entry list — it was added because the Staff module's Add Staff mockups reference allowance/deduction types "configured in Settings › Payroll Components"; detail below and in [[staff]].

### Prior doc tree (~14 sections)

The pre-2026 doc specced a much larger tree. These are **not deleted** — they are retained below and flagged under "❓ Open questions" pending client confirmation that the reduced req tree is a focused excerpt rather than a de-scope:

```
Settings
├── General Settings
├── Company Information
├── Roles & Permissions
├── Services Configuration     → extracted to [[services]]
├── Loyalty Settings
├── Appointment Settings
├── Inventory Settings
├── Procurement Settings
├── Finance Settings
├── Notifications
├── Integrations
├── Audit Logs
├── System Preferences
└── Backup & Security
```

## Sections

1. **General Settings — BUILT.** Tenant-wide regional defaults and display preferences, promoted
   from Company Info's former read-only "Regional defaults" block: `defaultLocale` (en/ar),
   `timezone` (IANA), `defaultCurrency` (ISO 4217) — all pre-existing `Tenant` columns — plus two
   new columns, `use_western_numerals_in_arabic` (boolean, default `true`) and `week_starts_on`
   (one of `packages/shared/src/schemas/branch.ts`'s `WEEKDAYS`, default `sunday`). Business
   rules: `defaultCurrency` is **locked once the tenant has ≥1 branch** (`TENANT_CURRENCY_LOCKED`)
   — branches inherit it at creation time, and allowing a later change risks the mixed-currency
   state `docs/GLOBALIZATION.md` says to avoid; `defaultLocale` has no runtime enforcement yet (the
   active UI locale is purely a per-user URL/cookie choice — wiring a tenant-wide default would
   mean touching auth/middleware, out of scope here). `useWesternNumeralsInArabic` is wired into
   `money.ts`'s `formatMoney` (threaded through the payslip PDF — the only server-rendered,
   reconciliation-sensitive money output today; not threaded through the ~25 web-UI display call
   sites, which is cosmetic-only and disproportionate scope for this pass). `weekStartsOn` is
   wired into the Appointments calendar's `startOfWeek()` (was hardcoded Sunday-start). Gated on
   `settings.company.manage`'s sibling key `settings.general.manage` (Super Admin, Operations
   Manager). `apps/web/.../settings/general/`, `apps/api/src/modules/settings/general.*`.
   **A literal "date format" preference (e.g. DD/MM/YYYY vs MM/DD/YYYY) is explicitly deferred** —
   no such mechanism exists anywhere in the app today (date/time display is ~15+ components each
   hardcoding their own `Intl.DateTimeFormat` options keyed only on the en/ar locale); wiring one
   in would mean touching all of them, out of proportion for this pass.
2. **Company Information / Company Info — BUILT.** Tenant profile: name, logo, contact phone/email,
   address, and tax/VAT + commercial registration numbers, stored directly on `tenants`
   (`contact_phone`, `contact_email`, `address`, `tax_number`, `commercial_registration_no`,
   `logo_key` — nullable, additive columns; no separate `tenant_settings` JSONB table was needed for
   this). Logo upload reuses Leave's presigned-upload pattern (`StorageService` /
   `POST /settings/company/logo-upload-url`). Screen also shows `defaultCurrency`/`timezone`/
   `defaultLocale` read-only ("Regional defaults") — editing those belongs to the still-unbuilt
   General Settings, and currency in particular isn't safely editable once financial rows exist.
   Gated on `settings.company.manage` (Super Admin, Operations Manager).
   `apps/web/.../settings/company/`, `apps/api/src/modules/settings/company.*`.
   *(Reaffirmed in 2026 req as "Company Info" — header only, no field spec provided; fields above
   are carried from the prior doc / inferred.)*
3. **Roles & Permissions** — see below. *(Reaffirmed in 2026 req — header only.)*
4. **Services & Pricing** — **extracted to its own doc: [[services]].** The 2026 req promotes the service catalogue to a first-class Settings entry ("Services & Pricing") with View / Add / Edit service flows (name, duration, price). The previously-assumed richer service model (categories, EN/AR names, buffer time, per-branch price override, consumable/product mapping, staff↔service capability) is **not** in the 2026 req's flat name/duration/price model; that reconciliation and its open questions are owned by [[services]]. See there for the current spec. *(This doc no longer carries the services model — only the pointer.)*
5. **Loyalty Settings / Loyalty** — earn rules (baisa per point), tier thresholds/multipliers, expiry months, redemption rate, activity period for Active Member. *(Reaffirmed in 2026 req as "Loyalty" — header only; detail in [[loyalty]].)*
6. **Payroll Components** — tenant-configurable catalog of salary **Allowance types** and **Deduction types**, each with a bilingual name and a **basis**: a fixed amount in the tenant currency, or a percentage of base salary (e.g. Social Insurance/PASI defaults to 7%). Screen is two sections (Allowance types / Deduction types), each an inline-editable table — add/edit/remove rows freely, then a single **Save Changes** per section commits the whole set in one bulk request (rows omitted from the save are deactivated, never hard-deleted, so existing staff references stay valid). Each row has a **Fixed / %** toggle button that sets its basis (labeled "Fixed", not a currency code, to avoid reading like a value field). A **Back to settings** link returns to the main Settings page. Feeds the dropdowns in [[staff]]'s Add Staff Salary & Commission step. *(Not in the 2026 client req; added to support the Staff module's mockups — see [[staff]].)*
7. **Appointment Settings** — booking rules: slot granularity, buffers, source list, reminder timing, no-show handling. *(Not reaffirmed in 2026 req — see open questions.)*
8. **Inventory Settings** — categories, units, default tax %, low-stock digest configuration. *(Not reaffirmed in 2026 req — see open questions.)*
9. **Procurement Settings** — approval rules, priorities (deferred with procurement chain). *(Not reaffirmed in 2026 req — see open questions.)*
10. **Finance Settings** — expense categories, VAT defaults (deferred with full finance). *(Not reaffirmed in 2026 req — see open questions.)*
11. **Notifications** — channel enablement (SMS/Email/WhatsApp), templates per `template_key`, per-event toggles. *(In scope — [[notifications]] is a confirmed requirement; the 2026 req excerpt just omits it. Retained.)*
12. **Integrations** — provider credentials: SMS/WhatsApp (Unifonic or Twilio), email (SES), future payment gateways. *(Retained — required to support [[notifications]].)*
13. **Audit Logs** — searchable viewer over `audit_logs` (action, entity, before/after, user, IP; monthly partitions, 24-month retention). *(Not reaffirmed in 2026 req — see open questions.)*
14. **System Preferences** — per-tenant UI/behaviour preferences. *(Not reaffirmed in 2026 req — see open questions.)*
15. **Backup & Security** — password policy, session/refresh-token controls, backup visibility. *(Not reaffirmed in 2026 req — see open questions.)*

## Screens & flows

### Services & Pricing (2026 req — spec owned by [[services]])

The req details this area; the full spec (Services List, Add Service dialog, Edit Service dialog, functional behaviour, business rules, module integration) lives in [[services]]. Summary of what the req states, for cross-reference:

- **Services List** — one row per service: Service Name, Duration, Price (OMR), Actions (View / Edit). The listed price is the default selling price in Appointments, Walk-in Queue, and POS / Checkout.
- **Add Service** — `+ Add Service` opens a dialog with fields **Service Name, Duration, Price**, plus **Save / Close**. On Save: validate → create → save to Service Master → refresh list → immediately available in operational modules.
- **Edit Service** — Edit icon opens the same dialog pre-populated; Save Changes updates the Service Master; changes are immediately available application-wide.
- **Business rules (req):** Service Name mandatory and unique within the salon; all mandatory fields required before save; Close exits without saving; updates do **not** modify historical appointments / walk-in / sales records already completed. Price is stored as integer minor units (OMR exponent = 3) per the money invariant.

### Roles & Permissions — BUILT

- **Roles list** (`Settings > Roles & Permissions`, `apps/web/.../settings/roles/`) — system-seeded roles per tenant: Super Admin, Operations Manager, Branch Manager, Receptionist, Barber, Cashier, Accountant (`roles.is_system = true`), plus tenant-created roles. Each row shows its staff count and Edit/Delete/Permission-setup actions (`GET /roles/summaries`, `roles.manage`).
- **Role editor** — a dialog grouping the flat permission catalog (`module.action`, `packages/shared/src/permissions.ts` — code is the source of truth, no permissions table) by module, one checkbox per real key (no uniform Create/View/Edit/Delete columns — each module's keys are whatever shape they actually are), plus a Select All/Clear All toggle per module group. Saving (`PATCH /roles/:id`) busts the in-process permission cache immediately (see `docs/RBAC.md`).
- **Edit/delete rule**: every role — including the other 6 seeded system roles — can be renamed, have its permissions edited, and be deleted. Only **Super Admin** (`roles.is_super_admin = true`) is locked (no edit, no delete). A role currently assigned to any staff member can't be deleted until reassigned (`ROLE_IN_USE`).
- **Users screen** (shown alongside Roles & Permissions) — assign role + branch assignments per user (`all_branches` flag or explicit `user_branch_assignments`), enable/disable login, reset password.

## Business rules

- Settings persist in `tenant_settings` (key/value JSONB) unless a first-class table exists (roles, loyalty earn rules, services).
- Branch-level feature toggles (online booking, walk-ins, loyalty, product sales) live on the branch, not global settings (see `branches.md`).
- All settings writes are audited.
- Service edits do not rewrite completed historical records (req) — historical immutability is preserved at the transaction level, not by mutating Service Master.

## Data-model touchpoints

`tenant_settings` (key/value JSONB), `roles` + `role_permissions` (permission_key strings), `users`, `user_branch_assignments`, service tables (owned by [[services]]), `loyalty_earn_rules` (Loyalty), notification template config, `audit_logs`. All tenant tables carry `tenant_id` + RLS (ENABLE + FORCE + `tenant_isolation` policy); runtime connects as `hayryou_app` via `PrismaService.client` / `withTenantTx()`.

## Engineering notes

- **Tenant isolation**: every settings-related tenant table has `tenant_id` + RLS; new tenant tables add RLS in the same migration.
- **Money**: service Price and all monetary settings stored as integer minor units + ISO 4217 currency (OMR exponent = 3); arithmetic via `packages/shared/src/money.ts`. Never floats.
- **API contract**: zod schema in `packages/shared` first → `createZodDto` in API → same schema in web forms; stable `code`s from `ERROR_CODES` (e.g., service-name uniqueness conflict).
- **Permissions**: section access gated by keys in `packages/shared/src/permissions.ts`; guards `@Permissions`, `@BranchScoped`, `getEffectiveBranchIds()`.
- **RTL / bilingual**: Tailwind logical properties only; every settings screen checked in Arabic. Company Info / service names may need EN/AR pairs (open question — see [[services]] for service name EN/AR).
- **Migrations**: expand → migrate → contract.

## ⚠️ Changed in this revision

- **Settings tree reduced from ~14 sections to 4.** The 2026 req's Settings navigation lists only **Services & Pricing, Company Info, Roles & Permissions, Loyalty**. The prior ~14-section tree is retained but no longer matches the req (see open questions).
- **"Services Configuration" renamed to "Services & Pricing" and extracted to [[services]].** This doc no longer carries the service data model; it holds only a pointer.
- **Service model simplified in the req** to a flat **Service Name / Duration / Price** (View / Add / Edit). The prior doc's richer model (categories, EN/AR names, buffer, per-branch price override, consumable mapping, staff capability) is not present in the req — its reconciliation and open questions are owned by [[services]].
- **Company Info, Roles & Permissions, Loyalty confirmed still in scope** (reaffirmed as headers), but the req provides no new field-level detail for them.
- **New req business rule captured**: editing a service does not modify already-completed historical appointment/walk-in/sales records.

## ❓ Open questions / needs client confirmation

- **The 2026 client req is a partial excerpt, not a de-scope list** (confirmed: [[notifications]] is silent in the req yet remains a firm requirement). So the reduced 4-item tree it shows (Services & Pricing, Company Info, Roles & Permissions, Loyalty) does **not** remove the other sections — they are retained.
- **Notifications** and **Integrations** are **confirmed in scope and retained** (they back [[notifications]]). Still open only: define the credential storage strategy for Integrations (SMS/WhatsApp — Unifonic/Twilio; email — SES): encrypted at rest, masked display.
- **~7 other prior settings sections not restated in the excerpt** — **Appointment, Inventory, Procurement, Finance, Audit Logs, System Preferences, Backup & Security** — treated as retained pending confirmation; field-level specs still to be authored. (General Settings is no longer in this list — built; see section 1.)
- **Company Info fields** (name, logo, contact, VAT/CR) are carried from the prior doc / inferred — the req gives only the header. Confirm the field list, and whether EN/AR pairs are needed for company/legal fields on printed documents.
- **Field-level specs** for every retained non-req section are absent — each needs a mini-spec before build.
- **Backup & Security scope**: is tenant-visible backup/restore actually required, or is this operational (infra) only?
- **Branch-overridable vs tenant-global**: which settings can be overridden per branch (e.g., appointment slot rules, service price) vs tenant-global? The req's flat service Price implies a single global price (no per-branch override) — confirm against the prior doc's per-branch price override (now tracked in [[services]]).

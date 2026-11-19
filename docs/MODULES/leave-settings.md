# Leave Settings

```
status: BUILT (v1) — schema + API + web screen implemented
(`Settings > Leave Settings`: `leave-settings-content.tsx`,
`leave-type-dialog.tsx`, `leave-type-status-dialog.tsx`), including the
`requiresSecondApproval` addition below. Lives under the existing Settings
shell, alongside Payroll Components — see [settings](settings.md). Shipped
alongside [leave](leave.md), which depends on this catalog.
```

## Purpose

Tenant-configurable catalog of leave types (Annual, Sick, Emergency, Unpaid,
…) that [leave](leave.md) requests are filed against and [payroll](payroll.md)
reads for unpaid-day proration. Same "catalog vs. instance" split already
used for `PayrollComponent`/`StaffPayrollComponent` — types are configured
once here; individual leave requests/balances reference a type, they don't
duplicate its config.

## Primary users / permissions

`leave.settings.manage` (new permission key). Wired into Super Admin and
Operations Manager only, same tier as `payroll.generate`-adjacent settings
screens — branch-agnostic (a tenant-wide catalog, not per-branch).

## Screen (from the design)

`Settings → Leave Settings` — added to the existing Settings shell's
`SECTIONS` array (`apps/web/.../settings/page.tsx:25-27`, alongside
`services` and `payroll-components`; the other sections visible in the
mockup — Business Profile, Taxes & Currency, Notifications, Preferences —
are pre-existing "coming soon" placeholders in that same array and are not
touched by this work).

One repeatable card per leave type:

- `Name (English)` / `Name (Arabic)` text inputs, delete (×).
- `Paid | Unpaid` badge, `days/yr` number, `From–to: All days | Skip offs`
  (whether the day-count includes or excludes the branch's weekly-off days),
  `Encash: Yes | No` badge.
- Expandable **"Policy & credit"** section: `Credit balance` timing (e.g.
  "Beginning of the year"), `Rate` (days/year), `Minimum notice (days)`,
  `Max days to carry forward`, and four toggles — `Carry forward unused
  balance`, `Allow half-day leave`, `Require supporting document`, `Allow
  negative balance`.
- `+ Add` creates a new blank card; soft-disable (not hard-delete) once a
  type has been used by any `leave_request`/`leave_balance` row — same
  `isActive` convention as `PayrollComponent`.

## Addition beyond the literal screenshot (decided 2026-09)

- **`requiresSecondApproval`** (boolean toggle, default off) — not in the
  mockup's card, added to satisfy the "configurable per leave type" approval
  decision made for [leave](leave.md). See that doc's "Additions beyond the
  literal screenshots" section for the full rationale.

## Data model (built — table already migrated)

- **`leave_types`** — `tenant_id`, `name_en`, `name_ar`, `is_paid`,
  `days_per_year` (Decimal, supports half-day-year policies), `count_mode`
  (`all_days|skip_weekly_off`), `is_encashable`, `credit_policy`
  (`beginning_of_year|monthly|anniversary`), `minimum_notice_days`,
  `max_carry_forward_days`, `allow_carry_forward`, `allow_half_day`,
  `require_supporting_document`, `allow_negative_balance`,
  `requires_second_approval` (see Addition above), `is_active`. `tenant_id` +
  RLS added to `apps/api/prisma/rls.sql` in the same migration, per
  `docs/MULTI-TENANCY.md`. `is_active` soft-disable only — never hard-delete
  a type referenced by existing `leave_requests`/`leave_balances` rows, same
  rule as `PayrollComponent`.

## API (built) — `apps/api/src/modules/settings/leave-types.*`

Registered into the existing `settings.module.ts` alongside
`payroll-components.*`, identical CRUD shape: `GET /settings/leave-types`,
`POST /settings/leave-types`, `PATCH /settings/leave-types/:id` (disables via
`isActive: false` rather than deleting once referenced).

## Web (built)

`apps/web/.../settings/leave-settings/page.tsx` → `leave-settings-content.tsx`,
built the same way `payroll-components-content.tsx` was — same repeatable-
card list, same form pattern (react-hook-form + zod on the shared schema,
same schema imported by both the API DTO and this form).

## Integrations

- **Leave** — every `LeaveRequest`/`LeaveBalance` references a `leave_type_id`
  here; this catalog must exist first. See [leave](leave.md).
- **Payroll** — `is_paid = false` types are what drives the unpaid-day
  proration in payroll.md's Net Pay formula.

## Testing (built)

Covered in `apps/api/test/leave-types.spec.ts`: CRUD + soft-disable-once-
referenced (a type used by any request/balance can't be hard-deleted, only
deactivated), validation of the Policy & credit fields (e.g.
`maxCarryForwardDays` only meaningful when `allowCarryForward` is on),
permission-denied (403) and cross-tenant isolation (404), via
`pnpm test:integration`.

# Attendance

```
status: BUILT (v1) — schema + API + web screens implemented. Self check-in/
check-out, the Today and Monthly views, the per-day session edit dialog, the
per-staff monthly daily log, and the Dashboard "My Panel" widget (screens
1–5 below) are all live, including a fix for an earlier bug where check-in/
check-out times were displayed in UTC instead of the viewer's local time.
Resolves the open question in staff.md §"Attendance & Leave capture" and the
[payroll](payroll.md) "Deferred v1 scope" note on Absence Deduction — see
[leave](leave.md) and [leave-settings](leave-settings.md) for the companion
modules. Not yet built: the Export action (the `attendance.export`
permission key exists but has no UI/endpoint behind it yet).
```

## Purpose

Daily check-in/check-out capture for staff, feeding two consumers: the
Attendance screens themselves (Today live view + Monthly rollup + per-staff
daily log) and [payroll](payroll.md)'s Absence Deduction calculation. Staff
punch their own check-in/check-out; managers/admins can view every branch's
log and correct entries after the fact (edit) or add a manual entry when a
punch was missed. Bilingual EN + AR (RTL); all day/session data keyed to the
branch's local calendar day.

## Primary users / permissions

New permission keys (`packages/shared/src/permissions.ts`, `module.action`
convention): `attendance.mark` (self check-in/out — every staff member, not
gated by a management permission), `attendance.view` (Today/Monthly
screens, branch-scoped via `getEffectiveBranchIds()`), `attendance.edit`
(correct/add an entry on someone else's log), `attendance.export`. Wired into
Super Admin (all), Operations Manager, Branch Manager (branch-scoped); every
staff member gets `attendance.mark` regardless of role for their own record.

## Screens (from the design)

1. **Attendance / Today** (`/attendance`, default view) — `Today | Monthly`
   segmented control; filters (search by name, branch, date, Export); KPI row
   — Present Today, Late, On Leave, Absent, Attendance Rate %; table `STAFF |
   STATUS | CHECK-IN | CHECK-OUT | HOURS` plus a session-count badge/icon that
   opens the check-in/out log dialog. Status badges: Present (green), Late
   (orange), On Leave (blue), Absent (red), Weekly Off (muted, not a staff
   action item).
2. **Attendance / Monthly** — same shell, KPI row becomes Present Days, Late
   Arrivals, Leave Days, Absent Days, Avg Attendance %; table `STAFF |
   PRESENT | LATE | LEAVE | ABSENT | TOTAL HOURS | RATE` with a per-row
   calendar icon opening the per-staff daily breakdown (screen 4 below).
3. **Check-in/out log dialog** — per staff, per day: summary tiles (Sessions,
   First in, Last out, Total worked) and a table of punch pairs (`# |
   CHECK-IN | CHECK-OUT | DURATION | BREAK TIME`, break = the gap between one
   session's check-out and the next session's check-in) plus an **Edit**
   action for admin correction.
4. **Per-staff monthly daily log** — staff header + month; the same summary
   tiles at month grain (Present, Late, Leave, Absent, Total hours, Rate);
   daily table `DATE | DAY | STATUS | CHECK-IN | CHECK-OUT | HOURS`, including
   `Weekly off` rows for the branch's non-working day; a per-day session icon
   re-opens screen 3 for that specific date.
5. **Dashboard "My Panel" widget** (touches the Dashboard module, additive —
   see [staff](staff.md) integration note) — the logged-in staff member's own
   Check-in/Check-out/Worked time, Leave balance, a status pill ("You are not
   checked in yet"), and a **Check In** / **Check Out** button (self-service
   punch, the same endpoint the Today screen reads from).

## Resolved decisions (this revision)

- **Two-day weekend (decided 2026-09).** The mockup shows both Friday *and*
  Saturday as "Weekly off" for the same staff member in one month — matching
  a real GCC 2-day weekend, not mockup polish. **Decision: extend the
  Branches module** — `Branch.workingHours.weeklyOffDay` (single day) is now
  `weeklyOffDays` (array); **done** — see [branches](branches.md)'s changelog
  for the exact touch-points. Attendance reads the array to compute
  `weekly_off` for any day whose weekday is in the branch's list.

## Open questions / needs confirmation

These are not in the mockup and are proposed resolutions, not silent
assumptions — confirm before/while implementing:

- **Late / Absent thresholds** aren't configurable anywhere in the mockup.
  **Proposed v1**: "Late" = check-in after `Branch.workingHours.openingTime`
  + a fixed 15-minute grace period (constant, no new settings screen);
  "Absent" = a working day (not Weekly Off, not an approved leave day) with
  zero sessions by end of day. Flag as a v1 simplification; a per-branch
  grace-period setting can follow later without a data-model change.
- **Manual entry vs. self check-in conflict**: if an admin adds a manual
  session for a day the staff member also self-punched, the day's
  denormalized status/hours are recomputed from the **union** of all
  sessions (self + manual), not one replacing the other; `isManualEntry`
  and `editedByUserId/editedAt` mark provenance for audit only.
- **Holiday calendar**: the `holiday` status value exists in the enum below
  for forward-compatibility but there is no holiday-calendar screen in this
  pass — a day is only ever produced as `present/late/absent/on_leave/
  weekly_off` until a holiday calendar module is scoped. Not building
  `holiday` UI now; the enum value is a placeholder, not a commitment.

## Data model (built — tables already migrated)

Kept separate from `User`/`StaffProfile` the same way `PayrollItem` etc. are
— attendance rows reference `staffProfileId`, never embed into `User`.

- **`attendance_days`** — one row per `(tenant_id, staff_profile_id, date)`.
  `status` (`present|late|absent|on_leave|weekly_off|holiday`), `first_in_at`,
  `last_out_at`, `total_worked_minutes`, `is_manual_entry`, `edited_by_user_id`,
  `edited_at`. Denormalized/recomputed whenever its sessions change — same
  "snapshot, recompute on write, never on read" pattern as `PayrollItem`.
  Unique `(tenant_id, staff_profile_id, date)`.
- **`attendance_sessions`** — one row per punch pair. `attendance_day_id`,
  `check_in_at`, `check_out_at` (nullable while still checked in), `source`
  (`self|manual`), `created_by_user_id`. Break time between consecutive
  sessions is derived at read time, never stored.

Both tables: `tenant_id` + RLS (ENABLE + FORCE + `tenant_isolation` policy)
added to `apps/api/prisma/rls.sql`'s array in the same migration, per
`docs/MULTI-TENANCY.md`'s checklist.

## API (built) — `apps/api/src/modules/attendance/`

Thin controller / all logic in service, same layered pattern as Branches:

- `POST /attendance/check-in`, `POST /attendance/check-out` — self, resolves
  the caller's own `staffProfileId`; no `attendance.edit` required.
- `GET /attendance?scope=today|monthly&date=|month=&branchId=&search=` —
  branch-scoped list for both Today and Monthly views.
- `GET /attendance/:staffProfileId/days/:date` — one day's session log
  (screen 3).
- `PATCH /attendance/:staffProfileId/days/:date` — admin correction (add/
  edit/remove sessions for that day); gated on `attendance.edit`.
- `GET /attendance/:staffProfileId/monthly?month=` — per-staff daily
  breakdown (screen 4).

## Web (built) — `apps/web/src/app/[locale]/(dashboard)/attendance/`

Reuses existing primitives, no new component families: `ui/segmented-
control.tsx` for Today/Monthly; the KPI-card pattern already used on the
Branches list screen; the `data-table.tsx` pager/meta convention (as
`payroll-table.tsx` already borrows it, rather than the full `DataTable`);
`ui/dialog.tsx` for the session-log modal, with an inline-edit toggle on the
Edit action. Sidebar nav entry already exists and 404s today
(`sidebar-nav.tsx:33-34,64-65,97-98`) — this module fills it in.

## Integrations

- **Staff** — attendance rows key off `staffProfileId`; no `StaffProfile`
  schema change. See [staff](staff.md) for the proposed (confirmation-gated)
  "View attendance" quick link.
- **Branches** — reads `Branch.workingHours` (opening time + `weeklyOffDays`
  array, per the confirmed schema change above); Attendance itself has no
  write path into Branch.
- **Leave** — an approved leave day forces `attendance_days.status =
  on_leave` for that date regardless of session data; see [leave](leave.md).
- **Payroll** — `attendance_days.status = absent` count for the payroll month
  feeds the new `absence_deduction_minor` figure; see payroll.md's "Deferred
  v1 scope" section, which already specifies this exact reintroduction.

## Testing (built)

Covered in `apps/api/test/attendance.spec.ts`, mirroring `payroll.spec.ts`'s shape: check-in/check-out
self-service happy path, multi-session same-day punches + derived break time,
admin edit/manual-entry on another staff member's day (permission-gated),
Weekly Off / Absent / Late derivation edge cases (branch opening time,
grace period, zero-session working day), Monthly rollup aggregate correctness,
cross-tenant isolation (404) and permission-denied (403) per new endpoint,
via `pnpm test:integration`.

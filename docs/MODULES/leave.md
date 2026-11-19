# Leave

```
status: BUILT (v1) — schema + API + web screens implemented. The approval
console, the Request Leave dialog (self-service and admin-on-behalf-of),
second-level approval (`requiresSecondApproval`, configured per leave type),
supporting-document upload, half-day requests, self-service withdraw, and a
nightly leave-accrual job are all live and covered by integration tests
(`leave.spec.ts`, `leave-types.spec.ts`, `leave-accrual.spec.ts`). The
`reason` field is mandatory (schema `min(1)`, not optional). Depends on the
leave-type catalog in [leave-settings](leave-settings.md), which shipped
alongside it. Resolves the open question in staff.md §"Attendance & Leave
capture". See [attendance](attendance.md) for check-in/out and
[payroll](payroll.md) for the unpaid-leave payroll effect. Not yet built: a
dedicated balance-detail screen (optional future scope, see screen 3 below).
```

## Purpose

Staff leave requests and their approval, plus the balance staff draw against.
A staff member (or an admin on their behalf) files a request against a
configured leave type; a manager/admin approves or rejects it; approved
requests reduce the staff member's leave balance and mark the covered dates
`on_leave` in [attendance](attendance.md). Bilingual EN + AR (RTL).

## Primary users / permissions

New permission keys: `leave.request` (self, or admin filing on behalf of a
staff member), `leave.view` (approval console, branch-scoped), `leave.approve`
(approve/reject). Wired into Super Admin (all), Operations Manager, Branch
Manager (branch-scoped); every staff member gets `leave.request` for their own
record regardless of role.

## Screens (from the design)

1. **Leave — review and approve staff leave requests** (`/leave`) — KPI row
   (Pending, Approved this Month, On Leave Today, Rejected); tab bar `All |
   Pending | Approved | Rejected`; filters (branch, leave type); table
   `STAFF | TYPE | PERIOD | DAYS | REASON | STATUS | ACTION` with per-row
   **Approve**/**Reject** (only shown for Pending rows).
2. **Request Leave** (not in the screenshots — see "Additions" below) — a
   small dialog: leave type, date range (+ half-day toggle if the type
   allows it), reason, optional supporting-document upload (if the type
   requires it). Reachable from the Dashboard "My Panel" widget (self) and
   a "+ New Request" button on the `/leave` page (admin, on behalf of a
   staff member).
3. **Leave balance** — surfaced today only as the Dashboard "My Panel" figure
   (e.g. "Leave balance · 34 days") and implicitly in the Leave KPI row; no
   dedicated balance-detail screen in the mockup. Adding one is optional
   future scope, not required for v1.

## Additions beyond the literal screenshots (decided 2026-09)

These are confirmed decisions, not open questions — each adds UI/behavior the
design mockup itself doesn't show:

- **No "new request" screen exists in the mockup** — only the approval
  console. **Decision: build the Request Leave dialog** described above to
  close that gap (Dashboard "My Panel" self-service entry point + a
  "+ New Request" button on `/leave` for admin-on-behalf).
- **Second-level approval (decided).** The mockup's approval flow is
  single-step (Approve/Reject, no chain) — but per-leave-type-configurable
  approval levels were chosen. **Decision: add one field**,
  `requiresSecondApproval` (boolean, default off), to the leave type in
  [leave-settings](leave-settings.md), rather than a full multi-stage
  approval-chain UI. When on, an approved request from the first approver
  moves to a `pending_second_approval` sub-state (surfaced as `Pending` in
  the tab bar, distinguished in the detail/API only) before becoming
  `approved`.
- **Leave encashment (decided).** `Encash: Yes/No` on the leave type
  ([leave-settings](leave-settings.md)) implies converting unused balance to
  a payroll payout. **Decision: model the `isEncashable` flag now** so the
  catalog matches the design, but **defer the actual encashment payout
  calculation** to a follow-up phase — same "deliberately deferred,
  documented" pattern [payroll](payroll.md) already uses for Commission. Not
  built this pass.

## Data model (built — tables already migrated)

- **`leave_balances`** — one row per `(tenant_id, staff_profile_id,
  leave_type_id, year)`: `opening_balance`, `accrued`, `used`,
  `carried_forward`, `closing_balance` (Decimal, supports half-days).
  Recomputed from `leave_requests` + the leave type's credit policy; not a
  hand-edited figure in v1.
- **`leave_requests`** — `staff_profile_id`, `leave_type_id`, `branch_id`
  (snapshot at request time), `start_date`, `end_date`, `days_count`
  (Decimal), `reason`, `status` (`pending|approved|rejected|cancelled`, plus
  the internal `pending_second_approval` sub-state above if that field is
  confirmed), `approver_user_id`, `approved_at`, `rejection_reason`,
  `created_by_user_id` (self vs. admin-on-behalf), `attachment_url`
  (nullable, only when the leave type requires a supporting document).

Both tables: `tenant_id` + RLS added to `apps/api/prisma/rls.sql` in the same
migration, per `docs/MULTI-TENANCY.md`.

## API (built) — `apps/api/src/modules/leave/`

- `POST /leave/requests` — self or admin-on-behalf; validates against the
  leave type's `minimumNoticeDays`, `allowHalfDay`, `requireSupportingDocument`,
  and `allowNegativeBalance` (packages/shared `assertLeaveRequest`, same
  cross-field-validation shape as `staff.ts`'s `assertXxx` helpers, reused
  in both the API DTO and the web form).
- `GET /leave/requests?tab=&branchId=&leaveTypeId=&page=&pageSize=` —
  tab-filtered, paginated listing with the same `{ data, meta }` envelope as
  Branches/Staff/Payroll.
- `POST /leave/requests/:id/approve`, `POST /leave/requests/:id/reject` —
  gated on `leave.approve`; approve recomputes the staff member's
  `leave_balances` row and marks the covered dates `on_leave` in
  `attendance_days`.
- `GET /leave/balances/:staffProfileId` — for the Dashboard widget and the
  Request Leave dialog's "days remaining" hint.

## Web (built) — `apps/web/src/app/[locale]/(dashboard)/leave/`

The tab bar reuses the exact hand-rolled pattern from
`payroll-content.tsx:345-368` (no shadcn `Tabs` in this repo). No bulk
selection in the mockup — Approve/Reject stay per-row for v1; the payroll
module's bulk-selection idiom (`selectedIds` + `selectAllMode`) is a
straightforward future add if volume warrants it, not built now. Sidebar nav
entry already exists and 404s today (`sidebar-nav.tsx:33-34,64-65,97-98`).

## Integrations

- **Leave Settings** — the leave-type catalog this module reads; must ship
  first (or in the same PR) since a `LeaveRequest` can't exist without a
  `LeaveType`. See [leave-settings](leave-settings.md).
- **Attendance** — an approved leave request stamps `attendance_days.status
  = on_leave` for its date range; see [attendance](attendance.md).
- **Payroll** — an approved request against an **unpaid** leave type reduces
  `paidDays` for the payroll month exactly like the existing Date-of-Join
  proration; see payroll.md's Net Pay formula and "Deferred v1 scope".
- **Staff** — leave rows key off `staffProfileId`; no `StaffProfile` schema
  change. See [staff](staff.md) for the proposed (confirmation-gated) "View
  leave" quick link.

## Testing (built)

Covered in `apps/api/test/leave.spec.ts`, `leave-types.spec.ts`, and
`leave-accrual.spec.ts`: request → approve → attendance/leave-balance side
effects, request → reject (no side effects), minimum-notice/half-day/
supporting-document/negative-balance validation per leave type, the
second-approval sub-state, tab-count correctness, permission-denied (403) and
cross-tenant isolation (404) per endpoint, via `pnpm test:integration`.

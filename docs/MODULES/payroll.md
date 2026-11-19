# Payroll

```
status: BUILT (v1) — schema + API + web screens implemented per the 2026 Claude
Design prototype (project "Keystone HR", file `Keystone HR Salon.dc.html`). This
revision supersedes the prior req-doc-only version of this file: the open
questions below are resolved. Commission remains explicitly deferred — see
"Deferred v1 scope". Absence Deduction and Leave Deduction (unpaid leave),
once also deferred here, have since landed now that [attendance](attendance.md)
and [leave](leave.md) are themselves built — see the Net Pay formula (§8)
below. Percentage-basis allowance/deduction components now recompute live
from the staff member's current base salary at generation/recompute time
(previously a stale one-time snapshot); the Approved/Rejected tabs default to
List view (Batch still available via the toggle); and the payslip dialog was
redesigned — a richer header (avatar, role, branch, date of joining), its
secondary actions (Edit/Recompute/Download PDF) consolidated into a kebab
menu, and a cleaner color/spacing treatment.
```

## Purpose

Monthly payroll processing for all staff. A payroll administrator generates a
run per **branch + month**, reviews each staff member's auto-calculated
earnings and configured deductions, adjusts figures where the business rules
allow it, and moves each payroll item through **Pending → Approved → Paid**
(with **Rejected** as a correction side-path). Bilingual EN + AR (RTL); all
amounts are integer minor units (`packages/shared/src/money.ts`) — OMR uses a
3-decimal exponent, other currencies per `CURRENCY_EXPONENTS`.

## Primary users / permissions

`payroll.view`, `payroll.generate`, `payroll.edit`, `payroll.approve`,
`payroll.reject`, `payroll.mark_paid` (`packages/shared/src/permissions.ts`).
Wired into Super Admin (all), Accountant, Operations Manager, and Branch
Manager (branch-scoped via `@BranchScoped`/`getEffectiveBranchIds()`, same as
Branches).

## Deferred v1 scope — Commission

The original req assumed **Service Commission** (from completed POS
checkouts) and an **Absence Deduction** (from attendance records) as
auto-calculated, non-editable figures. At the time, neither upstream module
existed in this codebase; Attendance (and Leave) have since shipped, and
Absence Deduction plus a parallel Leave Deduction (unpaid leave) landed as a
result — see §8 below for both. **Commission remains deferred**: there's
still no POS/checkout module, no `commission_records`/`commission_rules`
tables.

Rather than fabricate a manual-entry stand-in for data with no real source,
**v1 omits the Commission field entirely** — no Commission line in the
schema, API, or UI. **To reintroduce it later**: add `commission_minor`
(snapshotted from `commission_records` at generation time, never recomputed
on read — same "period snapshot" pattern as everything else here) as a new
`payroll_items` column, add the term back into the Net Pay formula below, and
update the payslip template/UI to show it. Until then,
`PayrollItemSummary`/`PayrollItemDetail` (in
`packages/shared/src/schemas/payroll.ts`) have no such field — don't add it
speculatively elsewhere in the meantime.

## Resolved design decisions (this revision)

The 2026 Claude Design prototype's payroll screen (3-tab listing,
Batch/List toggle, payslip detail dialog, generic approve/reject confirm
dialog) is a **static mockup** — it encodes layout and affordances, not
conditional logic. These are the concrete resolutions implemented:

1. **State machine**: `Pending → Approved → Paid` (terminal, immutable), plus
   `Pending → Rejected` and `Approved → Rejected` (a correction path), and
   `Rejected → Pending` via **Revert**. Enforced via `PAYROLL_ITEM_TRANSITIONS`
   in `packages/shared/src/enums.ts` and checked server-side on every
   transition — a client bug can't bypass it.
2. **Row/action matrix by status** (`apps/web/.../payroll/payroll-status.ts`):
   - **Pending** → Reject, **Approve** (single-item; bulk via selection +
     "Approve Selected"/"Reject Selected").
   - **Approved** → Reject (correction path), **Mark Paid**, **Revert**.
   - **Rejected** → **Revert** only.
   - **Paid** → read-only (view + PDF download only).
3. **Bulk approve/reject apply only within the Pending tab** — selection
   checkboxes and the bulk toolbar don't appear in the Approved/Rejected
   Batch/List views.
4. **Exactly 3 tabs** (Pending / Approved / Rejected) — no separate Paid tab.
   Paid items render inside the **Approved** tab (`status IN (approved, paid)`).
5. **Batch is a real persisted entity** (`payroll_action_batches`): every
   approve/reject action — whether a single row or a bulk selection — creates
   one batch row (sequential `batch_no` per run) and stamps the affected
   items' `batch_id`. This is what the Batch view groups by. Batch aggregate
   count/total are computed on read (never stored), matching how Gross/Net
   salary is computed on read in the Staff module. Revert clears `batch_id`.
6. **Allowances**: payslip shows a read-only snapshot breakdown of the staff
   member's configured allowance components (`payroll_item_components`,
   taken at generation time) plus one **editable total** override
   (`allowances_total_minor`, defaults to the snapshot sum, editable
   pre-payment) — this is the one earning line the admin can override at run
   time, exactly as the original req implied but never fully specified.
7. **Deductions (v1 taxonomy)**: a read-only snapshot breakdown of configured
   statutory deduction components plus one **editable total** override
   (`statutory_deductions_total_minor` — this is what the mockup labels
   "Tax", but it's Social Insurance/statutory, not income tax), a single
   **Other Deduction** editable field (`other_deduction_minor`, manual, no
   upstream dependency), and arbitrary **ad-hoc extra deduction rows**
   (`payroll_item_adjustments`, type `deduction`) for anything else (advances,
   fines). Symmetric **ad-hoc addition rows** (type `addition`) exist on the
   earnings side (bonus, overtime).
8. **Net Pay formula**:
   `Net Pay = Base Salary + Allowances(override) + Σ Additions
              − Statutory Deductions(override) − Other Deduction
              − Absence Deduction − Leave Deduction − Σ Extra Deductions`
   (Commission returns once POS ships.) When the staff member's **Date of
   Join** falls inside the payroll month, Base Salary, Allowances, and
   Statutory Deductions are each **prorated by `paidDays / totalDaysInMonth`**
   before the formula above is applied — individually per allowance/deduction
   component, then summed, so the persisted breakdown always sums exactly to
   the totals (see `money.ts`'s `paidDaysForJoin`/`prorateAmount`, half-up
   rounding at minor-unit precision). Joined on/before the 1st of the month
   (or no Date of Join at all) pays the full, unprorated month. `paidDays` is
   **purely Date-of-Join based** — unpaid leave does NOT reduce it (see
   Absence/Leave Deduction below), so Base Salary stays visibly whole except
   for an actual mid-month joiner.

   **Absence Deduction** and **Leave Deduction** (unpaid leave) are both
   separate deduction lines, not proration inputs — each a per-day rate ×
   a day count on the SAME basis, **Gross** (full, unprorated Base Salary +
   full, unprorated allowance components), independent of join-date
   proration: `absenceDeductionMinor = Gross × absentDays / totalDaysInMonth`
   (absent days from `AttendanceService.countAbsentDays`) and
   `leaveDeductionMinor = Gross × unpaidLeaveDays / totalDaysInMonth` (days
   from approved requests against an `isPaid: false` leave type, via
   `LeaveService.getUnpaidLeaveDays`). Their backing day counts
   (`absentDays`, `unpaidLeaveDays`) are stored alongside the amounts and
   shown on the payslip. No double-counting risk: a day covered by any
   approved leave (paid or unpaid) gets the `on_leave` AttendanceDay status,
   never `absent`. Both are editable overrides on `PATCH /payroll/items/:id`,
   same as Other Deduction.
9. **Regeneration**: full recomputation is not supported. `POST /payroll/runs`
   is idempotent for the run itself — it never recreates or recomputes an
   existing `(branch, month)` run — but calling it again **additively syncs
   in staff who became newly eligible since generation** (e.g. a Primary
   Branch reassignment after the run already existed — this exact scenario
   surfaced as a real bug report and prompted the fix). Existing
   `payroll_items` are never touched, recomputed, or removed by a sync; only
   missing-but-now-eligible staff get a new item. Refreshing a figure on an
   existing item still means editing it directly — **except** the
   system-computed figures (`paidDays`, base salary, allowance/statutory
   breakdown+totals, Absence Deduction, Leave Deduction), which have no hand-edit field on
   `PATCH /payroll/items/:id` at all. For those, a **Pending** item can call
   `POST /payroll/items/:id/recompute` to rerun the exact generation-time
   formula against current leave/attendance/component data in place — e.g.
   unpaid leave approved after the item was generated. This is the one
   exception to "existing items are never touched": still no-op for
   Approved/Rejected/Paid items, and it never touches `otherDeductionMinor`
   or the ad-hoc additions/extraDeductions rows (those stay purely manual).
   `POST /payroll/runs/:runId/bulk-recompute` applies this to several (or,
   via the web app's existing "select all matching" selection mode, every)
   Pending item in one run at once; one item racing to a non-Pending status
   mid-batch is skipped, not fatal to the rest.
   The reverse gap (a staff
   member who already has an item, then becomes ineligible before the run is
   paid) is NOT addressed — their item is intentionally left as-is.
   `GET /payroll/runs/preview` (see API section below) exposes this same
   "existing items never recounted" rule as a read-only dry run, so the web
   app can show real counts in a confirm dialog before the admin commits to
   generating/syncing.
10. **Staff eligibility for a run**: every active staff member whose
    **Primary Branch** equals the run's branch (avoids double-paying staff
    assigned to multiple branches; consistent with base salary already being
    denominated in the Primary Branch's currency, per `staff.md`), **and**
    whose Date of Join is on/before the payroll month's last day (or has no
    Date of Join). Staff who join after the month ends are excluded from
    eligibility entirely for that month — not merely unprorated to zero —
    since they weren't employed during that period at all; they become
    eligible for the month they actually join. This exclusion applies
    identically to `POST /payroll/runs` (both first-generation and sync) and
    `GET /payroll/runs/preview`'s `newEmployeeCount`. Existing `payroll_items`
    are never removed retroactively if Date of Join is edited after
    generation — same frozen-snapshot rule as branch reassignment (#9 above).
10a. **Zero-eligible-employee guard**: generating a **brand-new** run (not a
    sync onto an existing one) for a branch with zero eligible staff is
    rejected with `409 PAYROLL_NO_ELIGIBLE_STAFF` — no empty `payroll_runs`
    row is created. The web app checks the same condition via
    `GET /payroll/runs/preview` before even opening the generate-confirmation
    dialog, so the admin sees a clear message instead of a raw 409.
11. **Payslip PDF**: implemented via headless Chromium (Playwright),
    rendering a server-side bilingual HTML template
    (`apps/api/src/modules/payroll/payslip-pdf.template.ts`) — chosen over a
    pure-JS PDF library because Arabic text shaping/ligatures need real
    browser text layout. See "PDF rendering" below for the deployment note.
12. **Mark Paid has no Finance integration in v1**: `finance_transactions`
    doesn't exist yet (Finance module is unbuilt) — marking a payroll item
    Paid does **not** write a finance expense row. Revisit once Finance ships
    (write a `direction: out, category: payroll` row inside the same
    mark-paid transaction, per the original integration intent below).
13. **Dashboard Rating/Revenue/View-Staff-Profile columns** (flagged as
    low-confidence in the prior revision of this doc) are **dropped** — the
    2026 design's payroll listing doesn't include them.
14. **No "email payslip" action** — the design mockup shows an email icon per
    row, but sending payslips by email requires a mail-delivery integration
    that's out of scope for this pass. Not built; the icon is omitted from
    the web UI rather than shipped non-functional.
15. **Employee Code**: the payslip mockup shows an "Employee Code" field, but
    Staff has no such field today. Omitted from the payslip in v1 — add it to
    `StaffProfile` first if/when the product needs it, then wire it through.

## Data model (`apps/api/prisma/schema.prisma`, migration `20260815171341_payroll`)

All five tables are tenant-scoped with RLS (ENABLE + FORCE + `tenant_isolation`
policy), following the exact pattern in `apps/api/prisma/rls.sql`:

- **`payroll_runs`** — one per branch + month. `branch_id`, `payroll_month`
  (DATE, first-of-month), `currency` (snapshot of the branch's currency),
  `generated_by`, `generated_at`. Unique `(tenant_id, branch_id, payroll_month)`.
- **`payroll_items`** — one per staff per run. Locked snapshot
  `base_salary_minor` and `paid_days` (both already prorated per the Date-of-
  Join formula above where applicable); editable overrides
  `allowances_total_minor`, `statutory_deductions_total_minor`,
  `other_deduction_minor` (also prorated at generation, then freely editable
  same as any other override); derived `net_pay_minor`; `status`
  (`PayrollItemStatus`); `batch_id`; actor/timestamp columns per transition
  (`approved_by/at`, `rejected_by/at/reason`, `paid_by/at`). Unique
  `(payroll_run_id, user_id)`.
- **`payroll_item_components`** — read-only snapshot of the staff member's
  configured allowance/deduction components at generation time (mirrors
  `staff_payroll_components`); purely for payslip breakdown display, never
  re-derived.
- **`payroll_item_adjustments`** — ad-hoc addition/deduction rows added during
  edit (label + amount), fully editable/removable pre-payment.
- **`payroll_action_batches`** — one row per approve/reject action (single or
  bulk); `batch_no` sequential per run; `payroll_items.batch_id` FKs here.

Money: `BIGINT` minor units throughout; arithmetic via plain integer
add/subtract (percentage-basis components were already resolved to concrete
minor amounts when the staff member's allowances/deductions were configured —
see `staff_payroll_components`'s doc comment) — same pattern as the Staff
module's Gross/Net calc in `users.service.ts`.

## API — `apps/api/src/modules/payroll/`

Standard layered module (thin controller, all logic in the service, DTOs as
`createZodDto(...)` wrappers over `packages/shared/src/schemas/payroll.ts`):

- `POST /payroll/runs` — generate-or-fetch (idempotent).
- `GET /payroll/runs` — fetch by `(branchId, payrollMonth)` without generating;
  `null` means not generated yet.
- `GET /payroll/runs/preview` — read-only dry run for the same `(branchId,
  payrollMonth)` pair: how many staff would be newly added, the resulting
  total, and (if a run already exists) its current Pending/Approved/Rejected/
  Paid breakdown. Powers the web app's pre-generate confirmation dialog;
  gated by `payroll.view` (read-only, not `payroll.generate`), same counting
  rule as generation itself (see "Regeneration" above).
- `GET /payroll/runs/:runId/items?tab=&page=&pageSize=` — tab-filtered,
  paginated listing (`page`/`pageSize` from `PaginationQuerySchema`, same
  convention as Branches/Staff: `{ data, meta: { page, pageSize, total } }`).
- `GET /payroll/runs/:runId/batches?tab=approved|rejected` — lightweight batch
  **menu** for the Batch view's sidebar: metadata + aggregates only
  (`id, batchNo, action, performedBy, performedAt, count, totalNetMinor`), no
  nested items, unpaginated (batches are created only by approve/reject
  actions — realistically never a huge list).
- `GET /payroll/runs/:runId/batches/:batchId/items?page=&pageSize=` —
  paginated items for one specific batch, powering the Batch view's
  right-hand pane once a batch is selected from the sidebar. 404s if the
  batch doesn't belong to `runId`.
- `POST /payroll/runs/:runId/bulk-approve` / `/bulk-reject` — bulk actions on
  Pending items, each creates one `payroll_action_batches` row.
- `POST /payroll/runs/:runId/bulk-mark-paid` / `/bulk-revert` — bulk actions on
  Approved (mark-paid or revert) / Rejected (revert only) items; mirror the
  single-item `mark-paid`/`revert` transitions exactly (no batch row, since
  Mark Paid/Revert don't create one for the single-item case either).
- **Bulk body shape**: `{ itemIds: [...] }` (explicit, page-scoped — the
  original mechanism, ≤500 ids) **or** `{ selectAll: { tab, batchId?,
  excludeIds? } }` ("select all N matching" across every page, resolved
  server-side at execution time — never a stale client-held snapshot). Exactly
  one of the two must be present. `selectAll.tab` scopes to that tab's
  displayed statuses **intersected** with the action's valid source statuses
  (`sourceStatusesForTab` in `payroll.service.ts`) — this is what keeps a
  "select all" bulk Mark Paid/Revert triggered from the Approved tab from
  sweeping in already-`paid` items, since the Approved tab also displays Paid
  items (no separate Paid tab). `selectAll.batchId` further scopes to one
  batch (the Batch view's "select all in this batch" case). No background job
  is involved — `applyAction` is already a single batched `updateMany` per
  call, so even a large `selectAll` resolution completes near-instantly; this
  repo has no working BullMQ integration to build on anyway (bare unused
  scaffold, no job-tracking table, no progress endpoint, no WebSockets/SSE) —
  revisit only if a genuinely slow per-item side effect lands later (e.g.
  Finance ledger writes).
- `GET /payroll/items/:itemId` — full payslip detail.
- `PATCH /payroll/items/:itemId` — edit allowances/statutory/other overrides
  and replace the ad-hoc addition/extra-deduction row sets (full-replace
  convention, same as `SavePayrollComponentsSchema`); rejected on Paid/Rejected
  items (`PAYROLL_ITEM_LOCKED`).
- `POST /payroll/items/:itemId/approve|reject|mark-paid|revert` — single-item
  transitions; validated against `PAYROLL_ITEM_TRANSITIONS`
  (`PAYROLL_ITEM_NOT_PENDING`/`PAYROLL_INVALID_TRANSITION` on violation).
- `GET /payroll/items/:itemId/payslip.pdf?locale=en|ar` — PDF download.

Every transition and edit is audit-logged (`payroll_run.generated`,
`payroll_item.edited`, `payroll_item.approve/reject/mark_paid/revert`) per the
locked business rule.

## PDF rendering

`apps/api/src/modules/payroll/payslip-pdf.service.ts` launches a reused
headless Chromium instance (Playwright) and prints a server-rendered HTML
template (`payslip-pdf.template.ts`) to PDF — chosen over a pure-JS PDF
library because Arabic text shaping/ligatures need real browser text layout.
**Deployment note**: the API's Docker image needs Chromium's system
dependencies *and* an Arabic-capable font package installed (e.g.
`fonts-noto` on Debian) — Chromium's engine handles the shaping, but still
needs real glyphs on disk. Verified locally: EN and AR payslip PDFs both
render correctly (RTL layout, connected Arabic glyphs, Western digits for
amounts).

## Web — `apps/web/src/app/[locale]/(dashboard)/payroll/`

- `payroll-content.tsx` — branch/month selectors, "Run Payroll", the 3-tab bar
  with live counts (from each tab's `meta.total`, not `.length` — every tab is
  paginated), the Batch/List toggle (Approved/Rejected only), bulk toolbar (all
  3 tabs, tab-specific buttons).
- `payroll-table.tsx` — shared row table with an optional pagination footer
  (`pagination={{ meta, onPageChange }}`, reusing `DataTable`'s `PagerButton`
  and `table.*` i18n keys) and a mode-agnostic `selection` prop
  (`isSelected(id)` instead of a raw `Set`, so the same table works for both
  plain page-scoped selection and "select all matching, with exclusions"
  without knowing which mode is active).
- **Batch view** is a master-detail layout, not a stack of cards: a left-side
  scrollable menu of batches (newest first, from the lightweight
  `GET .../batches` endpoint), defaulting to the most recent one, and a
  right-hand `PayrollTable` bound to `usePayrollBatchItems` for whichever
  batch is selected — paginated independently of the tab's own List view.
- **Selection state machine** in `payroll-content.tsx`: `selectedIds` +
  `selectAllMode`. When `selectAllMode` is false (default), `selectedIds` IS
  the selected set (page-scoped). When true, `selectedIds` is the EXCLUDED
  set — every matching item is selected except these. Entered via a
  "Select all N matching items" link that appears once every row on the
  current page is checked and `meta.total` exceeds the page size; bulk actions
  in this mode send `{ selectAll: { tab, batchId?, excludeIds } }` instead of
  `{ itemIds }`.
- `payslip-dialog.tsx` — payslip detail + inline edit mode (allowance/
  deduction overrides, ad-hoc rows) + PDF download + status-gated actions.
- `payroll-confirm-dialog.tsx` — generic approve/reject confirm; either an
  explicit staff list + total amount (page-scoped selection) or just a
  resolved count (select-all-matching mode, where the full item set isn't
  loaded client-side by design).
- `payroll-status.ts` — the resolved status → allowed-actions matrix (§2
  above) in one place.
- `lib/queries/payroll.ts` — TanStack Query hooks mirroring the API 1:1;
  `usePayrollItems`/`usePayrollBatchItems` take a `page` argument and return
  `Paginated<PayrollItemSummary>`.

No shadcn `Tabs`/`Sheet` exist in this repo — the tab bar and Batch/List
toggle reuse the existing `SegmentedControl`/grid-list-toggle patterns
(`branches-content.tsx`) rather than introducing a new component family.

## Locked business rules

- Payroll is generated separately for each branch **and** payroll month.
- Base Salary and Allowances are retrieved from the staff record's salary
  configuration (`packages/shared/src/schemas/staff.ts`); snapshotted onto the
  payroll item at generation time.
- Payroll items are created **Pending**.
- Deductions (and the allowances override) are editable **pre-payment**
  (Pending or Approved); once Paid, an item is fully read-only.
- Rejected items may be corrected and resubmitted via **Revert → edit → re-
  approve**.
- Approved items may also be **Reverted** back to Pending directly (not just
  Rejected ones) — `PAYROLL_ITEM_TRANSITIONS.approved` includes `pending`.
- Every payroll action is audit-logged with actor + timestamp.
- Bulk approve/reject applies to selected Pending items; bulk mark-paid/revert
  applies to selected Approved items; bulk revert also applies to selected
  Rejected items. Bulk actions accept either an explicit id list or a
  server-resolved "select all matching" filter — see the API section above.
- A branch/month with zero eligible staff cannot have a run generated
  (`PAYROLL_NO_ELIGIBLE_STAFF`) — see eligibility rule #10 above.
- Every payroll item listing (all 3 tabs, and the items inside one batch) is
  paginated (`page`/`pageSize`, default 25 — same convention as
  Branches/Staff). The batch **menu** itself (the list of batches for a tab)
  is intentionally left unpaginated — batches are created only by
  approve/reject actions, realistically a short list per run.

## Integrations

- **Staff** — source of truth for base salary + configured allowance/
  deduction components (built). Salary History (effective-dated snapshots)
  is still not built (`staff.md`), so a payroll run reads whatever the staff
  record holds *at generation time* — edits to Staff after generation don't
  retroactively change an already-generated run's snapshot, but a **new**
  run generated later will reflect the current Staff state. This is an
  accepted v1 gap, tracked in `staff.md`.
- **POS** — Commission deferred; see above. Attendance/Leave integration
  (Absence Deduction, Leave Deduction) has landed — see §8.
- **Finance** — Mark Paid → Finance expense row deferred (Finance module
  unbuilt); see resolved decision #12.
- **Reports** — not built this pass; out of scope (the 2026 design's payroll
  screen doesn't include dashboard/report cards either).

## Testing

`apps/api/test/payroll.spec.ts` — generation idempotency + Net Pay
calculation, edit → approve → batch → mark-paid → locked-after-paid, reject →
revert, approved → revert, **additive sync of a newly-eligible staff member
into an already-generated run (with the existing item asserted untouched)**,
Date-of-Join proration (mid-month joiner, full-month joiner, excluded
after-month-end joiner incl. `previewRun` count, last-day-of-month edge case),
bulk mark-paid/revert (Approved and Rejected tabs), **item-list pagination
(`meta.total` correctness, no overlap across pages)**, **the lightweight batch
menu (no nested `items`, correct `count`/`totalNetMinor`) and paginated
batch-items endpoint (incl. 404 for a batch outside the run)**, **bulk
`selectAll` resolution — including the critical case: a "select all" bulk
Mark Paid from the Approved tab must not touch already-`Paid` items, since the
Approved tab also displays Paid ones** — and `selectAll` with `excludeIds`,
permission-denied (403), branch-scope 403, and cross-tenant isolation (404).
Tests asserting exact item counts use a dedicated fresh branch per test (not
the shared `branchAId`, which accumulates permanently-eligible staff — no
joiningDate/departure — across the whole file). Run via `pnpm test:integration`.

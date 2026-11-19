# Branches / Franchise Management

```
status: built (API + list/create/edit screens, 4-step wizard; deferred: revenue/appointments KPI cards, store image, kebab actions Assign Manager / Transfer Staff / View Reports)
```

## Purpose

Central repository for managing all Keystone HR branches — Corporate-Owned or Franchise-Owned. Administrators create, manage, monitor, activate/deactivate, and analyze branch performance from a single screen. Bilingual EN + AR (RTL); currency OMR with 3 decimals (baisa).

## Primary users / permissions

- Super Admin
- Management Team
- Operations Manager

## Screens & fields

### 1. Branch list

**KPI cards**
- Total Branches
- Active Branches
- Inactive Branches
- Total Staff — total number of *active* employees assigned across all branches
- Total Appointments — total appointments scheduled **today** across all branches

**Table columns**
1. Store ID — unique system-generated identifier; unique across the system; **cannot be modified after creation**
2. Store Image
3. Branch Name — official name
4. Ownership Type — `Corporate` (owned/operated by Keystone HR) | `Franchise` (franchise partner)
5. City
6. Manager — employee responsible for branch operations
7. Staff — total active employees assigned to the branch
8. Status — operational or not
9. Revenue This Month — total net revenue for the branch this month
10. Actions — View, Edit, Kebab menu: Assign Manager, Transfer Staff, Deactivate Branch, View Reports

### 2. Create New Branch (dedicated page from "+ Add Branch")

A 4-step wizard (`apps/web/.../branches/branch-form.tsx`, shared between create and edit), each step validated with react-hook-form before advancing:

**Step 1: Details** — merges the original Basic / Contact / Location / Franchise sections into one step:
- *Basic*: Store ID* (auto-generated, read-only on edit), Branch Name (EN)* / (AR)*, Ownership Type* (Corporate/Franchise), Branch Status* (Active/Inactive)
- *Contact*: Mobile Number*, Landphone Number, Email Address*, WhatsApp Number
- *Location*: Country*, State*, City*, Address*, Google Maps Link
- *Franchise Information* — conditional: shown only when Ownership Type = Franchise. Existing owner (dropdown, one owner may hold many branches) or new owner (Owner Name*, Company Name*, Commercial Registration No.*, VAT/Tax Number), Agreement Start Date*, Agreement Expiry Date*

**Step 2: Manager & Hours** — Branch Manager moved here (dropdown of staff), plus the original Business Information (Opening Time*, Closing Time*, Weekly Off Day) and Financial Configuration (Currency — defaults to tenant currency if omitted)

**Step 3: Capacity & Services**
- Number of Chairs* — +/- stepper, physical chair capacity at this branch (`chair_count` column, default 1)
- Branch Settings (toggles): Allow Online Booking*, Allow Walk-ins*, Enable Loyalty Program*, Enable Product Sales*
- Services Offered — chip multi-select over the tenant's active service catalog (`docs/MODULES/services.md`-equivalent `Service`/`BranchService` models). Selecting/deselecting writes `BranchService.isAvailable` exception rows for this branch only, transactionally with the branch save; omitting the field entirely (vs. sending an explicit list) leaves existing rows untouched. A service with no exception row is offered at its base price — this wizard step never touches `price_override_minor`, which stays an operation of the Services settings screen only.

**Step 4: Review & Confirm** — read-only summary of the key fields entered above (name, location, type, mobile, manager, hours, chair count, staff count when editing, currency, services selected count), then the final Create/Save action.

**Deferred, not in the current wizard** (kept here for traceability against the original PRD, not yet built):
- VAT Applicable toggle / VAT Percentage — tax now flows through the tenant-wide `tax_profiles`/`tax_components` model (`docs/GLOBALIZATION.md` §2) rather than a per-branch flat rate; a branch-level tax profile picker is not yet exposed in this form.
- Section 8 "Initial Staffing" (Receptionist/Barbers multiselect at creation time) — staff are still assigned after the fact via the Staff module.
- Store Image upload.

### 3. View / Edit Branch

Same fields as Create, pre-filled, plus:

1. **Branch Status Badge** at page header — Active | Inactive
2. **Created & Last Updated audit info** — Created date & time, Created by, Last modification date, Last modification time, User who performed the update
3. **Save Changes** — validates and updates; audit log and Last Updated info are refreshed

## Business rules

- Store ID immutable after creation.
- Franchise section required (with its mandatory fields) only for Franchise ownership type.
- Branch settings toggles gate features per branch (online booking, walk-ins, loyalty, product sales) — these are plain boolean columns on `branches`.
- Chair count (`chair_count`) is a simple capacity metric (`min(1)`), not yet consumed by any scheduling/utilization logic — it exists today only for display (branch card "Chairs" stat, review step) and future capacity features.
- A branch's service selection is an *exception list* against the tenant's active service catalog: no `branch_services` row = offered at base price. The branch wizard only ever toggles `is_available`; price overrides remain exclusively a Services-settings-screen concern (`docs/MODULES/services.md`-equivalent). Deselecting a service at one branch never affects that service's availability/price at other branches.
- Revenue This Month per branch = net revenue (service + product − refunds) for current month (deferred — no POS/finance module yet).

## Data-model touchpoints

`branches` (name_en/ar, type corporate|franchise, address, phone, currency, status, chair_count, allow_online_booking/allow_walk_ins/enable_loyalty/enable_product_sales, working_hours JSONB, tax_profile_id), `franchise_details` (1:1 branch — owner, agreement dates, cr_number), `branch_services` (branch↔service exceptions: is_available, price_override_minor — no row = offered at base price), `user_branch_assignments` (staffing/manager), `staff_profiles`, `appointments` (Total Appointments KPI), `invoices` (Revenue This Month), `audit_logs` (created/updated info).

## Open questions

- Country/State/City dropdown source (static list vs reference tables).
- "Transfer Staff" kebab action UX and effect on `user_branch_assignments` — needs a flow definition.
- Store Image upload specs (formats/size) not stated in PDF.
- Per-branch VAT/tax-profile picker in the Add/Edit wizard — currently only configurable indirectly via `tax_profiles` (Settings), not surfaced as a wizard field.
- Chair count currently has no product-defined upper bound; the web/API cap of 100 is an engineering placeholder, not a confirmed business rule.
- **Done (2026-09):** `working_hours.weeklyOffDay` (single day) is now `weeklyOffDays` (array), to support a real 2-day weekend (e.g. Friday+Saturday, common in Oman/GCC) — needed by [attendance](attendance.md)'s Weekly Off computation. `workingHours` is an opaque Prisma `Json` column, so this needed no schema migration — only the zod schema (`packages/shared/src/schemas/branch.ts`), the seed data, and the create/edit form (now a multi-select `Chip` toggle group instead of a single `Select`, mirroring the existing services-picker pattern in the same form). No backward-compat shim: reseed (`pnpm db:seed`) after pulling this change.

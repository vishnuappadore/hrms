# Services & Pricing

```
status: built (API + shared schemas + web screens — list with category chips/search,
create/edit form, category management dialog; gated on services.view/services.manage)
```

## Purpose

Master configuration for salon services and their standard pricing. Defines each service's
name, standard duration, and default selling price. Acts as the single source of truth consumed
downstream by **Appointments**, **Walk-in Queue**, and **POS / Checkout**. Bilingual EN + AR
(RTL); prices in OMR (3 decimals / baisa).

The 2026 client req nests this under **Settings → Services & Pricing** (see the settings tree in
[[settings]] §4 "Services Configuration"). We keep it as its own module doc because the built code
already ships a dedicated `services` module (API + shared schemas); [[settings]] cross-references
here rather than re-specifying.

## Primary users / permissions

Super Admin / Operations / Management ("administrators" in the req). Permission-gated via keys
already in `packages/shared/src/permissions.ts`:
- `services.view` — View services (also granted to Barber, Receptionist-type roles for booking).
- `services.manage` — Create/edit services and categories.

## Screens & flows

The req names three sections on the **Services & Pricing** screen: Services List, Add Service,
Edit Service.

### 1. Services List (Services Dashboard)

Displays all configured salon services; each row is one service. The req's overview also mentions
**View Services**, **Add Service**, **Edit Service**, **Update Service Pricing**, and a **Refresh**
action on the dashboard.

**Action button** — `+ Add Service` (opens the Add Service dialog).

**Table columns (per req)**
1. **Service Name** — name of the salon service.
2. **Duration** — standard time required to perform the service.
3. **Price (OMR)** — standard/default selling price. This price is the default selling price used in
   Appointments, Walk-in Queue, and POS / Checkout.
4. **Actions** — View / Edit.

> The built API/schema also carries **Category**, **AR name**, **buffer minutes**, **status
> (active/inactive)**, and **per-branch overrides** per row (see Data model). The req's list shows
> only Name / Duration / Price (OMR) / Actions — those extra fields exist in data but are not called
> out as columns in the 2026 req. See ⚠️ / ❓ below.

### 2. Add Service (dialog)

`+ Add Service` opens the Add Service dialog to create a new salon service by defining its name,
duration, and selling price. After saving, the new service becomes **immediately available across
the application**.

**Fields (per req)**
- Service Name
- Duration
- Price
- Save / Close buttons

**Navigation controls**
- **Close** — closes the dialog without saving; no service is created.
- **Save** — validates the entered information. On success: creates the service → saves it to the
  **Service Master** → refreshes the Services List → makes the service immediately available in the
  operational modules (Appointments, Walk-in Queue, POS / Checkout).

### 3. Edit Service (dialog)

The **Edit** icon opens the same dialog populated with the existing service information.
Administrators can update Service Name, Duration, Price. **Save Changes** updates the service master;
the updated information becomes immediately available throughout the application.

### Functional flow (per req)

```
Open Services & Pricing → View Service List → Select Action
                                              ├── Add   ─┐
                                              ├── Edit  ─┼─► Save Changes ─► Service List Updated
                                              └── Refresh┘
                                                              │
                                                              ▼ available in
                                              Appointments · Walk-in Queue · POS / Checkout
```

## Data model / fields

Req exposes only **name, duration, price**. The built model (`apps/api/prisma/schema.prisma`,
`packages/shared/src/schemas/service.ts`) is a superset:

**`services`** (`Service`)
| Field | Type | Req? | Notes |
|---|---|---|---|
| `id` | uuid | — | PK |
| `tenant_id` | uuid | — | RLS scope |
| `category_id` | uuid (FK → service_categories) | ❌ not in req | required in built schema |
| `name_en` | string (1–120) | ✅ (as "Service Name") | |
| `name_ar` | string (1–120) | ❌ not in req | required in built schema |
| `duration_minutes` | int (5–480) | ✅ "Duration" | calendar time |
| `buffer_minutes` | int (0–120, default 0) | ❌ not in req | cleanup/turnaround appended after service |
| `price_minor` | BIGINT | ✅ "Price (OMR)" | **integer minor units**, OMR exponent 3 (baisa) |
| `status` | enum `active`/`inactive` (default active) | ❌ not in req | `ServiceStatus` |
| `created_by` / `updated_by` | uuid? | — | audit stamps |
| `deleted_at` | timestamp? | — | **soft delete** (built code) |
| `created_at` / `updated_at` | timestamp | — | |

Uniqueness: **enforced** — `services` now carries `@@unique([tenantId, nameEn])` (migration
`20260731000000_service_name_unique`), matching **categories**, plus an app-level guard
(`assertServiceNameFree`) that returns `NAME_EXISTS` (409). Tenant-scoped, case-sensitive, EN name,
live rows only. The full DB index is safe because no delete flow writes `deleted_at`; if soft-delete +
recreate is ever exposed, switch to a partial unique index (`WHERE deleted_at IS NULL`).

**`service_categories`** (`ServiceCategory`) — `name_en`, `name_ar`, `sort_order`; unique
`(tenant_id, name_en)`; `serviceCount` computed (soft-deleted excluded). *Not in the 2026 req.*

**`branch_services`** (`BranchService`) — exception rows only: no row = service offered at all
branches at the base price. A row can override `price_override_minor` and/or flip `is_available` off
per branch. Unique `(service_id, branch_id)`. *Not in the 2026 req.*

## Business rules (per req)

- **Service Name is mandatory** and should **uniquely identify the service within the salon**.
- **Duration** is the standard estimated time to perform the service.
- **Price** is the default selling price used throughout the application.
- A service **cannot be saved unless all mandatory fields are completed** (validate before save).
- **Close** exits the dialog without saving any changes.
- **Immediate propagation**: changes are reflected immediately in operational modules for **future**
  transactions; the Services List refreshes immediately after a successful save.
- **Historical immutability**: **updating a service does NOT modify historical appointments,
  walk-in, or sales records that have already been completed.** Downstream records must snapshot the
  service name / duration / price at transaction time (same "persist at sale time" discipline as tax
  breakdowns — see apps/api/CLAUDE.md). Edits change only future defaults.

### Built-code rules (superset, not in req)

- Soft delete via `deleted_at`; `serviceCount` and list queries exclude soft-deleted rows.
- Per-branch price override & availability resolution: branch row wins; absent → base price /
  available. POS / Appointments should resolve the effective price for the branch.

## Status / state machine

Built enum `ServiceStatus`: `active` | `inactive` (default `active`), plus soft-delete
(`deleted_at`). The 2026 req does not mention a status field or deactivation — active/inactive is
carried by the built code only. Transitions: create → active; edit may set inactive; soft-delete
removes from lists. (Req assumes services simply exist and are editable.)

## Integrations

Upstream: **Settings** (module lives under Settings → Services & Pricing).

Downstream (master data consumed by):
- **Appointments** — service selection, default duration + price on booking.
- **Walk-in Queue** — service selection for walk-in registration.
- **POS / Checkout** — service as a sellable line at the default selling price.

Per-branch overrides (built) feed the branch-specific effective price to these consumers.

## Engineering notes (invariants)

- **Tenant isolation / RLS**: `services`, `service_categories`, `branch_services` all carry
  `tenant_id` + RLS (ENABLE + FORCE + `tenant_isolation`). Runtime = `hayryou_app`; queries via
  `PrismaService.client` / `withTenantTx()`. New tables added RLS in-migration.
- **Money**: `price_minor` / `price_override_minor` are **BIGINT integer minor units** in the tenant
  currency (OMR exponent 3 → 1.500 OMR = `1500`). All arithmetic via `packages/shared/src/money.ts`;
  never floats. Downstream modules snapshot the minor-unit price at transaction time.
- **API contract**: zod schemas in `packages/shared/src/schemas/service.ts`
  (`CreateServiceSchema`, `UpdateServiceSchema`, `ListServicesQuerySchema`, `ServiceSchema`, +
  category schemas) → `createZodDto` in `services.dto.ts` → reused in web forms. Errors return stable
  `code`s from `ERROR_CODES`.
- **Permissions**: `services.view` / `services.manage` (already in `permissions.ts`).
- **Multi-write** (service + branchOverrides set): built code replaces the branchOverrides set
  wholesale inside `withTenantTx` + `audit.log`.

## ⚠️ Changed in this revision

- **Model drastically thinned by the 2026 req vs [[settings]] §4 and the built code.** The req
  specifies only **Service Name, Duration, Price (OMR)** + Add/Edit/Close/Save. It drops (from the
  visible spec): service **categories**, the **EN/AR name pair**, **buffer time**, **per-branch price
  overrides**, **consumable mapping**, and **staff↔service capability** — all of which
  [[settings]] §4 previously assumed. See open questions for each.
- **Historical-immutability rule made explicit**: the req states editing a service must not mutate
  already-completed appointments / walk-in / sales records. Newly captured requirement — implies
  downstream snapshotting.
- **Immediate-propagation rule made explicit**: created/updated services must be immediately
  available to Appointments, Walk-in Queue, POS/Checkout for future transactions.
- **Placement**: req formally nests this under **Settings → Services & Pricing**. We keep a dedicated
  module doc (matching the built `services` module) and cross-reference [[settings]].
- **Code-vs-req drift (informational)**: the recently BUILT `services-catalog` module implements the
  RICHER settings.md §4 model — `ServiceCategory` (required `category_id`), required `name_ar`,
  `buffer_minutes`, `status active/inactive`, soft-delete, and `branch_services` per-branch overrides
  — NONE of which appear in the 2026 req. The req is a strict subset. No field the req requires is
  missing from the code. The one enforcement gap (service-name uniqueness) has since been **fixed**:
  `services` now has `@@unique([tenantId, nameEn])` (migration `20260731000000_service_name_unique`)
  plus an app-level `assertServiceNameFree` guard returning `NAME_EXISTS`.

## ❓ Open questions / needs client confirmation

- **Service name uniqueness — DONE** (was: not enforced). Added `@@unique([tenantId, nameEn])` +
  `assertServiceNameFree` → `NAME_EXISTS`. Implemented as tenant-scoped, case-sensitive, EN name.
  *Still open:* confirm whether it should be **case-insensitive** and/or also cover **`name_ar`**
  (current choice mirrors the `service_categories` precedent).
- **Service categories** — *Previously specced in [[settings]] §4 and BUILT (`service_categories`,
  required `category_id`); not present in the 2026 client req. Confirm DE-SCOPED vs DEFERRED.* If the
  req's flat list is authoritative, `category_id` should become optional or a default "Uncategorized"
  category is needed.
- **EN/AR name pair** — *Previously specced/built (`name_ar` required); the req shows a single
  "Service Name". Confirm DE-SCOPED vs DEFERRED.* Product is bilingual (RTL) — AR name likely still
  required despite the req omitting it. Recommend keeping the pair.
- **Buffer / turnaround time** — *Previously specced in [[settings]] §4 and BUILT (`buffer_minutes`);
  req lists only "Duration". Confirm DE-SCOPED vs DEFERRED.* Ties to Appointments slot/turnaround
  math.
- **Per-branch price overrides & availability** — *Previously specced in [[settings]] §4 and BUILT
  (`branch_services`); req shows a single salon-wide "Price (OMR)". Confirm DE-SCOPED vs DEFERRED.*
  Impacts multi-branch/franchise pricing and the "default selling price" resolution at POS.
- **Service ↔ consumable (product) mapping** — *Previously specced in [[settings]] §4 (service↔product
  quantities); not in the 2026 req.* Note this ties to inventory's dropped `service_consumables`
  table (see [[inventory]] — the model no longer includes it): no such Prisma model exists in the
  current schema. Confirm auto stock deduction on service completion is DE-SCOPED vs DEFERRED.
- **Staff ↔ service capability assignment** — *Previously flagged in [[settings]] §4 / staff.md as
  likely living here; not in the 2026 req.* This ties to the Appointments wizard, which per current
  scope no longer filters barbers by capability. Confirm DE-SCOPED vs DEFERRED.
- **Status / deactivation** — the built code carries `active/inactive` + soft-delete, but the req has
  no status or delete action (only Add/Edit). Confirm whether services can be deactivated/deleted and
  how downstream historical references behave.
- **Duration units** — req says "Duration" without a unit; built model is `duration_minutes`
  (5–480). Confirm minutes and the allowed range for the dialog input.

# Keystone HR — RBAC & Branch Scoping

> One-line summary: Flat `module.action` permission keys defined in code, tenant-editable roles stored as key sets, enforced by a guard chain (JWT → Permissions → BranchScope) with a 60-second in-process cache — plus app-layer branch scoping.

`status:` **BUILT** — permission catalog, guards, decorators, in-process permission cache, seeded system roles, branch scoping helpers, and a full role-management UI/API (`Settings > Roles & Permissions` — create/rename/delete custom and seeded roles, toggle their permission sets; only Super Admin is locked). **PLANNED** — permission keys for future modules (added alongside each module).

Related: [ARCHITECTURE.md](./ARCHITECTURE.md#5-request-lifecycle) · [MULTI-TENANCY.md](./MULTI-TENANCY.md) (tenant isolation — the layer *below* this one) · [DATA-MODEL.md](./DATA-MODEL.md#identity--auth)

---

## Two distinct layers — don't conflate them

| Question | Layer | Mechanism |
| --- | --- | --- |
| "Does this row belong to this tenant?" | Tenancy | Postgres RLS ([MULTI-TENANCY.md](./MULTI-TENANCY.md)) |
| "May this user do this action, at this branch?" | Authorization | This doc — guards, app layer only |

## Permission catalog

Permissions are **flat string keys** in `module.action` form (~60 total when all modules land). There is **no `permissions` table** — the const object in **`packages/shared/src/permissions.ts` is THE source of truth**:

```ts
// packages/shared/src/permissions.ts — real excerpt, not illustrative
export const PERMISSIONS = {
  "branches.view": "View branches",
  "branches.create": "Create branches",
  "branches.update": "Edit branches",
  "staff.view": "View staff",
  "staff.create": "Create staff",
  "staff.update": "Edit staff",
  "staff.employment.manage": "Manage salary/commission/contracts",
  "roles.manage": "Create/edit roles and permissions",
  "appointments.create": "Book appointments",
  "pos.use": "Open POS and create sales",
  "inventory.manage": "Create/edit items, adjust stock",
  // ...~70 keys total across every module, built and planned alike
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;
```

There is **no intermediate constant object** — controllers and web code both reference the string literal
directly (`@Permissions("branches.create")`, `permissions.includes("branches.create")`), not a
`PERMISSIONS.BRANCHES_CREATE`-style enum. A key not yet backed by any endpoint (a planned module, or one
flagged in "Known gaps" below) simply sits unused in the catalog — harmless, since an unmatched key in a
role's set just never grants anything.

Rules:

- **Adding a permission = adding a key here** (same PR as the endpoint that uses it). The DB only ever stores these strings in `role_permissions.permission_key`.
- Naming: `module.action` — `pos.use`, `inventory.manage`, `customers.view`. Prefer a handful of coarse actions (`view` / `create` / `update` / `manage`) plus specific sensitive ones (`payroll.approve`, `roles.manage`) over per-field granularity.
- Because it lives in `packages/shared`, both the API (guards) and the web app (hide/show UI affordances) import the identical constants. UI hiding is convenience; **the API guard is the enforcement**.
- Unknown keys in the DB (e.g. after a key rename) simply never match — fail closed. Migrate `role_permissions` rows when renaming a key.

## Role model

Roles are **tenant-editable rows** (`roles` + `role_permissions`, see [DATA-MODEL.md](./DATA-MODEL.md#identity--auth)) — a role is just a named set of permission keys. Each user has one `role_id`.

Seven **system roles are seeded per tenant** at tenant creation (`is_system = true`). Real seeded sets
(`SYSTEM_ROLES` in `packages/shared/src/permissions.ts` — the actual source of truth, not a doc paraphrase):

| Role | Scope intent | Actual seeded set (summary — see the code for the exact list) |
| --- | --- | --- |
| **Super Admin** | Owner; everything | Literal `"*"` → every key in the catalog, `all_branches = true` |
| **Operations Manager** | Runs day-to-day across branches | Most modules incl. Payroll approve/edit and Attendance/Leave, `staff.view`/`staff.update` (no create), `users.view`-equivalent via `staff.view`; no `roles.manage`, no `settings.manage`, no `staff.create`; typically `all_branches = true` |
| **Branch Manager** | Full control of assigned branch(es) | Appointments, POS (`pos.use` + discount), Walk-in Queue (full `walkin.*`), Customers, Inventory view/manage, Payroll approve/edit, `staff.view` only (no create/update) |
| **Receptionist** | Front desk | `appointments.*` (no cancel), `walkin.*` (full), `customers.*`, `pos.use`, `services.view`, `attendance.mark`, `leave.request` |
| **Barber** | Service provider | `appointments.view`, `walkin.view`, `services.view`, `customers.view`, `attendance.mark`, `leave.request` only |
| **Cashier** | Till | `pos.use`, `walkin.*` (full), `invoices.view`, `customers.view`/`create`, `loyalty.view`/`redeem`, `attendance.mark`, `leave.request` |
| **Accountant** | Money, read-mostly | `finance.*`, `invoices.view`, `taxes.view`, `audit.view`, full Payroll — no POS, no Appointments, no Staff keys |

Tenants can edit these sets or create new roles via `Settings > Roles & Permissions` (`roles.manage`, held only by Super Admin in the seeded sets above). Every role is fully editable/deletable — including the other 6 seeded system roles — except Super Admin itself (`roles.is_super_admin`), which can never be renamed, edited, or deleted; a role currently held by any staff member can't be deleted until they're reassigned. The Role editor dialog groups the catalog by module with one checkbox per real key and a Select All/Clear All toggle per module. Exact seeded sets live in `packages/shared/src/permissions.ts`'s `SYSTEM_ROLES` and grow as modules add keys — don't copy the table above into code, read the source.

## Guard chain

Order (global, [request lifecycle](./ARCHITECTURE.md#5-request-lifecycle)): **`JwtAuthGuard` → `PermissionsGuard` → `BranchScopeGuard`**.

### `@Permissions()` + `PermissionsGuard`

```ts
// apps/api/src/modules/branches/branches.controller.ts — real code
@Controller('branches')
export class BranchesController {
  @Post()
  @Permissions("branches.create")
  create(@Body() dto: CreateBranchDto) { ... }

  @Patch(':branchId')
  @Permissions("branches.update")
  @BranchScoped('branchId')     // this :branchId IS a branch id — scope-check it
  update(@Param('branchId') branchId: string, @Body() dto: UpdateBranchDto) { ... }
}
```

`PermissionsGuard` reads the metadata, fetches the role's permission set (see [cache](#in-process-permission-cache)), and throws 403 with error code `PERMISSION_DENIED` on a miss. Routes without `@Permissions()` require authentication only — every mutating endpoint MUST declare one.

### `@BranchScoped()` + `BranchScopeGuard`

For single-resource routes where a branch id appears in the params/body:

```ts
@Get('branches/:branchId/stock')
@Permissions("inventory.view")
@BranchScoped('branchId')
getStock(@Param('branchId') branchId: string) { ... }
```

Logic (`apps/api/src/common/guards/branch-scope.guard.ts`): if the JWT context's `allBranches` flag is true, pass; else require the route's branch id ∈ `ctx.branchIds`, otherwise 403 `BRANCH_ACCESS_DENIED`. If the route has no branch id at all (e.g. a list endpoint reached via a decorated controller method with nothing to check), the guard passes through and leaves filtering to the service's own `getEffectiveBranchIds()` call.

### `getEffectiveBranchIds()` — list endpoints

List/aggregate endpoints don't 403; they **narrow the query**:

```ts
// service layer — real signature: returns string[] | undefined, never the literal '*'
const effective = getEffectiveBranchIds(this.cls);
// undefined → allBranches caller, no filter (tenant-wide; RLS still bounds it to the tenant)
// string[]  → where: { branchId: { in: effective } }
```

An optional `?branchId=` filter must be validated as a **subset** of the effective ids — never trusted directly.

## Branch scoping rules

- Source of truth: `users.all_branches bool` + `user_branch_assignments` rows ([DATA-MODEL.md](./DATA-MODEL.md#identity--auth)). `all_branches = true` ⇒ JWT claim `branchIds: '*'` and assignments are ignored.
- Claims snapshot at login; assignment changes take effect on next token refresh.
- **Why app-layer, not RLS** (locked decision): branch access is a *mutable authorization rule* — per-user assignments change, `'*'` wildcards exist, some cross-branch reads are legitimate per-endpoint (reports, transfers-in). Encoding that in RLS would mean per-request multi-value GUCs and policy churn on every rule tweak, and would obscure "why is this list empty?" debugging. RLS stays a single, never-changing invariant (tenant isolation); branch logic stays greppable TypeScript.

### Dashboard KPI scoping — BUILT

`DashboardService.get()` resolves `getEffectiveBranchIds(cls)` once per request and spreads
`{ branchId: { in: effective } }` into every section's own plain Prisma `count`/`groupBy`/
`aggregate` call — **not** the raw-SQL `Prisma.sql` fragment this section used to sketch as the
design intent. That turned out unnecessary: every section's query is expressible as a normal
Prisma call (the one place that looked like it might need raw SQL — Low Stock Alerts' `quantity
≤ reorderLevel` cross-table comparison — is fetch-then-filter-in-JS instead, since the tenancy
Prisma extension only intercepts model operations, not `$queryRaw`/`$executeRaw`; a bare raw
query outside `withTenantTx` would silently run with no tenant GUC set and return zero rows).
Same branch-scoping pattern as every other built module (Attendance, Leave, Payroll, Branches,
Staff, Walk-ins) — see `apps/api/src/modules/dashboard/dashboard.service.ts`.

Beyond branch scoping, Dashboard also gates **per-section** on top of the page-level
`dashboard.view` permission: `DASHBOARD_SECTION_PERMISSIONS`
(`packages/shared/src/schemas/dashboard.ts`) maps each KPI/widget to the permission key(s) that
unlock it, and the server omits the key entirely from the response rather than 403ing the whole
page — a Barber sees Appointments-today but no Revenue card, for instance. `dashboard.view`
itself was backfilled onto Receptionist/Barber/Cashier (previously only Super Admin, Operations
Manager, Branch Manager, Accountant had it), so every role lands on a correctly-scoped-down page
instead of some roles getting no Dashboard at all. See `docs/MODULES/dashboard.md`.

## Client-side enforcement

Every built module's web screens hide actions the caller can't actually use, via
`usePermissions()` (`apps/web/src/lib/permissions.ts`):

```tsx
const permissions = usePermissions();           // call once, near the top — never inside a .map()/loop
// ...
{permissions.includes("branches.create") && (
  <Link href="/branches/new">+ Add Branch</Link>
)}
```

Rules established across this build-out, worth following for any new module:
- **Hide, don't disable** — a button the caller can't use is removed from the DOM entirely, not
  rendered-and-disabled. Matches the sidebar nav, the Settings card grid, and every module's action buttons.
- **View stays separate from Edit** when a module has no distinct read-only detail view (Staff, Branches,
  Customers' row-level Edit links): the navigation/view trigger stays ungated so a view-only role can still
  see full record details; only the actual Save/mutate button is gated. When a module's "edit" trigger is a
  same-screen dialog over data the list row already fully displays (Leave Settings, Payroll Components,
  Services' category rename), gate the trigger directly — there's no view capability being hidden.
- **Match the real server key, not the semantically-obvious one** — confirm the actual `@Permissions(...)`
  decorator before gating; several modules have a catalog key that *sounds* right but is unenforced (see
  "Known gaps"), or a differently-named key that's the real guard (Payroll's revert action is gated on
  `payroll.approve`, not a dedicated "revert" key; Leave's cancel-an-approved-request action is gated on
  `leave.approve`, same pattern).
- **This is convenience only** — restated because it matters: the API's own `@Permissions()` guards are the
  actual enforcement. A client-side check that doesn't match the server's is either a harmless UX wrinkle
  (over-hiding) or a false sense of security (under-hiding) — never a security hole either way, since the
  server guard doesn't move.

## In-process permission cache

- A static `Map<roleId, {keys, expires}>` inside `PermissionSetService` (`apps/api/src/common/permission-set.service.ts`, a global module like `DatabaseService`) — **not** Redis; a prior draft of this doc described a Redis-backed cache that was never built. **TTL 60 s.** Extracted out of `PermissionsGuard` itself (which now just injects and delegates to it) once `DashboardService` needed the same resolved permission set to decide which KPI sections to include — one cache, not two that could disagree about staleness after a role edit.
- `PermissionsGuard` (and now `DashboardService`) read the cache; on miss, loads `role_permissions` from Postgres and repopulates.
- **Busted immediately on role edit/delete** — `RolesService` (`apps/api/src/modules/users/roles.service.ts`) calls `PermissionSetService.bustCache(roleId)` after every write, so a permission change takes effect on the role's very next request rather than waiting out the TTL.
- Single-instance only today (each API process has its own `Map`) — fine at current scale; revisit with a real distributed cache (Redis or similar) if/when the API runs as more than one instance, since a bust on one instance wouldn't clear another's.

## Known gaps — catalog keys with no enforcing endpoint

Deliberate, not bugs — confirmed by direct audit of every `@Permissions(...)` decorator against the full
catalog. Don't gate client-side UI on these until the server side actually checks them, since doing so would
hide a control for some roles while the server still accepts it from anyone:

- `pos.discount.manual` / `pos.refund` — `POST /pos/checkout` only checks `pos.use`; the manual-discount
  field and any refund/void flow are unenforced. No refund endpoint exists at all yet.
- `branches.deactivate` — toggling a branch's status rides on the same generic `PATCH` as every other
  field, gated by `branches.update`.
- `customers.delete` / `customers.export` — no delete or export endpoint exists.
- Anything under a module with no web screen at all yet (Loyalty, Inventory's transfer/procurement keys,
  Finance, Audit, Dashboard) — present in the catalog for when that module lands, enforced nowhere today.

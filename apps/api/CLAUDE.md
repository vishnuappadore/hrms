# apps/api — NestJS API

## Module pattern (copy `src/modules/branches/`)
```
modules/<name>/
  <name>.module.ts      # providers + controller
  <name>.controller.ts  # thin: decorators + delegation only
  <name>.service.ts     # business logic; all queries via PrismaService
  <name>.dto.ts         # createZodDto(...) from @hayryou/shared schemas ONLY
```
Rules:
- Controllers declare `@Permissions("module.action")` (keys from `@hayryou/shared`) and `@BranchScoped("branchId")` for single-branch routes. Add new permission keys to `packages/shared/src/permissions.ts` first.
- List endpoints: validate query with a shared zod schema extending `PaginationQuerySchema`, filter with `getEffectiveBranchIds(cls)`, return `{ data, meta }`.
- Multi-write workflows: `prisma.withTenantTx(async tx => ...)` + `audit.log(entry, tx)` inside the transaction. Cross-module side effects: EventEmitter listeners (non-critical) or BullMQ jobs (retryable) — never slow I/O inside the transaction.
- Orchestrators (pos, appointments) may import service modules (inventory, loyalty…); never the reverse.

## Database access — the rules that prevent tenant leaks
- `PrismaService.client` — default for everything. Tenancy extension wraps each query in a `set_config('app.tenant_id', …, true)` transaction; throws if CLS has no tenant.
- `PrismaService.withTenantTx(fn)` — REQUIRED for multi-statement writes.
- `PrismaService.runWithTenant(tenantId, fn)` — for jobs/listeners outside HTTP.
- `AuthPrismaService` — RLS BYPASS (owner connection). Allowed only in: auth module, tenants provisioning, seed, tests, and a worker job processor that must enumerate tenants before calling `runWithTenant()` per tenant (e.g. `leave-accrual.job.ts` — no other way to know which tenants exist outside a request's own CLS context). Adding a new usage requires updating this file with justification.

## Migrations
- `npx prisma migrate dev --name <name> --create-only` → edit SQL → apply with `pnpm db:migrate`. (The `pnpm db:migrate:dev -- --name ... --create-only` form can hang waiting on an interactive prompt in this environment — the args don't always reach prisma intact through the extra `--`; call `prisma` directly if that happens.) New tenant table? Append the RLS block (copy from `prisma/rls.sql`): ENABLE + FORCE + `tenant_isolation` policy. The `test/rls.spec.ts` schema assertions fail CI if you forget.
- Expand→migrate→contract only. Grants for `hayryou_app` come from default privileges (dev) / the rls.sql GRANT block.

## Testing
- `pnpm test` — unit (vitest + SWC for decorators).
- `pnpm test:integration` — real Postgres/Redis; global-setup runs `prisma migrate deploy`. Tests share the DB and run serially; create isolated tenants via `provisionTenant(app)` from `test/helpers.ts`, never reuse seed data.
- Any new module touching tenant data adds: a cross-tenant isolation test + a permission-denied test + (if branch-scoped) a 403 test.

## Tax — never inline a rate
Tax schemes are tenant-configured rows (`tax_profiles` + `tax_components`), seeded at provisioning, referenced by `branches.tax_profile_id`. Any module that computes or displays tax calls `TaxesService.getComponentsForBranch(branchId)` and feeds the components to `computeInvoiceTotals` from `@hayryou/shared`. Invoices must persist their computed `tax_breakdown` at sale time — profile edits never rewrite history. See docs/GLOBALIZATION.md §2.

## Gotchas
- JWT payload shape is `AccessTokenPayload` (`jwt-auth.guard.ts`); changing it invalidates active sessions and must stay in sync with `setRequestContext`.
- `nextBranchCode`-style sequential codes are count-based — fine at salon scale, revisit if concurrent creates become real.
- Global prefix is `api/v1` except `/healthz` and `/ready` (ALB/K8s probes).
- Swagger UI: http://localhost:4000/api/docs (zod schemas via `patchNestJsSwagger`).

# Keystone HR — Multi-Tenancy & Row-Level Security

> One-line summary: How tenant isolation actually works — JWT claims → nestjs-cls → transaction-local `set_config` via a Prisma client extension → Postgres RLS enforced on a non-owner role — and the traps (pooling, table ownership) that make naive versions leak.

`status:` **BUILT.** This entire mechanism ships in the foundation scaffold and was deliberately proven first (Risk 1 in [ARCHITECTURE.md](./ARCHITECTURE.md#7-risk-register)). What remains PLANNED is only applying it to future tables via the [checklist](#checklist-adding-a-new-tenant-table).

Related: [ARCHITECTURE.md](./ARCHITECTURE.md#5-request-lifecycle) · [DATA-MODEL.md](./DATA-MODEL.md) · [RBAC.md](./RBAC.md) (branch scoping is deliberately NOT here)

---

## Threat model

Single Postgres database, shared schema, `tenant_id` column on every tenant table. The failures we defend against:

| Threat | Defense |
| --- | --- |
| Developer forgets `where tenantId` in a query | RLS turns it into a zero-rows bug instead of a cross-tenant read. App code **still must filter** — RLS is defense-in-depth, not the primary filter. |
| Tenant context leaks between requests sharing a pooled connection | `set_config(..., is_local = true)` is transaction-scoped, discarded at COMMIT/ROLLBACK. Never session-level `SET`. See [the pooling trap](#the-pooling-trap). |
| RLS silently not applying because the app connects as the table owner | App connects as **non-owner** `hayryou_app`; migrations as owner `hayryou_migrator`; `FORCE ROW LEVEL SECURITY` on every table. See [non-owner role](#non-owner-role). |
| New table added without RLS | CI assertion fails the build. See [CI assertions](#ci-assertions). |
| Forged/absent tenant claim | `tenantId` comes only from a signature-verified JWT; if `app.tenant_id` is unset, the policy's `current_setting(...)::uuid` cast errors / matches nothing — fail closed. |
| Cross-tenant *writes* (inserting rows for another tenant) | Policies include `WITH CHECK`, not just `USING`. |

**Scope note:** branch-level scoping is an *authorization* concern, handled in the application layer ([RBAC.md](./RBAC.md#branch-scoping)) — **not** in RLS. RLS answers exactly one question: "does this row belong to this tenant?"

---

## Tenant context flow

### 1. JWT claims

```jsonc
{
  "sub": "<userId>",          // UUIDv7
  "tenantId": "<tenantId>",   // the only source of tenant identity
  "roleId": "<roleId>",
  "branchIds": ["<uuid>", ...] // or "*" when users.all_branches = true
}
```

### 2. nestjs-cls (AsyncLocalStorage)

`JwtAuthGuard` verifies the token and writes the claims into **nestjs-cls**. Every downstream consumer — guards, services, the Prisma extension, the pino logger (`tenantId`/`requestId` on every log line), the audit interceptor — reads context from CLS instead of having it passed as a parameter. There is no `tenantId` parameter drilling anywhere in the codebase.

```ts
// apps/api — reading context anywhere
const tenantId = this.cls.get('tenantId');
```

### 3. Prisma client extension — every single query

The tenant-aware Prisma client wraps **every** operation in a batch transaction that sets the tenant GUC first, transaction-locally:

```ts
// apps/api/src/prisma/tenant.extension.ts (shape)
export const tenantExtension = (cls: ClsService) =>
  Prisma.defineExtension((client) =>
    client.$extends({
      query: {
        $allModels: {
          async $allOperations({ args, query }) {
            const tenantId = cls.get('tenantId');
            if (!tenantId) throw new Error('No tenant context'); // fail closed
            const [, result] = await client.$transaction([
              client.$executeRaw`
                SELECT set_config('app.tenant_id', ${tenantId}, true)`,
              //                                              ^^^^ is_local:
              //           scoped to THIS transaction only — pooling-safe
              query(args),
            ]);
            return result;
          },
        },
      },
    }),
  );
```

Both statements run on the **same connection inside one transaction** (Prisma batch transaction), so the GUC is guaranteed visible to the query and guaranteed gone afterwards.

### 4. `withTenantTx()` — multi-statement business transactions

The extension above covers single operations. Any **multi-statement write** (POS checkout, appointment booking, stock transfer, GRN receipt — anything with more than one statement that must commit atomically) MUST use the helper, which opens one interactive transaction and does the same `set_config` first:

```ts
// apps/api/src/prisma/with-tenant-tx.ts (shape)
export async function withTenantTx<T>(
  prisma: PrismaService,
  tenantId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx);
  });
}
```

**Rules:**

- **ALWAYS** use `withTenantTx()` for multi-statement writes. Raw `prisma.$transaction([...])` or a bare interactive transaction without the `set_config` line will hit RLS with no tenant set and fail (closed — but still a bug).
- Inside the callback, use **only `tx`**, never the outer `prisma` client — a stray `prisma.x.create()` escapes the transaction (and gets its own auto-set GUC, but breaks atomicity).
- Pass `tenantId` from CLS at the call site; don't re-read CLS deep inside the callback.

---

## The pooling trap

Why the design insists on transaction-local config — the single most common way multi-tenant RLS is implemented wrong:

- **Session-level `SET app.tenant_id = ...` is unsafe.** Connections are pooled (Prisma's own pool now; PgBouncer later). A session-level GUC sticks to the *physical connection*. Request A (tenant X) sets it, finishes; the pool hands the same connection to request B (tenant Y); if B's set fails or a code path skips it, B reads tenant X's data. With PgBouncer in transaction mode it's worse: consecutive statements of one client can run on *different* server connections, so a session `SET` and the query it was meant to protect may not even share a connection.
- **`set_config(key, value, true)` / `SET LOCAL` is safe.** `is_local = true` scopes the setting to the current transaction; Postgres discards it at COMMIT or ROLLBACK. Because we set it *inside the same transaction as the query*, connection identity is guaranteed and cleanup is automatic — there is no state to leak.
- **PgBouncer transaction-mode compatible by construction.** Transaction mode's contract is "one transaction = one server connection, nothing survives between transactions". Since *everything* we do is transaction-scoped (both the batch-per-query extension and `withTenantTx()`), adding PgBouncer later requires zero application changes.

Grep-able rule: `SET app.tenant_id` (without `LOCAL` / without `is_local=true`) must never appear in this codebase.

---

## Non-owner role

**Postgres table owners bypass RLS by default — silently.** A superuser or table-owner connection runs every policy-protected query unfiltered, and nothing warns you. Two-role setup:

| Role | Used by | Rights |
| --- | --- | --- |
| `hayryou_migrator` | Prisma migrations (one-off ECS task before deploy) | Table **owner**; DDL. Never used by the running app. |
| `hayryou_app` | API + worker at runtime (`DATABASE_URL`) | **Non-owner**; `SELECT/INSERT/UPDATE/DELETE` grants only. RLS fully applies. |

Plus `FORCE ROW LEVEL SECURITY` on every tenant table, so even the owner (`hayryou_migrator`, or a maintenance script run with the wrong URL) is subject to policies. Belt and suspenders.

```sql
CREATE ROLE hayryou_migrator LOGIN PASSWORD '...';
CREATE ROLE hayryou_app      LOGIN PASSWORD '...';
GRANT USAGE ON SCHEMA public TO hayryou_app;
ALTER DEFAULT PRIVILEGES FOR ROLE hayryou_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO hayryou_app;
```

---

## RLS policy template

Migrations use `prisma migrate dev --create-only`, then the RLS SQL is **hand-written into the migration file** before applying. For every new tenant table:

```sql
-- === RLS: <table_name> (hand-written; required for every tenant_id table) ===
ALTER TABLE <table_name> ENABLE ROW LEVEL SECURITY;
ALTER TABLE <table_name> FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON <table_name>
  USING      (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
```

Notes:

- `USING` filters reads/updates/deletes; `WITH CHECK` blocks writing rows for another tenant. Both are required.
- If `app.tenant_id` is unset, `current_setting` raises (or with a `''` guard, matches nothing) — **fail closed** either way.
- Non-tenant tables (`tenants` itself, infrastructure tables) don't get a policy; they're the documented exceptions in the CI assertion.

---

## CI assertions

Two automated proofs run in CI on every PR (BUILT):

1. **Policy coverage assertion.** A script runs against the migrated test database and fails the build if any table with a `tenant_id` column lacks RLS enabled **and** forced:

```sql
SELECT c.relname AS offending_table
FROM pg_class c
JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id'
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND NOT (c.relrowsecurity AND c.relforcerowsecurity);
-- CI fails if this returns any rows
```

2. **Cross-tenant integration test.** Seeds two tenants (A, B), runs the API as tenant A, and asserts: list endpoints return zero tenant-B rows; direct-ID reads of tenant-B resources 404; writes carrying tenant-B foreign keys are rejected. The test connects as `hayryou_app` (non-owner) — running it as the owner would vacuously pass.

---

## Checklist: adding a new tenant table

1. `tenant_id uuid NOT NULL` column; relation in Prisma schema.
2. Composite indexes **lead with `tenant_id`** ([conventions](./DATA-MODEL.md#conventions)); tenant-scoped uniques are `UNIQUE(tenant_id, ...)`.
3. `prisma migrate dev --create-only`, then hand-write the [RLS block](#rls-policy-template) into the migration: ENABLE + FORCE + policy with USING **and** WITH CHECK.
4. Grants: covered by default privileges; verify `hayryou_app` can DML the table if the schema differs.
5. App code still filters by `tenantId` explicitly (defense-in-depth: RLS is the net, not the filter).
6. Multi-statement writes touching the table go through `withTenantTx()`.
7. Run CI locally: policy-coverage assertion + cross-tenant integration test must pass.
8. Branch scoping needed? That's app-layer — add `@BranchScoped()` / `getEffectiveBranchIds()` per [RBAC.md](./RBAC.md#branch-scoping), **not** an RLS policy.

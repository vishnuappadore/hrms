# packages/shared — the contract layer

Single source of truth consumed by BOTH apps/api (nestjs-zod DTOs) and apps/web (forms, display). **Zero runtime deps beyond zod** — never import Nest, React, or Prisma here.

## Contents
- `schemas/` — zod request/response schemas + inferred types. One file per domain. Every new API endpoint's shapes start HERE.
- `enums.ts` — status enums, state machines (`APPOINTMENT_TRANSITIONS`), `ERROR_CODES` (stable API error codes — clients switch on these).
- `permissions.ts` — `PERMISSIONS` catalog (`module.action`) + `SYSTEM_ROLES` seeded per tenant. There is NO permissions table; this file is it. Adding a permission = add key here → use in `@Permissions()` → (existing tenants' roles get it via a data migration if needed).
- `money.ts` — ALL money math. Integer minor units + ISO 4217 currency; per-currency exponents in `CURRENCY_EXPONENTS` (OMR=3, USD=2, JPY=0 — extend there when entering a market). `computeInvoiceTotals` is the canonical invoice formula; `percentOf` the single rounding rule (half-up at minor-unit precision). If you're writing `* rate / 100` anywhere else, stop and use this module. Never mix currencies in one calculation (docs/GLOBALIZATION.md).

## Rules
- Build before dependents need types: `pnpm --filter @hayryou/shared build` (turbo handles ordering in `pnpm dev`/`build`).
- Changing a schema is an API contract change — check both consumers compile (`pnpm typecheck` at root).
- Money tests include a property-based invariant (`money.test.ts`); extend it when adding financial functions.

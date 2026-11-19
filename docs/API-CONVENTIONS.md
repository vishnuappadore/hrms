# Keystone HR — API Conventions

> One-line summary: REST under `/api/v1` with zod-per-endpoint validation from `packages/shared`, a `{ data, meta }` pagination envelope, a fixed error shape with a shared error-code enum, idempotency keys on money endpoints, and an async export pattern.

`status:` **BUILT** — versioning, global ZodValidationPipe, error filter/shape, pagination envelope, OpenAPI generation (all exercised by the auth/users/branches endpoints). **PLANNED** — idempotency-key middleware (lands with POS, Phase 4), export pipeline (Phase 6), `packages/api-client` for mobile (deferred).

Related: [ARCHITECTURE.md](./ARCHITECTURE.md) · [RBAC.md](./RBAC.md) (guards on every endpoint) · [FRONTEND.md](./FRONTEND.md) (how the web app consumes all this via the BFF)

---

## Resource naming & versioning

- **URI versioning:** everything under **`/api/v1/`**. Breaking changes mean `/api/v2` (expected: never for MVP).
- Plural kebab-case nouns; standard verbs:

```
GET    /api/v1/branches               list (paginated)
POST   /api/v1/branches               create
GET    /api/v1/branches/:id           read
PATCH  /api/v1/branches/:id           partial update
DELETE /api/v1/branches/:id           delete (soft where DATA-MODEL says so)
GET    /api/v1/branches/:id/stock     nesting: ONE level max, ownership only
POST   /api/v1/pos/checkout           domain actions: verb under module prefix
POST   /api/v1/appointments/:id/cancel  state transitions: POST sub-action
POST   /api/v1/customers/export       export sibling (see below)
```

- IDs are UUIDv7 strings. No numeric ids in URLs.
- `tenantId` **never appears in URLs or bodies** — it comes from the JWT ([MULTI-TENANCY.md](./MULTI-TENANCY.md#tenant-context-flow)).

## Pagination, sorting, filtering

**Offset pagination** with a fixed envelope on every list endpoint:

```
GET /api/v1/customers?page=2&pageSize=25&sort=-createdAt&branchId=...&status=active
```

| Param | Rules |
| --- | --- |
| `page` | 1-based; default 1 |
| `pageSize` | default 25, **max 100** — enforced by the zod schema, not convention |
| `sort` | single field; `-` prefix = descending (`-createdAt`); allowed fields whitelisted per endpoint in its zod schema |
| filters | **flat query params** (`status=active&branchId=...`), each validated by the endpoint's zod schema. **No generic filter DSL** (no `filter[...]`, no operators-in-params) — locked decision; add a named param when a screen needs it |

Response envelope:

```jsonc
{
  "data": [ ... ],
  "meta": { "page": 2, "pageSize": 25, "total": 137 }
}
```

Single-resource endpoints return the object bare (no envelope).

## Validation — zod per endpoint

<a id="validation"></a>

Every request shape is a **zod schema in `packages/shared`**; NestJS consumes it via **nestjs-zod** with a **global `ZodValidationPipe`**. One schema serves the API pipe, the web form resolver ([FRONTEND.md](./FRONTEND.md#forms)), and OpenAPI generation.

```ts
// packages/shared/src/schemas/branch.ts  — the single source of truth
import { z } from 'zod';

export const createBranchSchema = z.object({
  nameEn: z.string().min(1).max(120),
  nameAr: z.string().min(1).max(120),
  type: z.enum(['corporate', 'franchise']),
  vatRate: z.number().min(0).max(100),      // numeric(5,2) in DB
  workingHours: workingHoursSchema,
});
export type CreateBranchInput = z.infer<typeof createBranchSchema>;
```

```ts
// apps/api/src/modules/branches/dto/create-branch.dto.ts
import { createZodDto } from 'nestjs-zod';
import { createBranchSchema } from '@hayryou/shared';

export class CreateBranchDto extends createZodDto(createBranchSchema) {}
// Controller uses @Body() dto: CreateBranchDto — the global ZodValidationPipe
// parses/rejects; nestjs-zod's patchNestJsSwagger() emits it into OpenAPI.
```

Query params get the same treatment (`createZodDto(listCustomersQuerySchema)`); this is where `pageSize.max(100)` and the sort-field whitelist are enforced.

## Errors

<a id="errors"></a>

One shape for every non-2xx response, produced by a global exception filter:

```jsonc
{
  "statusCode": 409,
  "code": "CUSTOMER_MOBILE_EXISTS",   // machine-readable, stable
  "message": "A customer with this mobile number already exists.",
  "details": { "mobile": "+9689xxxxxxx" }   // optional, structured
}
```

- **`code` is the contract.** Clients switch on `code`, never parse `message`. The **error-code enum lives in `packages/shared`** and is mapped to localized (EN/AR) messages in the web app — the API's `message` is a developer-facing English default.
- Naming: `SCREAMING_SNAKE`, specific (`CUSTOMER_MOBILE_EXISTS`, `APPOINTMENT_SLOT_TAKEN`, `INSUFFICIENT_STOCK`, `IDEMPOTENT_REPLAY`), plus generic fallbacks (`VALIDATION_ERROR` — zod issues in `details`, `UNAUTHORIZED`, `FORBIDDEN_PERMISSION`, `FORBIDDEN_BRANCH`, `NOT_FOUND`, `INTERNAL`).
- Adding an endpoint that can fail a new way = adding a code to the shared enum + AR/EN messages in the web locale files, same PR.

## Idempotency — POS & payments (PLANNED, Phase 4)

Money-moving endpoints (`pos/checkout`, payment capture) require an **`Idempotency-Key`** header (client-generated UUID per logical attempt):

1. API does Redis `SETNX idem:{tenantId}:{key}` with **24 h TTL**.
2. First arrival: process normally; store the response against the key.
3. Duplicate (double-tap, network retry, BFF retry-after-401): return the **stored original response** — no second invoice, no double stock deduction.
4. Missing header on these endpoints → `VALIDATION_ERROR`.

This pairs with Risk 2 in [ARCHITECTURE.md](./ARCHITECTURE.md#7-risk-register): retries are *expected*; idempotency makes them safe.

## Exports (PLANNED, Phase 6)

Every list endpoint that needs export gets a **sibling `POST /export`** accepting the **same zod filter schema** plus `format: 'csv' | 'xlsx' | 'pdf'`:

```
POST /api/v1/customers/export   { ...same filters as GET list..., format: "xlsx" }
```

Two paths by size:

- **Small result set → synchronous stream**: response is the file itself (`Content-Disposition: attachment`).
- **Large → BullMQ job** on the `exports` queue: respond `202 { jobId }`; worker builds the file, uploads to S3 (`tenants/{tenantId}/exports/...`); client **polls `GET /api/v1/exports/:jobId`** → `{ status: 'pending' | 'done' | 'failed', url? }` where `url` is a short-lived **S3 presigned GET**. Bytes never proxy through the API.

Libraries: **exceljs** (xlsx), **csv-stringify**, **pdfmake** with **Noto Naskh Arabic embedded** for Arabic PDFs — no Puppeteer on Fargate (memory/cold-start cost). The shared DataTable's export button targets this endpoint ([FRONTEND.md](./FRONTEND.md#component-conventions)).

## OpenAPI & the future mobile client

- Spec generated by **`@nestjs/swagger`** + **nestjs-zod's `patchNestJsSwagger()`**, so zod DTOs render real schemas. Served at `/api/docs` in non-prod; JSON exportable in CI.
- **Mobile (deferred):** generate a typed client with **openapi-typescript** (types) + **openapi-fetch** (runtime) into **`packages/api-client`**. Mobile calls the API **directly with Bearer tokens** — no BFF ([FRONTEND.md](./FRONTEND.md#bff-auth) explains why). Because the OpenAPI spec derives from the same shared zod schemas, web, API, and mobile can never disagree about a payload shape.

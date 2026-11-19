# Local Development — setup, quirks, troubleshooting

## Prerequisites & first run

```bash
docker compose up -d        # postgres:16, redis, mailpit (SMTP UI :8025), minio
pnpm install                # pnpm may live at ~/Library/pnpm/pnpm if not on PATH
cp .env.example apps/api/.env
echo 'API_URL=http://localhost:4000' > apps/web/.env.local
pnpm db:migrate             # prisma migrate deploy (owner connection)
pnpm db:seed                # demo tenant (idempotent)
pnpm dev                    # api :4000 (swagger /api/docs) + web :3000 + BullMQ worker
```

`pnpm dev` runs the BullMQ worker (`apps/api/src/worker.ts`, via `tsx watch` — see
`dev:worker` in `apps/api/package.json` and the `dev dev:worker` tasks turbo runs)
alongside the API and web, so scheduled jobs (currently: `heartbeat`, and
`leave-accrual` nightly at 01:00 UTC) actually fire locally instead of only in a
built/deployed worker (`start:worker`, `node dist/worker.js`). It needs Redis,
so make sure `docker compose up -d` includes it.

Demo login: `admin@demo.hayryou` / `Admin@12345` (Super Admin, all branches).
Auth-gated pages redirect to `/en/login`; locale lives in the URL (`/en/…`, `/ar/…`).

## Checks (run before any PR)

```bash
pnpm lint              # includes scripts/check-rtl.mjs — FAILS on ml-/mr-/pl-/pr- classes
pnpm typecheck         # shared schema changes must compile in BOTH apps
pnpm test              # unit
pnpm test:integration  # needs docker services; includes the RLS isolation suite
```

After editing `packages/shared`: `pnpm --filter @hayryou/shared build` before
dependents typecheck (turbo orders this automatically in `pnpm dev`/`pnpm build`).

## Known machine/network quirks (macOS dev machine, 2026-07)

### pnpm install times out (ETIMEDOUT to registry.npmjs.org)
Node's happy-eyeballs (`net` `autoSelectFamily`, default **true**) hangs on this
network (broken IPv6 path) while plain IPv4 and `curl` work. The standalone pnpm
binary (`~/Library/pnpm/pnpm`) **ignores NODE_OPTIONS**, so the fix is to run
pnpm's JS dist under system node with autoselection disabled:

```bash
curl -sL -o /tmp/pnpm.tgz https://registry.npmjs.org/pnpm/-/pnpm-9.15.9.tgz
tar xzf /tmp/pnpm.tgz -C /tmp
node --no-network-family-autoselection /tmp/package/bin/pnpm.cjs --filter <pkg> add <dep>
```

Non-network pnpm commands (dev/lint/typecheck/test) work fine with the normal binary.

### Payroll payslip PDFs need a non-Alpine API image
`apps/api/src/modules/payroll/payslip-pdf.service.ts` renders payslips via
headless Chromium (Playwright) for correct Arabic text shaping. Playwright's
bundled Chromium **does not support Alpine/musl** — `apps/api/Dockerfile` is
currently `node:22-alpine`, which will NOT run the payslip PDF endpoint in
production as-is. Before deploying this feature: switch the runtime stage to
a glibc-based image (e.g. `node:22-bookworm-slim` or
`mcr.microsoft.com/playwright:v1.62.1-noble`) and install Chromium's system
deps (`pnpm exec playwright install --with-deps chromium` at build time) plus
an Arabic-capable font package (e.g. `fonts-noto`) so glyphs actually exist on
disk. Locally on macOS this isn't an issue — `pnpm exec playwright install
chromium` just works. This is deliberately left as a follow-up rather than
silently changing the production base image.

### Webfonts: never use next/font/google
`next/font/google` downloads fonts at build time via node fetch — same broken
network path, the build fails. Fonts are **committed woff2 files** in
`apps/web/src/fonts/` loaded with `next/font/local` ([locale]/layout.tsx). To add
a font: fetch the woff2 with `curl` from the Google Fonts css2 endpoint (browser
User-Agent required) and commit it.

### `prisma migrate reset` breaks the app afterward (permission denied for schema public)
`npx prisma migrate reset --force` (full wipe + replay, run from `apps/api/`) drops
and recreates the `public` schema object itself. That silently drops the
one-time `GRANT USAGE ON SCHEMA public TO hayryou_app` from
`scripts/init-db.sql` — that script only runs on the Postgres container's
**first** boot, so it never re-applies after a reset. The table-level grants
(`ALTER DEFAULT PRIVILEGES FOR ROLE hayryou_migrator ...`) survive fine since
those are bound to the role, not the schema object — so only schema-level
`USAGE` goes missing. Symptom: every tenant-scoped endpoint (e.g. `/users`,
`/branches`) 500s with `permission denied for schema public` (Postgres code
`42501`) even right after a clean `pnpm db:seed`, while `/auth/login` still
works (it goes through `AuthPrismaService`, the RLS-bypass owner connection,
not `hayryou_app`). Fix after every `prisma migrate reset`:

```bash
docker compose exec -T postgres psql -U hayryou_migrator -d hayryou \
  -c "GRANT USAGE ON SCHEMA public TO hayryou_app;"
```

Then restart `pnpm dev` (or just the API) so it opens fresh connections.

## Conventions that bite if you don't know them

- **Never commit to `main`** — `docs/GIT-WORKFLOW.md`. No AI co-author trailers in
  commit messages (owner preference). Squash-merge; don't stack branches on
  unmerged squash targets (the second squash-merge conflicts — merge bottom-up).
- **RTL**: Tailwind logical properties only; every screen tested at `/ar/…`.
  Directional lucide icons get `rtl:rotate-180`.
- **Theming**: semantic tokens only (`bg-card`, `text-muted-foreground`, …) defined
  in `apps/web/src/app/globals.css`; two brand palettes (green default, amber via
  `data-brand`); any new token pair must pass WCAG AA — validate computationally
  (contrast formula script), don't eyeball. See apps/web/CLAUDE.md → Theming.
- **i18n**: every user-facing string keyed in BOTH `en.json` and `ar.json`.
- **NestJS route order**: static segments (e.g. `GET /branches/stats`) must be
  declared BEFORE `:param` routes in the controller or the param route captures them.
- **Integration tests** share one DB, run serially, and provision isolated tenants
  via `provisionTenant(app)` (`apps/api/test/helpers.ts`) — never reuse seed data.
- **Prisma P2002 in interactive transactions** may not carry `meta.target` — do
  explicit duplicate pre-checks for precise conflict codes (see users.service.ts).

## Service URLs (local)

| Service | URL |
|---|---|
| Web | http://localhost:3000 |
| API + Swagger | http://localhost:4000 · /api/docs |
| Mailpit (email UI) | http://localhost:8025 |
| MinIO console | http://localhost:9001 |

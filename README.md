# Keystone HR

Multi-tenant salon management SaaS — Next.js + NestJS + PostgreSQL (RLS) monorepo. Bilingual EN/AR (RTL), built for the Oman/GCC market (OMR, 3 decimals).

> New to the codebase (human or AI)? Start with **[ONBOARDING.md](ONBOARDING.md)**.

## Quick start

```bash
# prerequisites: Node ≥22, pnpm 9, Docker
docker compose up -d          # postgres, redis, mailpit (:8025), minio (:9001)
pnpm install
cp .env.example apps/api/.env
echo 'API_URL=http://localhost:4000' > apps/web/.env.local
pnpm db:migrate && pnpm db:seed
pnpm dev
```

- Web: http://localhost:3000 → login `admin@demo.hayryou` / `Admin@12345` (try `/ar/login` for Arabic)
- API: http://localhost:4000/api/v1 · Swagger: http://localhost:4000/api/docs

## Tests

```bash
pnpm test               # unit
pnpm test:integration   # real Postgres/Redis — includes the tenant-isolation (RLS) suite
```

## Documentation

| Doc | Purpose |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design, request lifecycle, risks |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Build order & deferrals |
| [docs/DATA-MODEL.md](docs/DATA-MODEL.md) | Full ~40-table model |
| [docs/GLOBALIZATION.md](docs/GLOBALIZATION.md) | Multi-market rules (currency, tax, locale, providers) |
| [docs/MULTI-TENANCY.md](docs/MULTI-TENANCY.md) | RLS + pooling deep dive |
| [docs/RBAC.md](docs/RBAC.md) | Permissions & branch scoping |
| [docs/API-CONVENTIONS.md](docs/API-CONVENTIONS.md) | REST conventions |
| [docs/FRONTEND.md](docs/FRONTEND.md) | Web app patterns, RTL rules |
| [docs/INFRA.md](docs/INFRA.md) | AWS design (not yet applied) |
| [docs/MODULES/](docs/MODULES/) | Product requirements per module |

`CLAUDE.md` files (root, apps/api, apps/web, packages/shared, infra) carry working conventions for AI-assisted development.

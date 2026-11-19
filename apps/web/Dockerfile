# Build from repo root: docker build -f apps/web/Dockerfile .
FROM node:22-alpine AS base
RUN corepack enable pnpm
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages/config/package.json packages/config/
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @hayryou/web...
COPY packages ./packages
COPY apps/web ./apps/web
COPY scripts ./scripts
RUN pnpm --filter @hayryou/shared build && pnpm --filter @hayryou/web build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
USER 1000:1000
# Next standalone output = minimal runtime (no node_modules install)
COPY --from=build --chown=1000:1000 /repo/apps/web/.next/standalone ./
COPY --from=build --chown=1000:1000 /repo/apps/web/.next/static ./apps/web/.next/static
EXPOSE 3000
CMD ["node", "apps/web/server.js"]

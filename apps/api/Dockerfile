# Build from repo root: docker build -f apps/api/Dockerfile .
# Same image runs api (default CMD) and worker (CMD ["node","dist/worker.js"]).
FROM node:22-alpine AS base
RUN corepack enable pnpm
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages/config/package.json packages/config/
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @keystonehr/api...
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm --filter @keystonehr/shared build \
  && pnpm --filter @keystonehr/api db:generate \
  && pnpm --filter @keystonehr/api build \
  && pnpm --filter @keystonehr/api --prod deploy /out \
  # Regenerate the Prisma client INTO the pruned deploy output — `pnpm --prod deploy`
  # rebuilds node_modules from the store and drops the client generated above.
  && cd /out && ./node_modules/.bin/prisma generate

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
# Prisma's query engine needs openssl at runtime on Alpine.
RUN apk add --no-cache openssl
WORKDIR /app
# non-root numeric UID — K8s runAsNonRoot compatible
USER 1000:1000
COPY --from=build --chown=1000:1000 /out ./
EXPOSE 4000
CMD ["node", "dist/main.js"]

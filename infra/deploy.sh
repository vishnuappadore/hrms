#!/usr/bin/env bash
# One idempotent deploy path, used both by the EC2 instance's first-boot user_data AND every
# later redeploy triggered via `aws ssm send-command`. Never hand-run with different logic
# in two places — if this script changes, both call sites pick it up automatically.
#
# Expects /opt/keystone-hr/config.env to already exist (written once by Terraform's
# user_data, never by this script) with: AWS_REGION, PROJECT, ENVIRONMENT, ECR_REGISTRY,
# ECR_API_REPO, ECR_WEB_REPO, SSM_PREFIX.
set -uo pipefail

APP_DIR=/opt/keystone-hr
cd "$APP_DIR" || { echo "missing $APP_DIR"; exit 1; }
# shellcheck disable=SC1091
source ./config.env

log() { echo "[deploy $(date -u +%FT%TZ)] $*"; }

log "ECR login"
if ! aws ecr get-login-password --region "$AWS_REGION" \
    | docker login --username AWS --password-stdin "$ECR_REGISTRY" >/dev/null; then
  log "ECR login failed — continuing in case this is a pre-first-push bootstrap boot"
fi

log "fetching secrets from SSM ($SSM_PREFIX)"
ssm_get() {
  aws ssm get-parameter --region "$AWS_REGION" --name "$SSM_PREFIX/$1" --with-decryption \
    --query Parameter.Value --output text 2>/dev/null
}
DB_PASSWORD=$(ssm_get db_password)
JWT_ACCESS_SECRET=$(ssm_get jwt_access_secret)
JWT_REFRESH_SECRET=$(ssm_get jwt_refresh_secret)
S3_ACCESS_KEY=$(ssm_get s3_access_key_id)
S3_SECRET_KEY=$(ssm_get s3_secret_access_key)
S3_UPLOADS_BUCKET=$(ssm_get s3_uploads_bucket)

if [ -z "$DB_PASSWORD" ]; then
  log "FATAL: could not read secrets from SSM ($SSM_PREFIX/db_password) — check the instance role's ssm:GetParameter permission"
  exit 1
fi

# One secrets file for both the api and worker containers (docker-compose.prod.yml's
# `env_file: .env`). S3_ENDPOINT is deliberately omitted: unset means the AWS SDK builds the
# real regional S3 endpoint from S3_REGION, instead of the MinIO endpoint dev uses.
cat > "$APP_DIR/.env" <<EOF
DATABASE_URL=postgresql://keystonehr:${DB_PASSWORD}@postgres:5432/keystonehr
REDIS_URL=redis://redis:6379
JWT_ACCESS_SECRET=${JWT_ACCESS_SECRET}
JWT_REFRESH_SECRET=${JWT_REFRESH_SECRET}
JWT_ACCESS_TTL=900
JWT_REFRESH_TTL=2592000
API_PORT=4000
NODE_ENV=production
S3_REGION=${AWS_REGION}
S3_ACCESS_KEY=${S3_ACCESS_KEY}
S3_SECRET_KEY=${S3_SECRET_KEY}
S3_UPLOADS_BUCKET=${S3_UPLOADS_BUCKET}
# No outbound email provider wired up yet (known gap in the minimum tier) — forgot/reset
# password flows will only log their token server-side until real SMTP (e.g. AWS SES) is
# added here and in the app's mailer config.
SMTP_HOST=
SMTP_PORT=
MAIL_FROM=noreply@keystonehr.local
API_URL=http://api:4000
DOMAIN=${DOMAIN:-}
# NODE_ENV=production above would otherwise mark session cookies Secure, which browsers
# silently refuse to store over this tier's plain-HTTP (no DOMAIN yet). Explicit "false"
# here only; once a real domain/TLS is configured this line is omitted entirely and
# web/session.ts's own default (secure when NODE_ENV=production) takes back over.
$( [ -z "${DOMAIN:-}" ] && echo "COOKIE_SECURE=false" )
EOF
chmod 600 "$APP_DIR/.env"

log "refreshing docker-compose.prod.yml / Caddyfile from s3://$S3_BUCKET/deploy/"
aws s3 cp "s3://$S3_BUCKET/deploy/docker-compose.prod.yml" "$APP_DIR/docker-compose.prod.yml" --region "$AWS_REGION" \
  || log "no deploy manifest in S3 yet — using the copy baked in at instance launch"
aws s3 cp "s3://$S3_BUCKET/deploy/Caddyfile" "$APP_DIR/Caddyfile" --region "$AWS_REGION" \
  || log "no Caddyfile in S3 yet — using the copy baked in at instance launch"

export ECR_REGISTRY ECR_API_REPO ECR_WEB_REPO
export IMAGE_TAG="${IMAGE_TAG:-latest}"
export DB_PASSWORD
export DOMAIN="${DOMAIN:-}"
# Resolved here, not left to Caddy's own "{$VAR:default}" placeholder — docker-compose
# always SETS the container's DOMAIN env var (just to "" when var.domain_name is empty),
# and Caddy's placeholder default only fires on a truly-UNSET var, not a set-but-empty one.
export SITE_ADDRESS="${DOMAIN:-:80}"

log "docker compose pull"
docker compose -f "$APP_DIR/docker-compose.prod.yml" --env-file "$APP_DIR/.env" pull \
  || log "pull failed — likely no image pushed yet; will still try to (re)start whatever's cached"

log "docker compose up -d"
if ! docker compose -f "$APP_DIR/docker-compose.prod.yml" --env-file "$APP_DIR/.env" up -d --remove-orphans; then
  log "FATAL: docker compose up failed"
  exit 1
fi

log "waiting for the api container to accept connections before migrating"
for _ in $(seq 1 30); do
  if docker compose -f "$APP_DIR/docker-compose.prod.yml" exec -T api true 2>/dev/null; then
    break
  fi
  sleep 2
done

log "applying pending Prisma migrations"
docker compose -f "$APP_DIR/docker-compose.prod.yml" exec -T api ./node_modules/.bin/prisma migrate deploy \
  || log "WARNING: prisma migrate deploy failed — check logs, app may be running against a stale schema"

log "pruning dangling images"
docker image prune -f >/dev/null

log "done"

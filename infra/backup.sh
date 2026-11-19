#!/usr/bin/env bash
# Nightly Postgres backup → S3. Installed as a cron job by user_data (see
# modules/app-server/templates/user_data.sh.tpl) — not optional even at the "minimum" tier,
# since this box has no managed-RDS automated backups behind it.
set -uo pipefail

APP_DIR=/opt/keystone-hr
cd "$APP_DIR" || exit 1
# shellcheck disable=SC1091
source ./config.env

log() { echo "[backup $(date -u +%FT%TZ)] $*"; }

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT_DIR=/data/backups
OUT_FILE="$OUT_DIR/keystonehr-${STAMP}.sql.gz"
mkdir -p "$OUT_DIR"

log "dumping postgres"
if ! docker compose -f "$APP_DIR/docker-compose.prod.yml" exec -T postgres \
    pg_dump -U keystonehr keystonehr | gzip > "$OUT_FILE"; then
  log "FATAL: pg_dump failed"
  rm -f "$OUT_FILE"
  exit 1
fi

log "uploading to s3://$S3_BUCKET/backups/"
if ! aws s3 cp "$OUT_FILE" "s3://$S3_BUCKET/backups/$(basename "$OUT_FILE")" --region "$AWS_REGION"; then
  log "FATAL: upload failed, keeping local copy"
  exit 1
fi

# Keep 3 days of local copies on the data volume (cheap recovery without touching S3), rely
# on the S3 lifecycle rule (see modules/platform) to expire the remote copies after 30 days.
find "$OUT_DIR" -name 'keystonehr-*.sql.gz' -mtime +3 -delete

log "done: $OUT_FILE"

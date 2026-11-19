#!/usr/bin/env bash
# Amazon Linux 2023. Installs Docker + the compose plugin + awscli, mounts the data EBS
# volume, seeds /opt/keystone-hr with the files baked in at launch (overwritten by every
# real CI deploy from S3 afterward), then delegates to the SAME deploy.sh every later
# redeploy uses via SSM. Idempotent: safe to re-run (reboot, instance replace) without
# reformatting the data volume or clobbering anything already running.
set -uo pipefail
exec > >(tee -a /var/log/keystonehr-user-data.log) 2>&1
echo "=== user_data start: $(date -u) ==="

dnf install -y docker jq unzip >/dev/null
systemctl enable --now docker
usermod -aG docker ec2-user || true

if ! docker compose version >/dev/null 2>&1; then
  mkdir -p /usr/local/lib/docker/cli-plugins
  ARCH=$(uname -m)
  curl -fsSL "https://github.com/docker/compose/releases/download/v2.29.7/docker-compose-linux-$ARCH" \
    -o /usr/local/lib/docker/cli-plugins/docker-compose
  chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
fi

if ! command -v aws >/dev/null 2>&1; then
  curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-$(uname -m).zip" -o /tmp/awscliv2.zip
  (cd /tmp && unzip -q awscliv2.zip && ./aws/install)
fi

# ── Data volume: format once, mount by UUID, never reformat on re-run ───────────────────
DATA_DEV=/dev/nvme1n1
[ -b "$DATA_DEV" ] || DATA_DEV=/dev/xvdf
for _ in $(seq 1 15); do [ -b "$DATA_DEV" ] && break; sleep 2; done

if [ -b "$DATA_DEV" ]; then
  if ! blkid "$DATA_DEV" >/dev/null 2>&1; then
    echo "formatting $DATA_DEV (first boot only)"
    mkfs.ext4 -L keystonehr-data "$DATA_DEV"
  fi
  mkdir -p /data
  UUID=$(blkid -s UUID -o value "$DATA_DEV")
  grep -q "$UUID" /etc/fstab || echo "UUID=$UUID /data ext4 defaults,nofail 0 2" >> /etc/fstab
  mount -a
else
  echo "WARNING: data volume device not found — /data will NOT be persistent" >&2
fi
mkdir -p /data/postgres /data/redis /data/caddy/data /data/caddy/config /data/backups

# ── App directory: seed from what Terraform baked in; later deploys overwrite from S3 ───
mkdir -p /opt/keystone-hr
echo "${config_env_b64}"    | base64 -d > /opt/keystone-hr/config.env
if [ ! -f /opt/keystone-hr/deploy.sh ]; then
  echo "${deploy_script_b64}" | base64 -d > /opt/keystone-hr/deploy.sh
fi
if [ ! -f /opt/keystone-hr/backup.sh ]; then
  echo "${backup_script_b64}" | base64 -d > /opt/keystone-hr/backup.sh
fi
if [ ! -f /opt/keystone-hr/docker-compose.prod.yml ]; then
  echo "${compose_file_b64}" | base64 -d > /opt/keystone-hr/docker-compose.prod.yml
fi
if [ ! -f /opt/keystone-hr/Caddyfile ]; then
  echo "${caddyfile_b64}" | base64 -d > /opt/keystone-hr/Caddyfile
fi
chmod +x /opt/keystone-hr/deploy.sh /opt/keystone-hr/backup.sh

# Nightly backup, 02:00 UTC (after the leave-accrual job's 01:00 UTC run).
cat > /etc/cron.d/keystonehr-backup <<'CRON'
0 2 * * * root /opt/keystone-hr/backup.sh >> /var/log/keystonehr-backup.log 2>&1
CRON

echo "=== running initial deploy.sh ==="
/opt/keystone-hr/deploy.sh || echo "initial deploy.sh exited non-zero — expected if no image has been pushed to ECR yet; re-run via SSM once CI has deployed"

echo "=== user_data done: $(date -u) ==="

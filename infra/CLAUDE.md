# infra — AWS, single-EC2 "minimum configuration" tier

One EC2 instance (`t4g.small`) runs everything — `api`, `web`, `worker`, Postgres, Redis,
Caddy — via Docker Compose. No ALB, no RDS, no ElastiCache, no NAT Gateway. Target cost:
~$20-25/month. See `README-bootstrap.md` for first-time setup.

## Apply model

- **Humans apply**, via AWS IAM Identity Center (SSO) credentials, from their own machine.
- **CI never applies Terraform.** GitHub Actions only builds/pushes Docker images, uploads
  the deploy manifests to S3, and triggers `deploy.sh` on the instance via SSM — it has no
  Terraform-apply permissions at all (check `modules/github-oidc`'s policy if you ever doubt
  this).
- There is only one environment (`envs/prod`) at this tier. Don't add a staging environment
  until the app's usage actually justifies the doubled cost — this tier is deliberately
  minimal.

## The two invariants

1. **Region is always a variable, never hardcoded.** Every module takes `region`/reads it
   through a passed-in value; `envs/prod/variables.tf`'s `region` (default `ap-south-1`) is
   the single source of truth. The GitHub Actions workflow's `AWS_REGION` env var must be kept
   in sync with it by hand (workflows can't read Terraform variables directly).
2. **No inbound SSH, ever.** The security group in `modules/network` has no port 22 rule, full
   stop. The instance is reached only via `aws ssm start-session` (the instance role's
   `AmazonSSMManagedInstanceCore` policy is what makes that possible). If you ever find
   yourself wanting to open port 22 "just this once," don't — fix whatever SSM access problem
   you're hitting instead.

## Day-2 operations

- **Redeploy**: push to `main` (or run the "Deploy to production" workflow manually). This is
  the only sanctioned path — don't hand-edit files on the instance and expect them to survive
  the next deploy; they'll be overwritten from S3's `deploy/` prefix and the freshly-pulled
  images.
- **Check logs**: `aws ssm start-session --target <instance_id>`, then
  `sudo docker compose -f /opt/keystone-hr/docker-compose.prod.yml logs -f [api|web|worker|postgres|redis|caddy]`.
- **Backups**: `backup.sh` runs nightly at 02:00 UTC via cron (installed by `user_data`),
  `pg_dump`s Postgres, gzips it to `/data/backups/`, and uploads to
  `s3://<app bucket>/backups/`. Local copies are pruned after 3 days; S3 copies expire after
  30 days (see `modules/platform`'s lifecycle rule). This is NOT optional at this tier — there
  is no managed-RDS automated backup behind this box, so if `backup.sh` is ever broken,
  there is no other safety net. Restore: `gunzip -c <dump> | docker compose exec -T postgres psql -U keystonehr keystonehr`.
- **Adding a real domain**: see `README-bootstrap.md`'s last section — it's a two-variable
  change plus one manual step (updating `config.env`'s `DOMAIN=` on the instance, since
  `user_data` only runs once at launch).
- **Rotating secrets**: update the relevant `aws_ssm_parameter` resource's value in
  `modules/platform` (or just rotate via `terraform apply` with a tainted `random_password`
  resource) and trigger a redeploy — `deploy.sh` re-reads SSM on every run.

## Known gaps at this tier (intentional, not oversights)

- **No outbound email.** `SMTP_HOST`/`SMTP_PORT` are blank in `deploy.sh`'s generated `.env` —
  forgot/reset-password flows will only log their token server-side until a real provider
  (e.g. AWS SES, which is cheap and would fit fine at this tier) is wired in.
- **`StorageService` (apps/api) always builds its S3 client from explicit
  `S3_ACCESS_KEY`/`S3_SECRET_KEY` env vars**, not the instance's IAM role credential chain —
  so `modules/platform` provisions a narrowly-scoped IAM user + access key for this purpose
  instead of relying purely on instance-profile credentials. The cleaner fix is an app-code
  change (fall back to the default AWS credential provider chain when those env vars are
  absent) — out of scope for this infra work, worth doing eventually.
- **No HA.** Single instance, single AZ, single Postgres container. An instance failure means
  downtime until it's replaced (the data EBS volume survives and can be reattached; the root
  volume/AMI does not carry state). Acceptable for one company's internal HR tool; not
  acceptable if this ever needs to serve multiple customers or tolerate real outages.

## When to outgrow this tier

If uptime requirements, employee count, or feature load (e.g. wiring up the `notifications`/
`exports` BullMQ queues for real) outgrow a single box, the next step is the "Option B"
managed-services tier discussed when this was costed out: ECS Fargate (api/web/worker as
separate tasks) + RDS Postgres + an ALB, optionally ElastiCache if BullMQ's queue workload
grows beyond what a single Redis container handles comfortably. That tier costs roughly 3-4x
this one (~$75-90/month) — don't move to it preemptively.

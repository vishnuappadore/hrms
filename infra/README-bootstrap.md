# Keystone HR — AWS bootstrap (single-EC2 "minimum configuration" tier)

Target cost: ~$20-25/month. One EC2 instance runs everything (api, web, worker, Postgres,
Redis, Caddy) via Docker Compose. No ALB, no RDS, no ElastiCache, no NAT. See `infra/CLAUDE.md`
for the architecture rationale and what changes if you outgrow this tier.

You need: an AWS account, AWS IAM Identity Center (SSO) access with permissions to create the
resources below, the AWS CLI configured locally (`aws configure sso`), and Terraform ≥ 1.10.

## 0. One-time AWS account setup

1. If you don't already have an AWS account for this, create one.
2. Set up IAM Identity Center (SSO) and give yourself (or whoever applies Terraform) a
   permission set with enough access to create VPC/EC2/IAM/S3/ECR/SSM/Route53 resources
   (`AdministratorAccess` is simplest for a single small account; narrow it later if you want).
3. `aws configure sso` locally, then `aws sts get-caller-identity` to confirm it works.
4. Confirm `me-central-1` (UAE/Dubai) is enabled for your account — it's an opt-in region for
   older accounts. If `aws ec2 describe-regions --region me-central-1` errors, enable it in
   the AWS Console under Account → AWS Regions first.

## 1. Bootstrap the Terraform state bucket (chicken-and-egg step)

The bucket that stores `envs/prod`'s state can't be created by the Terraform it stores state
for, so this is a separate, local-state, apply-once config.

```bash
cd infra/bootstrap
terraform init
terraform apply \
  -var="region=me-central-1" \
  -var="bucket_name=keystonehr-tfstate-<pick-something-globally-unique>"
terraform output -raw bucket_name
```

Copy that bucket name into `infra/envs/prod/backend.tf`'s `bucket = "..."` line, replacing
`REPLACE_ME_keystonehr_tfstate_bucket_name`.

## 2. Fill in the required variables

```bash
cd ../envs/prod
cp terraform.tfvars.example terraform.tfvars
```

Edit `terraform.tfvars`: set `github_repo` to the real `owner/repo` slug once you've pushed
this repo to GitHub (e.g. `acme-corp/keystone-hr`). Leave `domain_name`/`route53_zone_id`
empty for now — see the "adding a domain later" section at the bottom.

## 3. First apply

```bash
terraform init
terraform plan   # review what it's about to create
terraform apply
```

This creates: the VPC/subnet/security group, the EC2 instance + its two EBS volumes + Elastic
IP, the two ECR repos, the app S3 bucket, the SSM secrets (generated server-side — you never
type a password), and the GitHub OIDC deploy role. The instance's `user_data` installs Docker
and brings up the compose stack immediately — but since no image has been pushed to ECR yet,
`api`/`web`/`worker` will fail to start on this very first boot. That's expected; the next
steps fix it.

Note the outputs:

```bash
terraform output
```

You'll need `instance_id`, `ecr_api_repository_url`/`ecr_web_repository_url`,
`app_bucket_name`, and `github_deploy_role_arn`.

## 4. Wire up GitHub Actions

In the GitHub repo's Settings → Secrets and variables → Actions → **Variables** tab (not
Secrets — none of these are sensitive), add:

- `AWS_DEPLOY_ROLE_ARN` = the `github_deploy_role_arn` output
- `APP_SERVER_INSTANCE_ID` = the `instance_id` output
- `APP_BUCKET_NAME` = the `app_bucket_name` output

Push to `main` (or run the "Deploy to production" workflow manually via `workflow_dispatch`).
This builds the `api`/`web` images, pushes them to ECR, uploads the deploy manifests to S3,
and triggers `/opt/keystone-hr/deploy.sh` on the instance via SSM — the same script
`user_data` ran on first boot, so there's exactly one deploy code path.

## 5. One-time database seed

The first deploy applies Prisma migrations automatically (`deploy.sh`'s last step), but
seeding demo/initial data is a deliberate one-time manual action, not part of every deploy:

```bash
aws ssm start-session --target <instance_id>
# inside the session:
sudo docker compose -f /opt/keystone-hr/docker-compose.prod.yml --env-file /opt/keystone-hr/.env \
  exec api node dist/database/seed.js
```

Check `apps/api/src/database/seed.ts` for exactly what this creates (company settings, the 5
default roles, demo branches/users) — you'll likely want to replace the demo data with your
real company/branch/employee records once the app is reachable, or write a leaner
production-only seed that only creates the Super Admin login and skips the demo branches.

## 6. Connecting to the box (no SSH, ever)

```bash
aws ssm start-session --target <instance_id>
```

Logs: `sudo docker compose -f /opt/keystone-hr/docker-compose.prod.yml logs -f [service]`.
User-data log (first boot): `/var/log/keystonehr-user-data.log`. Backup log:
`/var/log/keystonehr-backup.log`.

## 7. Using the app before you have a domain

Visit `http://<elastic_ip>` (the `elastic_ip` output). Plain HTTP, no TLS yet — fine for an
initial smoke test, not for real use with real employee data over the open internet.

## 8. Adding a real domain later

Once you have a domain (bought through Route 53 or elsewhere):

1. If the zone is in Route 53: note its hosted zone id. If it's elsewhere, create an A record
   yourself pointing at the `elastic_ip` output, and skip `route53_zone_id` below.
2. In `infra/envs/prod/terraform.tfvars`, set:
   ```
   domain_name     = "hr.yourcompany.com"
   route53_zone_id = "Z0123456789ABCDEFGHIJ"   # omit if DNS is managed outside Route 53
   ```
3. `terraform apply` — this creates the Route 53 record (if applicable) and reconfigures the
   instance so Caddy requests a Let's Encrypt certificate for the domain and redirects
   HTTP→HTTPS automatically. No other changes needed.
4. Re-run the GitHub Actions deploy (or trigger it manually) so the instance's `config.env`
   picks up the new `DOMAIN` value — `terraform apply` alone updates `config.env` via
   `user_data`, but `user_data_replace_on_change = false` means it won't re-run automatically;
   either reboot the instance once, or just trigger a normal deploy which re-reads
   `config.env` on every run anyway (it's re-written by `terraform apply` directly on the
   instance's filesystem... actually it is NOT — `user_data` only runs at launch. If
   `terraform apply` changes `domain_name`, SSH/SSM in and manually update
   `/opt/keystone-hr/config.env`'s `DOMAIN=` line to match, then re-run
   `/opt/keystone-hr/deploy.sh` once by hand. This one step is the only manually-applied
   config drift in this whole setup — worth automating if you expect to change domains often,
   not worth the complexity for a one-time change.)

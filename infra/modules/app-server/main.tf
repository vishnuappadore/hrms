# The one EC2 instance running everything (api/web/worker/postgres/redis/caddy via Docker
# Compose) for the "minimum configuration" tier. See infra/CLAUDE.md for the philosophy and
# infra/README-bootstrap.md for the first-apply walkthrough.

data "aws_ssm_parameter" "al2023_arm64" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64"
}

data "aws_availability_zones" "available" {
  state = "available"
}

# ── IAM: instance role ──────────────────────────────────────────────────────────────────
data "aws_iam_policy_document" "ec2_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "app_server" {
  name               = "${var.project}-${var.environment}-app-server"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume_role.json
}

# Grants Session Manager access — this is the ONLY way onto the box, there is no SSH.
resource "aws_iam_role_policy_attachment" "ssm_core" {
  role       = aws_iam_role.app_server.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

data "aws_iam_policy_document" "app_server" {
  statement {
    sid       = "EcrAuth"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"] # this specific action is not resource-scopable
  }

  statement {
    sid = "EcrPull"
    actions = [
      "ecr:BatchGetImage",
      "ecr:GetDownloadUrlForLayer",
      "ecr:BatchCheckLayerAvailability",
    ]
    resources = [var.ecr_api_repository_arn, var.ecr_web_repository_arn]
  }

  statement {
    sid       = "ReadDeployManifests"
    actions   = ["s3:GetObject"]
    resources = ["${var.app_bucket_arn}/deploy/*"]
  }

  statement {
    sid       = "WriteBackups"
    actions   = ["s3:PutObject"]
    resources = ["${var.app_bucket_arn}/backups/*"]
  }

  statement {
    sid       = "ReadSecrets"
    actions   = ["ssm:GetParameter", "ssm:GetParametersByPath"]
    resources = ["arn:aws:ssm:*:*:parameter${var.ssm_parameter_prefix}/*"]
  }

  statement {
    sid       = "DecryptSecrets"
    actions   = ["kms:Decrypt"]
    resources = ["arn:aws:kms:*:*:alias/aws/ssm"]
  }
}

resource "aws_iam_role_policy" "app_server" {
  name   = "${var.project}-${var.environment}-app-server"
  role   = aws_iam_role.app_server.id
  policy = data.aws_iam_policy_document.app_server.json
}

resource "aws_iam_instance_profile" "app_server" {
  name = "${var.project}-${var.environment}-app-server"
  role = aws_iam_role.app_server.name
}

# ── Elastic IP (allocated before the instance so user_data can reference it if needed) ───
resource "aws_eip" "app_server" {
  domain = "vpc"
  tags   = { Name = "${var.project}-${var.environment}-app-server" }
}

# ── The instance ──────────────────────────────────────────────────────────────────────
locals {
  # "<account>.dkr.ecr.<region>.amazonaws.com/keystonehr-api" -> just the registry host.
  ecr_registry = split("/", var.ecr_api_repository_url)[0]

  config_env = <<-EOF
    AWS_REGION=${var.region}
    PROJECT=${var.project}
    ENVIRONMENT=${var.environment}
    ECR_REGISTRY=${local.ecr_registry}
    ECR_API_REPO=${var.ecr_api_repo_name}
    ECR_WEB_REPO=${var.ecr_web_repo_name}
    SSM_PREFIX=${var.ssm_parameter_prefix}
    S3_BUCKET=${var.app_bucket_name}
    DOMAIN=${var.domain_name}
  EOF

  user_data = templatefile("${path.module}/templates/user_data.sh.tpl", {
    config_env_b64    = base64encode(local.config_env)
    deploy_script_b64 = base64encode(file("${path.module}/../../deploy.sh"))
    backup_script_b64 = base64encode(file("${path.module}/../../backup.sh"))
    compose_file_b64  = base64encode(file("${path.module}/../../docker-compose.prod.yml"))
    caddyfile_b64     = base64encode(file("${path.module}/../../Caddyfile"))
  })
}

resource "aws_instance" "app_server" {
  ami                    = data.aws_ssm_parameter.al2023_arm64.value
  instance_type          = var.instance_type
  subnet_id              = var.public_subnet_id
  vpc_security_group_ids = [var.security_group_id]
  iam_instance_profile   = aws_iam_instance_profile.app_server.name
  availability_zone      = data.aws_availability_zones.available.names[0]

  root_block_device {
    volume_type           = "gp3"
    volume_size           = 20
    encrypted             = true
    delete_on_termination = true
  }

  # Re-running user_data (e.g. after a `terraform taint`/replace) must never reformat the
  # data volume or re-seed secrets it didn't create — deploy.sh and the mount logic below
  # are both written to be safe to re-run, so this is deliberately NOT one-shot-only.
  user_data                   = local.user_data
  user_data_replace_on_change = false

  metadata_options {
    http_tokens = "required" # IMDSv2 only
  }

  tags = { Name = "${var.project}-${var.environment}-app-server" }

  lifecycle {
    ignore_changes = [ami] # don't force a replace every time the latest AL2023 AMI rotates
  }
}

resource "aws_eip_association" "app_server" {
  instance_id   = aws_instance.app_server.id
  allocation_id = aws_eip.app_server.id
}

# Separate data volume — survives instance replacement, holds Postgres/Redis/Caddy data.
resource "aws_ebs_volume" "data" {
  availability_zone = aws_instance.app_server.availability_zone
  size              = 20
  type              = "gp3"
  encrypted         = true
  tags              = { Name = "${var.project}-${var.environment}-data" }

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_volume_attachment" "data" {
  device_name = "/dev/sdf"
  volume_id   = aws_ebs_volume.data.id
  instance_id = aws_instance.app_server.id
}

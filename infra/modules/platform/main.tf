# ECR repos (image storage), the app S3 bucket (file uploads + the CI "deploy/" drop zone),
# and the SSM SecureString parameters the app reads its secrets from at boot. Nothing here
# is reachable without IAM permission — app-server's instance role and github-oidc's deploy
# role are each scoped to exactly the resources they need, defined in those modules.

resource "random_id" "bucket_suffix" {
  byte_length = 3
}

resource "aws_s3_bucket" "app" {
  bucket = "${var.project}-${var.environment}-${random_id.bucket_suffix.hex}"

  tags = { Name = "${var.project}-${var.environment}-app" }
}

resource "aws_s3_bucket_versioning" "app" {
  bucket = aws_s3_bucket.app.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "app" {
  bucket = aws_s3_bucket.app.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "app" {
  bucket                  = aws_s3_bucket.app.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Uploaded file (logos, leave attachments) CORS — mirrors what StorageService sets up itself
# against MinIO in dev (PutBucketCorsCommand in storage.service.ts); real S3 has no CORS by
# default, and the app's own onModuleInit call will also attempt this, so this is a belt-
# and-suspenders default in case that call ever fails silently.
resource "aws_s3_bucket_cors_configuration" "app" {
  bucket = aws_s3_bucket.app.id
  cors_rule {
    allowed_origins = ["*"]
    allowed_methods = ["GET", "PUT"]
    allowed_headers = ["*"]
    expose_headers  = ["ETag"]
  }
}

# Old deploy manifests (docker-compose.prod.yml / Caddyfile snapshots) don't need to live
# forever under deploy/ — keep a short history for rollback-by-hand, then expire.
resource "aws_s3_bucket_lifecycle_configuration" "app" {
  bucket = aws_s3_bucket.app.id

  rule {
    id     = "expire-old-deploy-manifests"
    status = "Enabled"
    filter { prefix = "deploy/" }
    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }

  # backup.sh (cron, on the instance) uploads a nightly pg_dump here; the instance itself
  # only keeps 3 days locally, S3 is the longer-lived copy — but still bounded, not forever.
  rule {
    id     = "expire-old-backups"
    status = "Enabled"
    filter { prefix = "backups/" }
    expiration {
      days = 30
    }
    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }
}

resource "aws_ecr_repository" "api" {
  name                 = "${var.project}-api"
  image_tag_mutability = "MUTABLE"
  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_repository" "web" {
  name                 = "${var.project}-web"
  image_tag_mutability = "MUTABLE"
  image_scanning_configuration {
    scan_on_push = true
  }
}

locals {
  ecr_lifecycle_policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Expire untagged images after 1 day"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 1
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Keep only the last 10 tagged images"
        selection = {
          tagStatus     = "tagged"
          tagPrefixList = ["sha-", "latest"]
          countType     = "imageCountMoreThan"
          countNumber   = 10
        }
        action = { type = "expire" }
      }
    ]
  })
}

resource "aws_ecr_lifecycle_policy" "api" {
  repository = aws_ecr_repository.api.name
  policy     = local.ecr_lifecycle_policy
}

resource "aws_ecr_lifecycle_policy" "web" {
  repository = aws_ecr_repository.web.name
  policy     = local.ecr_lifecycle_policy
}

# ── Runtime secrets, generated server-side and never typed by a human ──────────────────
resource "random_password" "db_password" {
  length  = 32
  special = false # goes straight into a Postgres connection URL — keep it URL-safe
}

resource "random_password" "jwt_access_secret" {
  length  = 48
  special = false
}

resource "random_password" "jwt_refresh_secret" {
  length  = 48
  special = false
}

resource "aws_iam_user" "app_s3" {
  name = "${var.project}-${var.environment}-app-s3"
  path = "/${var.project}/"
}

# StorageService (apps/api/src/modules/storage/storage.service.ts) always builds its S3
# client from explicit accessKeyId/secretAccessKey env vars — it does not fall back to the
# instance's IAM role credential chain. Until that's changed in app code, the app needs a
# real (narrowly-scoped) access key rather than relying purely on the instance profile.
resource "aws_iam_user_policy" "app_s3" {
  name = "${var.project}-${var.environment}-app-s3-bucket-access"
  user = aws_iam_user.app_s3.name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = aws_s3_bucket.app.arn
      },
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = "${aws_s3_bucket.app.arn}/*"
      }
    ]
  })
}

resource "aws_iam_access_key" "app_s3" {
  user = aws_iam_user.app_s3.name
}

resource "aws_ssm_parameter" "db_password" {
  name   = "/${var.project}/${var.environment}/db_password"
  type   = "SecureString"
  value  = random_password.db_password.result
  key_id = "alias/aws/ssm"
}

resource "aws_ssm_parameter" "jwt_access_secret" {
  name   = "/${var.project}/${var.environment}/jwt_access_secret"
  type   = "SecureString"
  value  = random_password.jwt_access_secret.result
  key_id = "alias/aws/ssm"
}

resource "aws_ssm_parameter" "jwt_refresh_secret" {
  name   = "/${var.project}/${var.environment}/jwt_refresh_secret"
  type   = "SecureString"
  value  = random_password.jwt_refresh_secret.result
  key_id = "alias/aws/ssm"
}

resource "aws_ssm_parameter" "s3_access_key_id" {
  name   = "/${var.project}/${var.environment}/s3_access_key_id"
  type   = "SecureString"
  value  = aws_iam_access_key.app_s3.id
  key_id = "alias/aws/ssm"
}

resource "aws_ssm_parameter" "s3_secret_access_key" {
  name   = "/${var.project}/${var.environment}/s3_secret_access_key"
  type   = "SecureString"
  value  = aws_iam_access_key.app_s3.secret
  key_id = "alias/aws/ssm"
}

resource "aws_ssm_parameter" "s3_uploads_bucket" {
  name  = "/${var.project}/${var.environment}/s3_uploads_bucket"
  type  = "String"
  value = aws_s3_bucket.app.bucket
}

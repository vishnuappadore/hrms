# One-time bootstrap: creates the S3 bucket that envs/prod's Terraform state lives in.
#
# Chicken-and-egg: the state bucket can't be defined in the state it stores, so this tiny
# config uses LOCAL state (no backend block) and is applied exactly once, by hand, before
# envs/prod is ever applied. After it succeeds, copy the bucket name it outputs into
# envs/prod/backend.tf and never touch this directory again.
#
#   cd infra/bootstrap
#   terraform init
#   terraform apply -var="region=me-central-1" -var="bucket_name=keystonehr-tfstate-<something-unique>"
#   terraform output -raw bucket_name   # paste into envs/prod/backend.tf

terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.region
}

variable "region" {
  type        = string
  default     = "me-central-1"
  description = "AWS region for the state bucket. Keep in sync with envs/prod's region."
}

variable "bucket_name" {
  type        = string
  description = "Globally-unique S3 bucket name for Terraform state, e.g. keystonehr-tfstate-<random suffix you pick>."
}

resource "aws_s3_bucket" "tfstate" {
  bucket = var.bucket_name

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "tfstate" {
  bucket                  = aws_s3_bucket.tfstate.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

output "bucket_name" {
  value = aws_s3_bucket.tfstate.bucket
}

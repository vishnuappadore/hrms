terraform {
  required_providers {
    aws = { source = "hashicorp/aws" }
    tls = { source = "hashicorp/tls" }
  }
}

variable "project" {
  type    = string
  default = "keystonehr"
}

variable "environment" {
  type    = string
  default = "prod"
}

variable "github_repo" {
  type        = string
  description = "GitHub \"owner/repo\" slug this deploy role trusts, e.g. \"acme-corp/keystone-hr\". REQUIRED placeholder — this repo has no git remote configured yet."
}

variable "ecr_api_repository_arn" {
  type = string
}

variable "ecr_web_repository_arn" {
  type = string
}

variable "app_bucket_arn" {
  type = string
}

variable "app_server_instance_arn" {
  type = string
}

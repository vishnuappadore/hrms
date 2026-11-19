variable "project" {
  type    = string
  default = "keystonehr"
}

variable "environment" {
  type    = string
  default = "prod"
}

variable "region" {
  type        = string
  description = "AWS region — passed through into config.env for the AWS CLI calls deploy.sh/backup.sh make on the instance. Never hardcode this."
}

variable "instance_type" {
  type    = string
  default = "t4g.small"
}

variable "public_subnet_id" {
  type = string
}

variable "security_group_id" {
  type = string
}

variable "ecr_api_repository_url" {
  type = string
}

variable "ecr_web_repository_url" {
  type = string
}

variable "ecr_api_repository_arn" {
  type = string
}

variable "ecr_web_repository_arn" {
  type = string
}

variable "ecr_api_repo_name" {
  type = string
}

variable "ecr_web_repo_name" {
  type = string
}

variable "app_bucket_name" {
  type = string
}

variable "app_bucket_arn" {
  type = string
}

variable "ssm_parameter_prefix" {
  type = string
}

variable "domain_name" {
  type        = string
  default     = ""
  description = "Leave empty until a real domain is ready. Non-empty activates Caddy's auto-TLS for this domain (see Caddyfile) and gates the Route 53 record in the dns module."
}

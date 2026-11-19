variable "region" {
  type        = string
  default     = "me-central-1"
  description = "AWS region. Never hardcode this anywhere else — every resource/module reads it from here."
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
  description = "GitHub \"owner/repo\" slug for the OIDC trust policy, e.g. \"acme-corp/keystone-hr\". REQUIRED — this repo has no remote configured yet, so there is no sensible default."
}

variable "domain_name" {
  type        = string
  default     = ""
  description = "Leave empty until a real domain is ready. See infra/README-bootstrap.md's \"adding a domain later\" section."
}

variable "route53_zone_id" {
  type        = string
  default     = ""
  description = "Hosted zone id to create the A record in. Leave empty if domain_name is also empty, or if DNS is managed outside Route 53."
}

variable "create_github_oidc" {
  type        = bool
  default     = true
  description = "The GitHub OIDC provider for token.actions.githubusercontent.com is a singleton per AWS account — set to false in any secondary/parallel environment in the same account (e.g. a temporary stack in another region) so it doesn't collide with the one the primary environment already created."
}

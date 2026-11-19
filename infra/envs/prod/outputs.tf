output "instance_id" {
  value = module.app_server.instance_id
}

output "elastic_ip" {
  value       = module.app_server.elastic_ip
  description = "Point your DNS here manually until domain_name/route53_zone_id are set."
}

output "ecr_api_repository_url" {
  value = module.platform.ecr_api_repository_url
}

output "ecr_web_repository_url" {
  value = module.platform.ecr_web_repository_url
}

output "app_bucket_name" {
  value = module.platform.app_bucket_name
}

output "github_deploy_role_arn" {
  value       = try(module.github_oidc[0].deploy_role_arn, null)
  description = "Paste into the GitHub repo's Actions secrets/variables as AWS_DEPLOY_ROLE_ARN. Null when create_github_oidc=false."
}

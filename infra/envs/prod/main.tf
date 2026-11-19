module "network" {
  source      = "../../modules/network"
  project     = var.project
  environment = var.environment
}

module "platform" {
  source      = "../../modules/platform"
  project     = var.project
  environment = var.environment
}

module "app_server" {
  source      = "../../modules/app-server"
  project     = var.project
  environment = var.environment
  region      = var.region
  domain_name = var.domain_name

  public_subnet_id  = module.network.public_subnet_id
  security_group_id = module.network.app_server_security_group_id

  ecr_api_repository_url = module.platform.ecr_api_repository_url
  ecr_web_repository_url = module.platform.ecr_web_repository_url
  ecr_api_repository_arn = module.platform.ecr_api_repository_arn
  ecr_web_repository_arn = module.platform.ecr_web_repository_arn
  ecr_api_repo_name      = "${var.project}-api"
  ecr_web_repo_name      = "${var.project}-web"

  app_bucket_name      = module.platform.app_bucket_name
  app_bucket_arn       = module.platform.app_bucket_arn
  ssm_parameter_prefix = module.platform.ssm_parameter_prefix
}

module "github_oidc" {
  count       = var.create_github_oidc ? 1 : 0
  source      = "../../modules/github-oidc"
  project     = var.project
  environment = var.environment
  github_repo = var.github_repo

  ecr_api_repository_arn  = module.platform.ecr_api_repository_arn
  ecr_web_repository_arn  = module.platform.ecr_web_repository_arn
  app_bucket_arn          = module.platform.app_bucket_arn
  app_server_instance_arn = "arn:aws:ec2:${var.region}:${data.aws_caller_identity.current.account_id}:instance/${module.app_server.instance_id}"
}

moved {
  from = module.github_oidc
  to   = module.github_oidc[0]
}

module "dns" {
  source          = "../../modules/dns"
  domain_name     = var.domain_name
  route53_zone_id = var.route53_zone_id
  elastic_ip      = module.app_server.elastic_ip
}

data "aws_caller_identity" "current" {}

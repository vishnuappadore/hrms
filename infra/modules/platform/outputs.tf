output "app_bucket_name" {
  value = aws_s3_bucket.app.bucket
}

output "app_bucket_arn" {
  value = aws_s3_bucket.app.arn
}

output "ecr_api_repository_url" {
  value = aws_ecr_repository.api.repository_url
}

output "ecr_web_repository_url" {
  value = aws_ecr_repository.web.repository_url
}

output "ecr_api_repository_arn" {
  value = aws_ecr_repository.api.arn
}

output "ecr_web_repository_arn" {
  value = aws_ecr_repository.web.arn
}

output "ssm_parameter_prefix" {
  value = "/${var.project}/${var.environment}"
}

output "ssm_parameter_arns" {
  value = [
    aws_ssm_parameter.db_password.arn,
    aws_ssm_parameter.jwt_access_secret.arn,
    aws_ssm_parameter.jwt_refresh_secret.arn,
    aws_ssm_parameter.s3_access_key_id.arn,
    aws_ssm_parameter.s3_secret_access_key.arn,
    aws_ssm_parameter.s3_uploads_bucket.arn,
  ]
}

output "db_password" {
  value     = random_password.db_password.result
  sensitive = true
}

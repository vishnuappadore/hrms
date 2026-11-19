output "instance_id" {
  value = aws_instance.app_server.id
}

output "elastic_ip" {
  value = aws_eip.app_server.public_ip
}

output "iam_role_arn" {
  value = aws_iam_role.app_server.arn
}

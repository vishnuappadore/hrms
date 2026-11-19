# Only creates anything once both a domain and a hosted zone id are supplied — stays a
# no-op today so "add a domain later" really is just setting two variables and re-applying,
# per what was promised to the user.

resource "aws_route53_record" "app" {
  count   = var.domain_name != "" && var.route53_zone_id != "" ? 1 : 0
  zone_id = var.route53_zone_id
  name    = var.domain_name
  type    = "A"
  ttl     = 300
  records = [var.elastic_ip]
}

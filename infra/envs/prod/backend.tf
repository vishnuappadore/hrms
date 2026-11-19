# Fill in `bucket` with the output of `infra/bootstrap`'s apply (see
# infra/README-bootstrap.md step 2) BEFORE running `terraform init` here. Terraform >= 1.10's
# native S3 locking (use_lockfile) is used instead of a DynamoDB lock table — one less
# resource to pay for and manage.
terraform {
  backend "s3" {
    bucket       = "REPLACE_ME_keystonehr_tfstate_bucket_name"
    key          = "prod/terraform.tfstate"
    region       = "me-central-1"
    use_lockfile = true
    encrypt      = true
  }
}

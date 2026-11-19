terraform {
  required_providers {
    aws    = { source = "hashicorp/aws" }
    random = { source = "hashicorp/random" }
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

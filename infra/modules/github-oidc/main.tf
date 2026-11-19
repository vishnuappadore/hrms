# Lets GitHub Actions assume an IAM role via OIDC — no long-lived AWS access keys stored in
# GitHub secrets. Scoped to one repo, one branch (main), and exactly the actions the deploy
# workflow needs: push to the two ECR repos, upload the deploy manifests to S3, and trigger
# + poll an SSM command on the one app-server instance.

data "tls_certificate" "github" {
  url = "https://token.actions.githubusercontent.com/.well-known/openid-configuration"
}

resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [data.tls_certificate.github.certificates[0].sha1_fingerprint]
}

data "aws_iam_policy_document" "github_assume_role" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      # Covers pushes to main and manual workflow_dispatch runs against main.
      values = ["repo:${var.github_repo}:ref:refs/heads/main"]
    }
  }
}

resource "aws_iam_role" "github_deploy" {
  name               = "${var.project}-${var.environment}-github-deploy"
  assume_role_policy = data.aws_iam_policy_document.github_assume_role.json
}

data "aws_iam_policy_document" "github_deploy" {
  statement {
    sid       = "EcrAuth"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    sid = "EcrPush"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:GetDownloadUrlForLayer",
      "ecr:BatchGetImage",
      "ecr:PutImage",
      "ecr:InitiateLayerUpload",
      "ecr:UploadLayerPart",
      "ecr:CompleteLayerUpload",
    ]
    resources = [var.ecr_api_repository_arn, var.ecr_web_repository_arn]
  }

  statement {
    sid       = "UploadDeployManifests"
    actions   = ["s3:PutObject"]
    resources = ["${var.app_bucket_arn}/deploy/*"]
  }

  statement {
    sid       = "TriggerDeploy"
    actions   = ["ssm:SendCommand"]
    resources = [var.app_server_instance_arn, "arn:aws:ssm:*:*:document/AWS-RunShellScript"]
  }

  statement {
    sid       = "PollDeployCommand"
    actions   = ["ssm:GetCommandInvocation", "ssm:ListCommandInvocations"]
    resources = ["*"] # these two read-only actions aren't resource-scopable to a command id
  }
}

resource "aws_iam_role_policy" "github_deploy" {
  name   = "${var.project}-${var.environment}-github-deploy"
  role   = aws_iam_role.github_deploy.id
  policy = data.aws_iam_policy_document.github_deploy.json
}

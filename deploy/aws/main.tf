# DocuMind on AWS: App Runner (container) + RDS PostgreSQL 16 with pgvector + Secrets Manager.
# Not deployed by default (the live demo runs on free tiers). Apply with:
#   terraform init && terraform apply -var="image_uri=<account>.dkr.ecr.<region>.amazonaws.com/documind:latest"
# Approximate cost if applied: App Runner ~$5-25/month at low traffic, RDS db.t4g.micro ~$13/month (free tier eligible for 12 months).

terraform {
  required_version = ">= 1.6"
  required_providers {
    aws    = { source = "hashicorp/aws", version = "~> 5.0" }
    random = { source = "hashicorp/random", version = "~> 3.6" }
  }
}

provider "aws" { region = var.region }

data "aws_vpc" "default" { default = true }
data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

resource "aws_ecr_repository" "app" {
  name                 = "documind"
  image_tag_mutability = "MUTABLE"
  image_scanning_configuration { scan_on_push = true }
}

resource "random_password" "db" {
  length  = 32
  special = false
}
resource "random_password" "jwt" {
  length  = 48
  special = false
}

resource "aws_security_group" "db" {
  name   = "documind-db"
  vpc_id = data.aws_vpc.default.id
  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.connector.id]
  }
}

resource "aws_security_group" "connector" {
  name   = "documind-apprunner"
  vpc_id = data.aws_vpc.default.id
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_db_subnet_group" "db" {
  name       = "documind"
  subnet_ids = data.aws_subnets.default.ids
}

# RDS for PostgreSQL 16 ships pgvector; the app runs CREATE EXTENSION vector on startup.
resource "aws_db_instance" "db" {
  identifier              = "documind"
  engine                  = "postgres"
  engine_version          = "16"
  instance_class          = var.db_instance_class
  allocated_storage       = 20
  storage_encrypted       = true
  db_name                 = "documind"
  username                = "documind"
  password                = random_password.db.result
  db_subnet_group_name    = aws_db_subnet_group.db.name
  vpc_security_group_ids  = [aws_security_group.db.id]
  backup_retention_period = 7
  skip_final_snapshot     = true
  publicly_accessible     = false
}

resource "aws_secretsmanager_secret" "app" { name = "documind/app" }
resource "aws_secretsmanager_secret_version" "app" {
  secret_id = aws_secretsmanager_secret.app.id
  secret_string = jsonencode({
    DATABASE_URL   = "postgresql://documind:${random_password.db.result}@${aws_db_instance.db.address}:5432/documind?sslmode=require"
    JWT_SECRET     = random_password.jwt.result
    GEMINI_API_KEY = var.gemini_api_key
  })
}

resource "aws_iam_role" "instance" {
  name = "documind-apprunner-instance"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "tasks.apprunner.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}
resource "aws_iam_role_policy" "secrets" {
  role = aws_iam_role.instance.id
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = ["secretsmanager:GetSecretValue"], Resource = aws_secretsmanager_secret.app.arn }]
  })
}

resource "aws_iam_role" "access" {
  name = "documind-apprunner-ecr"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "build.apprunner.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}
resource "aws_iam_role_policy_attachment" "ecr" {
  role       = aws_iam_role.access.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess"
}

resource "aws_apprunner_vpc_connector" "app" {
  vpc_connector_name = "documind"
  subnets            = data.aws_subnets.default.ids
  security_groups    = [aws_security_group.connector.id]
}

resource "aws_apprunner_service" "app" {
  service_name = "documind"
  source_configuration {
    authentication_configuration { access_role_arn = aws_iam_role.access.arn }
    image_repository {
      image_identifier      = var.image_uri
      image_repository_type = "ECR"
      image_configuration {
        port = "8000"
        runtime_environment_variables = { CORS_ORIGINS = var.cors_origins }
        runtime_environment_secrets = {
          DATABASE_URL   = "${aws_secretsmanager_secret.app.arn}:DATABASE_URL::"
          JWT_SECRET     = "${aws_secretsmanager_secret.app.arn}:JWT_SECRET::"
          GEMINI_API_KEY = "${aws_secretsmanager_secret.app.arn}:GEMINI_API_KEY::"
        }
      }
    }
    auto_deployments_enabled = true
  }
  instance_configuration {
    cpu               = "1024"
    memory            = "2048"
    instance_role_arn = aws_iam_role.instance.arn
  }
  network_configuration {
    egress_configuration {
      egress_type       = "VPC"
      vpc_connector_arn = aws_apprunner_vpc_connector.app.arn
    }
  }
  health_check_configuration {
    protocol = "HTTP"
    path     = "/api/health"
  }
}

# Deploying DocuMind to AWS

The live demo runs on free tiers (Vercel + Neon). This folder deploys the same app to AWS as a container.

| Piece | AWS service |
| --- | --- |
| App (API + React build) | **App Runner** from an **ECR** image (`Dockerfile` at the repo root) |
| Vector + relational DB | **RDS for PostgreSQL 16** with the `pgvector` extension |
| Secrets | **Secrets Manager** (database URL, JWT secret, Gemini key) injected as env vars |
| Network | App Runner VPC connector → private RDS (not publicly accessible) |

## Steps

```bash
# 1. Build and push the image
aws ecr create-repository --repository-name documind          # or let Terraform create it, then push
docker build -t documind .
docker tag documind:latest <account>.dkr.ecr.<region>.amazonaws.com/documind:latest
aws ecr get-login-password | docker login --username AWS --password-stdin <account>.dkr.ecr.<region>.amazonaws.com
docker push <account>.dkr.ecr.<region>.amazonaws.com/documind:latest

# 2. Provision everything
cd deploy/aws
terraform init
terraform apply -var="image_uri=<account>.dkr.ecr.<region>.amazonaws.com/documind:latest" -var="gemini_api_key=$GEMINI_API_KEY"
```

Terraform prints the public URL. The schema (including `CREATE EXTENSION vector`) is applied automatically on first start.

## Alternatives

- **ECS Fargate + ALB** instead of App Runner for more control (same image, same env vars).
- **Lambda**: wrap `documind.main:app` with Mangum; keep the reranker on `llm` to stay within package limits.
- **Bedrock** instead of Gemini: implement `Provider` in `server/documind/llm/` (embed / generate / stream); nothing else changes.
- **Local cross-encoder reranker** in containers: `docker build --build-arg EXTRA="flashrank" .` and set `RERANKER=cross-encoder`.

## Cost guardrails

Set an AWS Budget alert before applying. Tear down with `terraform destroy`.

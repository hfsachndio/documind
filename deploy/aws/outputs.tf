output "url" { value = "https://${aws_apprunner_service.app.service_url}" }
output "ecr_repository" { value = aws_ecr_repository.app.repository_url }
output "database_endpoint" { value = aws_db_instance.db.address }

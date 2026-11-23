variable "region" {
  type    = string
  default = "us-east-1"
}
variable "image_uri" {
  type        = string
  description = "ECR image, e.g. 123456789012.dkr.ecr.us-east-1.amazonaws.com/documind:latest"
}
variable "gemini_api_key" {
  type      = string
  sensitive = true
  default   = ""
}
variable "db_instance_class" {
  type    = string
  default = "db.t4g.micro"
}
variable "cors_origins" {
  type    = string
  default = "*"
}

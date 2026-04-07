variable "aws_region" {
  description = "AWS region for the smoke test."
  type        = string
  default     = "us-west-2"
}

variable "name_prefix" {
  description = "Prefix used for AWS resource names."
  type        = string
  default     = "aadm-smoke"
}

variable "instance_type" {
  description = "EC2 instance type for the smoke test host."
  type        = string
  default     = "t3.large"
}

variable "root_volume_size_gb" {
  description = "Root EBS volume size in GiB."
  type        = number
  default     = 40
}

variable "env_tag" {
  description = "Environment tag value applied to smoke resources."
  type        = string
  default     = "smoke"
}

variable "ssh_ingress_cidr" {
  description = "CIDR allowed to SSH to the smoke test host."
  type        = string
}

variable "web_ingress_cidr" {
  description = "CIDR allowed to reach the smoke test host over HTTP/HTTPS."
  type        = string
}

variable "public_key" {
  description = "SSH public key material for the temporary EC2 key pair."
  type        = string
  sensitive   = true
}

variable "spot_max_price" {
  description = "Optional maximum hourly price for the spot instance."
  type        = string
  default     = null
  nullable    = true
}

variable "route53_zone_name" {
  description = "Optional delegated public Route 53 zone used for live TLS smoke hostnames, for example smoke.markcallen.dev."
  type        = string
  default     = ""
}

variable "route53_record_name" {
  description = "Optional explicit smoke hostname to create inside route53_zone_name."
  type        = string
  default     = ""
}

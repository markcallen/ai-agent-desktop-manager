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

variable "ssh_ingress_cidr" {
  description = "CIDR allowed to SSH to the smoke test host."
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

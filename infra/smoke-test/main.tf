locals {
  common_tags = {
    Project   = "ai-agent-desktop-manager"
    Env       = var.env_tag
    ManagedBy = "terraform"
    Purpose   = "smoke-test"
  }

  route53_zone_enabled = trimspace(var.route53_zone_name) != ""
  route53_zone_fqdn    = trimsuffix(trimspace(var.route53_zone_name), ".")
  route53_record_label = substr(
    trim(
      replace(replace(replace(lower(var.name_prefix), "_", "-"), ".", "-"), " ", "-"),
      "-"
    ),
    0,
    24
  )
  generated_route53_record_name = local.route53_zone_enabled ? (
    trimspace(var.route53_record_name) != "" ? trimsuffix(trimspace(var.route53_record_name), ".") : format(
      "%s-%s.%s",
      local.route53_record_label != "" ? local.route53_record_label : "aadm-smoke",
      random_id.route53_hostname[0].hex,
      local.route53_zone_fqdn
    )
  ) : ""
}

data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default_vpc" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

data "aws_ami" "ubuntu_2404" {
  owners      = ["099720109477"]
  most_recent = true

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*"]
  }

  filter {
    name   = "architecture"
    values = ["x86_64"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }

  filter {
    name   = "root-device-type"
    values = ["ebs"]
  }
}

data "aws_route53_zone" "smoke" {
  count        = local.route53_zone_enabled ? 1 : 0
  name         = "${local.route53_zone_fqdn}."
  private_zone = false
}

resource "random_id" "route53_hostname" {
  count       = local.route53_zone_enabled && trimspace(var.route53_record_name) == "" ? 1 : 0
  byte_length = 3
}

resource "aws_security_group" "smoke" {
  name        = "${var.name_prefix}-sg"
  description = "Ingress for ai-agent-desktop-manager smoke testing"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description = "SSH from caller"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.ssh_ingress_cidr]
  }

  ingress {
    description = "HTTP from configured CIDR"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = [var.web_ingress_cidr]
  }

  ingress {
    description = "HTTPS from configured CIDR"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = [var.web_ingress_cidr]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.common_tags, {
    Name = "${var.name_prefix}-sg"
  })
}

resource "aws_key_pair" "smoke" {
  key_name   = "${var.name_prefix}-key"
  public_key = trimspace(var.public_key)

  tags = merge(local.common_tags, {
    Name = "${var.name_prefix}-key"
  })
}

resource "aws_instance" "smoke" {
  ami                         = data.aws_ami.ubuntu_2404.id
  instance_type               = var.instance_type
  subnet_id                   = sort(data.aws_subnets.default_vpc.ids)[0]
  vpc_security_group_ids      = [aws_security_group.smoke.id]
  key_name                    = aws_key_pair.smoke.key_name
  associate_public_ip_address = true

  instance_market_options {
    market_type = "spot"

    spot_options {
      instance_interruption_behavior = "terminate"
      spot_instance_type             = "one-time"
      max_price                      = var.spot_max_price
    }
  }

  metadata_options {
    http_endpoint = "enabled"
    http_tokens   = "required"
  }

  root_block_device {
    volume_type           = "gp3"
    volume_size           = var.root_volume_size_gb
    delete_on_termination = true
  }

  user_data = <<-CLOUDINIT
    #cloud-config
    package_update: true
    packages:
      - python3
      - python3-apt
      - python3-pip
      - rsync
  CLOUDINIT

  tags = merge(local.common_tags, {
    Name = "${var.name_prefix}-host"
  })
}

resource "aws_route53_record" "smoke_host" {
  count   = local.route53_zone_enabled ? 1 : 0
  zone_id = data.aws_route53_zone.smoke[0].zone_id
  name    = local.generated_route53_record_name
  type    = "A"
  ttl     = 60
  records = [aws_instance.smoke.public_ip]
}

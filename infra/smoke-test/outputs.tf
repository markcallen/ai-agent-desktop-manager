output "instance_id" {
  value = aws_instance.smoke.id
}

output "public_ip" {
  value = aws_instance.smoke.public_ip
}

output "public_dns" {
  value = aws_instance.smoke.public_dns
}

output "ssh_user" {
  value = "ubuntu"
}

output "ssh_host" {
  value = aws_instance.smoke.public_ip
}

output "http_url" {
  value = "http://${aws_instance.smoke.public_ip}"
}

output "https_url" {
  value = "https://${aws_instance.smoke.public_ip}"
}

output "tls_domain" {
  value = local.generated_route53_record_name
}

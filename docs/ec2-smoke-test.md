# EC2 Smoke Test

This repo now includes a local Terraform + Ansible workflow for a disposable AWS smoke test in an AWS region you choose at runtime.

## What it does

- Detects your public IP with `curl ifconfig.me`
- Looks up the default VPC and one default subnet
- Creates a security group:
  - `22/tcp` from your current IP only
  - `80/tcp` and `443/tcp` from anywhere
- Generates a local SSH key pair outside git
- Launches an Ubuntu 24.04 `t3.large` spot instance
- Provisions the host with Ansible
- Uploads the current repo checkout as a tarball
- Installs runtime dependencies and deploys `ai-agent-desktop-manager`
- Runs a smoke create + doctor validation

## Files

- Terraform: `infra/smoke-test/`
- Ansible: `infra/ansible/`
- Wrapper: `scripts/ec2-smoke-test.sh`

## Prerequisites

- `aws` CLI configured for the target account
- `terraform`
- `ansible-playbook`
- `ssh`, `ssh-keygen`, `tar`, `curl`, `jq`

## Run

```bash
./scripts/ec2-smoke-test.sh run --region us-west-2
```

Optional flags:

```bash
./scripts/ec2-smoke-test.sh run --region us-west-2 --destroy-on-success
./scripts/ec2-smoke-test.sh run --region us-west-2 --destroy-desktop
./scripts/ec2-smoke-test.sh run --region us-west-2 --spot-max-price 0.20
./scripts/ec2-smoke-test.sh run --region us-west-2 --aab-npm-package ai-agent-browser
```

## Access the server

The wrapper generates a key under:

```bash
infra/smoke-test/.runtime/id_ed25519
```

SSH:

```bash
ssh -i infra/smoke-test/.runtime/id_ed25519 ubuntu@<public-ip>
```

Or let the helper do it:

```bash
./scripts/ec2-smoke-test.sh ssh --region us-west-2
```

## Use the CLI on the server

After provisioning, the smoke-test host installs a global `aadm` command.

Create the first desktop:

```bash
aadm create --owner smoke --label first --ttl 60 --start-url https://example.com
```

Inspect it:

```bash
aadm list
aadm doctor --id desk-1
```

Destroy it:

```bash
aadm destroy --id desk-1
```

It also installs `ai-agent-browser` globally from the sibling `../ai-agent-browser` repo:

```bash
ai-agent-browser --host 127.0.0.1 --port 8765 --cdp-host 127.0.0.1 --cdp-port 9222
aab --host 127.0.0.1 --port 8765 --cdp-host 127.0.0.1 --cdp-port 9222
```

To follow browser console events from the host:

```bash
aab-console follow
```

Send JavaScript and keep following console output:

```bash
aab-console eval 'console.log(window.location.href)' --follow
```

Capture a screenshot through `ai-agent-browser`:

```bash
aab-console screenshot --out shot.png
```

## Cleanup

Destroy the stack later with:

```bash
./scripts/ec2-smoke-test.sh destroy --region us-west-2
```

## Notes

- The current Ansible flow assumes `ai-agent-browser` is installable via `npm install -g ai-agent-browser`. If your package source differs, pass `--aab-npm-package`.
- The wrapper leaves the instance running by default for manual inspection.
- `443/tcp` is allowed by the security group, but the smoke setup only configures plain HTTP by default. Add DNS/TLS separately if you need HTTPS on the host itself.

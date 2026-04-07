# EC2 Smoke Test

This repo now includes a local Terraform + Ansible workflow for a disposable AWS smoke test in an AWS region you choose at runtime.
The smoke host now uses `novnc-openbox` release `v0.1.0` for the base noVNC/Openbox/nginx/TLS stack instead of rebuilding that layer inside this repo.

## What it does

- Detects your public IP with `curl ifconfig.me`
- Looks up the default VPC and one default subnet
- Creates a security group:
  - `22/tcp` from your current IP only
  - `80/tcp` and `443/tcp` from your current IP by default
- Generates a local SSH key pair outside git
- Launches an Ubuntu 24.04 `t3.large` spot instance
- Creates a per-run Route 53 A record under the delegated smoke zone you pass via `--tls-domain`
- Provisions the host with Ansible
- Uploads the current repo checkout as a tarball
- Installs runtime dependencies and deploys `ai-agent-desktop-manager`
- Runs a smoke create + doctor validation

## Files

- Terraform: `infra/smoke-test/`
- Ansible: `infra/ansible/`
- Wrapper: `scripts/ec2-smoke-test.sh`
- Browser smoke wrapper: `scripts/smoke-playwright.sh`
- Browser smoke script: `smoke/browser-smoke.mjs`

## Prerequisites

- `aws` CLI configured for the target account
- `terraform`
- `ansible-playbook`
- `ssh`, `ssh-keygen`, `tar`, `curl`, `jq`

## Run

```bash
./scripts/ec2-smoke-test.sh run --region us-west-2 --tls-domain smoke.markcallen.dev --tls-email ops@example.com
```

Optional flags:

```bash
./scripts/ec2-smoke-test.sh run --region us-west-2 --destroy-on-success
./scripts/ec2-smoke-test.sh run --region us-west-2 --destroy-desktop
./scripts/ec2-smoke-test.sh run --region us-west-2 --spot-max-price 0.20
./scripts/ec2-smoke-test.sh run --region us-west-2 --aab-npm-package ai-agent-browser
./scripts/ec2-smoke-test.sh run --region us-west-2 --public-web-ingress
./scripts/ec2-smoke-test.sh run --region us-west-2 --web-ingress-cidr 203.0.113.10/32
```

When you run the helper, `--tls-domain` is treated as the delegated smoke zone, not the final hostname. Terraform creates a per-run hostname under that zone and points it at the EC2 instance before certbot runs. `--tls-domain` and `--tls-email` are mandatory for `run`.

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

It also installs `ai-agent-browser` globally from the sibling `../ai-agent-browser` repo. The wrapper now checks for that checkout up front and fails with a clear message if it is missing:

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

The smoke wrapper also copies the remote summary file down to:

```bash
infra/smoke-test/.runtime/aadm-smoke-summary.json
```

It also writes run metadata, including the generated hostname, to:

```bash
infra/smoke-test/.runtime/smoke-metadata.env
```

Use the Playwright-style browser smoke wrapper after provisioning:

```bash
./scripts/smoke-playwright.sh
```

Use `./scripts/smoke-playwright.sh --test` (or `npm run smoke:playwright-test`) to execute the same browser smoke assertion without saving a screenshot; this is the regression you want in CI.

The wrapper reads the local summary file, uses a tokenized manager access URL when one is present, and stores a screenshot at `infra/smoke-test/.runtime/browser-smoke.png`.

## Cleanup

Destroy the stack later with:

```bash
./scripts/ec2-smoke-test.sh destroy --region us-west-2
```

## Notes

- The current Ansible flow still packages the sibling `../ai-agent-browser` checkout onto the host. `--aab-npm-package` controls the package name used inside that deployment flow.
- The wrapper leaves the instance running by default for manual inspection.
- `80/tcp` and `443/tcp` now default to your current public IP. Use `--public-web-ingress` only when broader exposure is intentional.
- The host always delegates nginx, VNC password handling, and certbot issuance to `novnc-openbox` `v0.1.0`.
- The delegated Route 53 zone named by `--tls-domain` must already exist and be publicly delegated. Per-run hostname creation now happens inside the Terraform smoke stack, so the separate A-record helper step is no longer needed for each run.
- The manager smoke desktop now starts at display `:2` so the role-managed desktop on `:1` can coexist without port or display collisions.

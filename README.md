# ai-agent-desktop-manager

[![CI](https://github.com/markcallen/ai-agent-desktop-manager/actions/workflows/ci.yml/badge.svg)](https://github.com/markcallen/ai-agent-desktop-manager/actions/workflows/ci.yml)
[![Lint](https://github.com/markcallen/ai-agent-desktop-manager/actions/workflows/lint.yml/badge.svg)](https://github.com/markcallen/ai-agent-desktop-manager/actions/workflows/lint.yml)
[![License](https://img.shields.io/github/license/markcallen/ai-agent-desktop-manager)](LICENSE)
[![GitHub Release](https://img.shields.io/github/v/release/markcallen/ai-agent-desktop-manager)](https://github.com/markcallen/ai-agent-desktop-manager/releases)

A localhost-first control plane that provisions isolated **agent desktops** on a Linux host:

- VNC/Openbox desktop (per display)
- noVNC access in your browser (per route)
- Chrome running in that desktop with **CDP enabled**
- ai-agent-browser instance wired to that Chrome (screenshots, console, network, actions)

It also supports **dynamic Nginx routes** (write snippet → validate → reload) so you can run multiple desktops (and multiple agents) at the same time.

## Why this exists

noVNC is the _human_ view. Agents need DevTools-grade access. The combo looks like this:

- **You:** connect to `https://host/desktop/3/` and watch the desktop
- **Agent:** call `http://127.0.0.1:8767` (ai-agent-browser) to see and act
- **Manager:** create/destroy/register everything via one API call

---

## Quickstart

### Prereqs

On the Linux host:

- A working noVNC/Openbox stack (your `novnc-openbox` project is perfect)
- Nginx serving noVNC via websockify
- Node.js 22+ (see `.nvmrc` for recommended version)
- systemd (recommended)

Optional but recommended:

- `ai-agent-browser` installed as a runnable service or command

### Install

```bash
git clone https://github.com/markcallen/ai-agent-desktop-manager.git
cd ai-agent-desktop-manager
npm install
npm run build
```

For server deployments, prefer the release artifact from GitHub Releases instead of cloning the repo. Each release publishes `ai-agent-desktop-manager-vX.Y.Z-linux-x64.tar.gz`.

### Install from release artifact

```bash
curl -LO https://github.com/markcallen/ai-agent-desktop-manager/releases/download/vX.Y.Z/ai-agent-desktop-manager-vX.Y.Z-linux-x64.tar.gz
tar -xzf ai-agent-desktop-manager-vX.Y.Z-linux-x64.tar.gz
cd ai-agent-desktop-manager
sudo ./scripts/install-release.sh
```

### Configure

Copy and edit `.env.example`:

```bash
cp .env.example .env
```

### Run (dev)

```bash
npm run dev
```

Default:

- manager: `127.0.0.1:8899`
- nginx snippet dir: `/etc/nginx/conf.d/agent-desktops`
- route template: `/desktop/{display}/`
- state dir: `./data`
- route auth mode: `none`
- TTL sweeper: every 60 seconds, but it only deletes desktops created with `ttlMinutes`

### Protected desktop routes

For localhost-only development, leave route auth disabled.

For externally exposed desktops, you have two protected-route modes:

`auth_request` for an external verifier:

```bash
AADM_DESKTOP_ROUTE_AUTH_MODE=auth_request
AADM_DESKTOP_ROUTE_AUTH_REQUEST_URL=http://127.0.0.1:3001/verify
AADM_DESKTOP_ROUTE_AUTH_REQUEST_HEADERS=x-auth-request-user,x-orchestrator-token
```

`AADM_DESKTOP_ROUTE_AUTH_REQUEST_URL` should point at an HTTP verifier that returns:

- `2xx` to allow access
- `401` or `403` to deny access
- `5xx` if verification infrastructure fails

The manager always forwards:

- `X-Original-URI`
- `X-Original-Method`
- `X-Forwarded-Host`
- `X-Forwarded-Proto`

It also forwards any request headers listed in `AADM_DESKTOP_ROUTE_AUTH_REQUEST_HEADERS`.

`token` for manager-issued secure access URLs:

```bash
AADM_DESKTOP_ROUTE_AUTH_MODE=token
AADM_DESKTOP_ROUTE_TOKEN_SECRET=<long-random-secret>
AADM_DESKTOP_ROUTE_TOKEN_TTL_SECONDS=900
AADM_PUBLIC_BASE_URL=https://desktop.example.com
```

In token mode, the manager mints a short-lived, signed URL that exchanges a token for an HttpOnly cookie; nginx uses that cookie to protect the desktop route. The token is valid until it expires (not single-use), so keep the TTL short and `AADM_PUBLIC_BASE_URL` on `https://...` when exposing the desktop externally.

---

## Dynamic Nginx routing (recommended setup)

### 1) Create snippet directory

```bash
sudo mkdir -p /etc/nginx/conf.d/agent-desktops
```

### 2) Ensure your Nginx config includes the directory

In the appropriate `server {}` block, add:

```nginx
include /etc/nginx/conf.d/agent-desktops/*.conf;
```

Reload once:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

### 3) What the manager writes per desktop

Example file: `/etc/nginx/conf.d/agent-desktops/desk-3.conf`

```nginx
location /desktop/3/ {
  proxy_pass http://127.0.0.1:6083/;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_read_timeout 3600;
}
```

The manager writes that snippet, runs `nginx -t`, then reloads Nginx.

When route protection is enabled, each desktop snippet also includes an internal auth verifier location plus `auth_request` directives on the desktop locations. Token mode adds a separate access bootstrap location that mints the cookie before redirecting into noVNC.

### Optional HTTPS with certbot

The EC2 smoke helper now uses `novnc-openbox` release `v0.1.0` to provision the base Openbox/noVNC/nginx/auth/TLS stack. This repo only layers the manager and its dynamic desktop routes on top.

The smoke/deployment helper can request a certificate with certbot and nginx HTTP-01 when you have:

- a public DNS name pointed at the host
- inbound port 80 and 443 access to the host
- a valid email address for Let's Encrypt registration

When you run the EC2 smoke helper, `--tls-domain` is treated as the delegated smoke zone. Terraform creates a per-run hostname in that zone and points it at the EC2 instance automatically before certbot runs. `--tls-domain` and `--tls-email` are required.

Example:

```bash
./scripts/ec2-smoke-test.sh run --region us-west-1 --tls-domain smoke.markcallen.dev --tls-email ops@example.com
```

### Recommended DNS setup for live TLS smoke tests

The cleanest way to run live TLS smoke tests is to delegate a dedicated subdomain such as `smoke.markcallen.dev` to Route 53, then let Terraform create ephemeral hostnames under that zone for each run.

Why this is the recommended shape:

- it avoids giving the smoke workflow direct write access to your primary DNS provider
- it keeps blast radius low by isolating smoke records under a single delegated zone
- it fits certbot HTTP-01, which needs a public hostname that resolves directly to the EC2 host on port 80

Recommended flow:

1. Create or reuse a delegated zone such as `smoke.markcallen.dev` in Route 53.
2. Delegate that subdomain from the parent zone.
3. Run the smoke helper with that delegated zone.
4. Terraform will mint a per-run hostname in that zone and create the A record automatically.

This repo still includes a helper for delegated-zone bootstrap and verification:

```bash
./scripts/route53-smoke-subdomain.sh --subdomain-zone smoke.markcallen.dev --check
./scripts/route53-smoke-subdomain.sh --subdomain-zone smoke.markcallen.dev
```

Use `--check` for a read-only validation that the public `NS` delegation for the subdomain matches the Route 53 hosted zone. If the parent zone is also hosted in Route 53, normal mode will upsert the NS delegation automatically. If the parent zone is managed elsewhere, the script prints the exact name servers to add manually.

Cloudflare example:

1. Run the helper once without `--record-name` to create the delegated Route 53 zone and print the Route 53 name servers.
2. In Cloudflare for the parent zone, add `NS` records for `smoke.markcallen.dev` pointing at those Route 53 name servers.
3. Keep the final smoke hostname DNS-only. Do not proxy it through Cloudflare.
4. After delegation is live, run the EC2 smoke helper and let Terraform create the per-run hostname in Route 53.

Example end-to-end:

```bash
./scripts/route53-smoke-subdomain.sh --subdomain-zone smoke.markcallen.dev
./scripts/ec2-smoke-test.sh run \
  --region us-west-1 \
  --tls-domain smoke.markcallen.dev \
  --tls-email ops@example.com
```

Notes:

- `http-01` requires inbound port 80 and 443 to the smoke host.
- DNS changes must have propagated before certbot runs.
- For repeated smoke runs, reuse the delegated zone and let Terraform rotate the per-run hostname.
- `./scripts/ec2-smoke-test.sh run` writes `infra/smoke-test/.runtime/aadm-smoke-summary.json`, and `./scripts/smoke-playwright.sh` can replay a browser smoke test from that summary in CI or locally.
- `npm run smoke:playwright-test` calls `./scripts/smoke-playwright.sh --test`, which loads the same summary and runs the Playwright smoke assertion instead of taking a screenshot.

---

## Security model (how to avoid “root Node”)

Run the manager as a service user (e.g., `aadm`) and grant narrow sudo.

### 1) Create service user

```bash
sudo useradd -r -m -s /usr/sbin/nologin aadm || true
```

### 2) Allow writing snippet files

```bash
sudo chown -R aadm:aadm /etc/nginx/conf.d/agent-desktops
```

### 3) Allow only the commands needed (sudoers)

Install the sample file in `ops/sudoers-aadm`:

```bash
sudo cp ops/sudoers-aadm /etc/sudoers.d/aadm
sudo chmod 440 /etc/sudoers.d/aadm
```

This allows:

- `nginx -t`
- `systemctl reload nginx`
- starting/stopping/checking status of **specific** template services (see file)

---

## Deployment runbook (systemd)

1. Download and unpack the release artifact:

```bash
curl -LO https://github.com/markcallen/ai-agent-desktop-manager/releases/download/vX.Y.Z/ai-agent-desktop-manager-vX.Y.Z-linux-x64.tar.gz
tar -xzf ai-agent-desktop-manager-vX.Y.Z-linux-x64.tar.gz
cd ai-agent-desktop-manager
```

2. Install runtime dependencies and service files:

```bash
sudo ./scripts/install-release.sh
```

3. Review and edit the environment file:

```bash
sudoedit /opt/ai-agent-desktop-manager/.env
```

4. Reload systemd and restart manager:

```bash
sudo systemctl restart aadm.service
```

5. Verify manager health:

```bash
curl -s http://127.0.0.1:8899/health | jq
```

6. Create and verify one desktop:

```bash
curl -sX POST http://127.0.0.1:8899/v1/desktops -H 'content-type: application/json' -d '{}' | jq
curl -s http://127.0.0.1:8899/v1/desktops/desk-1/doctor | jq
```

---

## Orchestration strategy

This repo uses **systemd template units** per desktop:

- `vnc@.service`
- `websockify@.service`
- `chrome@.service`
- `aab@.service` (ai-agent-browser)

Ports are derived from display and `.env` minima:

- `wsPort  = AADM_WEBSOCKIFY_PORT_MIN + (display - AADM_DISPLAY_MIN)`
- `cdpPort = AADM_CDP_PORT_MIN + (display - AADM_DISPLAY_MIN)`
- `aabPort = AADM_AAB_PORT_MIN + (display - AADM_DISPLAY_MIN)`

---

## API

Base: `http://127.0.0.1:8899`

### Health

```bash
curl -s http://127.0.0.1:8899/health | jq
```

### Create a desktop

```bash
curl -sX POST http://127.0.0.1:8899/v1/desktops \
  -H 'content-type: application/json' \
  -d '{ "owner":"codex", "label":"issue-123", "ttlMinutes":120, "startUrl":"https://example.com" }' | jq
```

`ttlMinutes` is optional. If omitted, the desktop does not expire automatically.

To opt a desktop into route protection explicitly:

```bash
curl -sX POST http://127.0.0.1:8899/v1/desktops \
  -H 'content-type: application/json' \
  -d '{ "owner":"codex", "label":"protected", "routeAuthMode":"auth_request" }' | jq
```

`routeAuthMode` supports:

- `inherit` to use the deployment default
- `none` to force an open route
- `auth_request` to require the configured verifier
- `token` to return a manager-issued access URL

If `AADM_ALLOWED_START_URL_DOMAINS` is set, `startUrl` must match one of the allowed hostnames or subdomains.

### List

```bash
curl -s http://127.0.0.1:8899/v1/desktops | jq
```

### Doctor

```bash
curl -s http://127.0.0.1:8899/v1/desktops/desk-3/doctor | jq
```

Doctor reports:

- systemd status for VNC/websockify/chrome/aab
- Nginx snippet path + existence
- whether the generated desktop route is protected
- port checks for VNC/websockify/CDP/AAB
- effective route auth configuration for that desktop

### Destroy

```bash
curl -sX DELETE http://127.0.0.1:8899/v1/desktops/desk-3 | jq
```

---

## Using from your laptop

Use SSH forwarding instead of exposing ports:

```bash
ssh -L 8899:127.0.0.1:8899 user@server
```

Now your agent running locally can call:

- `http://127.0.0.1:8899`

---

## Publishing releases

GitHub Actions publishes the Linux server artifact from `.github/workflows/publish.yml`.

- `workflow_dispatch` creates the next `patch`, `minor`, or `major` tag, then builds and publishes the artifact.
- Pushing a `v*` tag builds the artifact from that exact tag and attaches it to a GitHub Release.

---

## CLI (human-friendly wrapper)

This repo includes a small CLI `aadm`:

```bash
npm run cli -- create --owner codex --label work --ttl 90 --start-url https://github.com
npm run cli -- create --owner codex --label private --route-auth-mode token
npm run cli -- access-url --id desk-3
npm run cli -- list
npm run cli -- destroy --id desk-3
```

---

## MCP server

This repo also includes a stdio MCP adapter that exposes the desktop lifecycle as tools for agent clients:

```bash
AADM_URL=http://127.0.0.1:8899 npm run mcp
```

See [docs/mcp.md](./docs/mcp.md) for the tool list and Codex/Claude wiring notes.

---

## Prompts for Codex/Claude (copy/paste)

### Prompt: install and enable manager

“Install ai-agent-desktop-manager from this repo. Configure it to bind to localhost. Ensure Nginx includes `/etc/nginx/conf.d/agent-desktops/*.conf`. Install the sudoers allowlist for the `aadm` user. Start the manager and verify `/health` returns ok. Then create a desktop and return the noVNC URL and the ai-agent-browser URL.”

### Prompt: create desktop + verify agent channel

“Call the desktop manager to create a new desktop (TTL 60 minutes) and start URL `https://example.com`. After creation, call the returned ai-agent-browser `/screenshot` endpoint and report: image dimensions, any console errors, and any failed network requests.”

### Prompt: cleanup

“Destroy the desktop you created. Confirm it no longer appears in `desktop.list` and that its Nginx snippet file was removed.”

---

## Development

### Prerequisites

- **Node.js**: Use the version in `.nvmrc`. Supported: Node 22 (LTS) or 24 (Active LTS).
- [nvm](https://github.com/nvm-sh/nvm) (Node Version Manager)

After cloning the repo, install and use the project's Node version:

```bash
nvm install   # installs the version from .nvmrc
nvm use       # switches to it
npm install
```

### Linting and formatting

```bash
npm run lint        # check for lint issues
npm run lint:fix    # auto-fix lint issues
npm run prettier    # check formatting
npm run prettier:fix  # auto-format all files
```

### Run locally

```bash
npm run dev
```

### Build

```bash
npm run build
npm run start
```

### Test

```bash
npm test
```

### Configuration knobs

See `.env.example` for:

- port ranges
- nginx snippet directory
- auth token
- desktop route auth mode and verifier settings
- token route auth secret and TTL
- TTL sweep interval and `startUrl` allowlist
- HTTPS/certbot smoke deployment variables
- base URL template for noVNC links
- state directory

---

## Notes

- This repo ships scaffolding and safe patterns. You’ll likely adjust unit files and paths to match your host distro and your existing noVNC install.
- Keep CDP and ai-agent-browser bound to localhost. Use SSH tunnels for access.
- Startup now fails fast if configured `nginx` or `systemctl` binaries are not executable.

## License

MIT License - see [LICENSE](LICENSE) file for details.

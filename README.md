# ai-agent-desktop-manager

A localhost-first control plane that provisions isolated **agent desktops** on a Linux host:

- VNC/Openbox desktop (per display)
- noVNC access in your browser (per route)
- Chrome running in that desktop with **CDP enabled**
- ai-agent-browser instance wired to that Chrome (screenshots, console, network, actions)

It also supports **dynamic Nginx routes** (write snippet → validate → reload) so you can run multiple desktops (and multiple agents) at the same time.

## Why this exists
noVNC is the *human* view. Agents need DevTools-grade access. The combo looks like this:

- **You:** connect to `https://host/desktop/3/` and watch the desktop
- **Agent:** call `http://127.0.0.1:8767` (ai-agent-browser) to see and act
- **Manager:** create/destroy/register everything via one API call

---

## Quickstart

### Prereqs
On the Linux host:
- A working noVNC/Openbox stack (your `novnc-openbox` project is perfect)
- Nginx serving noVNC via websockify
- Node.js 20+
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

1) Build the project:
```bash
npm install
npm run build
```

2) Copy units and sudoers:
```bash
sudo cp systemd/*.service /etc/systemd/system/
sudo cp ops/sudoers-aadm /etc/sudoers.d/aadm
sudo chmod 440 /etc/sudoers.d/aadm
```

3) Reload systemd and enable manager:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now aadm.service
```

4) Verify manager health:
```bash
curl -s http://127.0.0.1:8899/health | jq
```

5) Create and verify one desktop:
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
- port checks for VNC/websockify/CDP/AAB

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

## CLI (human-friendly wrapper)
This repo includes a small CLI `aadm`:

```bash
npm run cli -- create --owner codex --label work --ttl 90 --start-url https://github.com
npm run cli -- list
npm run cli -- destroy --id desk-3
```

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

### Run locally
```bash
npm install
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
- base URL template for noVNC links
- state directory

---

## Notes
- This repo ships scaffolding and safe patterns. You’ll likely adjust unit files and paths to match your host distro and your existing noVNC install.
- Keep CDP and ai-agent-browser bound to localhost. Use SSH tunnels for access.
- Startup now fails fast if configured `nginx` or `systemctl` binaries are not executable.

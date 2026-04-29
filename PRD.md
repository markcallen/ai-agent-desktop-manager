# PRD — ai-agent-desktop-manager

## One-liner

A localhost-only control plane that provisions isolated remote Linux “agent desktops” (VNC + noVNC + Chrome CDP + ai-agent-browser), dynamically registers Nginx routes, and exposes a small API (plus MCP + CLI adapters) so Codex/Claude can create, inspect, and destroy desktops as a **skill**.

## Background

A noVNC desktop is great for humans. AI agents need a browser control plane with deterministic actions and DevTools signal (console, network, errors). The pattern is:

- **Human channel:** noVNC renders the desktop.
- **Agent channel:** ai-agent-browser exposes CDP-powered endpoints (screenshots, console, network, actions).

To run multiple agents simultaneously, we spin up multiple independent VNC displays (`:1`, `:2`, …) and route each through Nginx paths (or subdomains).

## Goals

1. Create and manage multiple desktops safely and repeatably.
2. Dynamically register and remove Nginx routes per desktop.
3. Reload Nginx safely (validate config first).
4. Keep CDP and ai-agent-browser bound to localhost by default.
5. Make the system easy to drive from within an AI agent via a “skill” interface:
   - MCP tools (structured)
   - CLI (human-friendly and fallback)

## Non-goals

- Replacing noVNC.
- Exposing public APIs by default.
- A full test runner (Playwright Test) or CI framework.
- Multi-tenant IAM out of the box.

## Key entities

### Desktop

A provisioned workspace identified by an id:

- VNC display: `:N`
- VNC port: `5900 + N`
- websockify port: allocated (default: `6080 + N`)
- Nginx route: `/desktop/N/` → websockify port
- Chrome CDP port: allocated (default: `9221 + N`)
- ai-agent-browser port: allocated (default: `8764 + N`)
- Optional: owner/label/TTL

## Functional requirements

### API

Base: `http://127.0.0.1:8899`

#### Health

- `GET /health` → `{ ok, version, uptimeSec }`

#### Desktop lifecycle

- `POST /v1/desktops`
  - body:
    ```json
    {
      "owner": "codex|claude|user",
      "label": "string",
      "ttlMinutes": 120,
      "startUrl": "https://example.com"
    }
    ```
  - returns:
    ```json
    {
      "id": "desk-3",
      "display": 3,
      "novncUrl": "https://host/desktop/3/",
      "aabUrl": "http://127.0.0.1:8767",
      "cdp": { "host": "127.0.0.1", "port": 9224 },
      "status": "running"
    }
    ```

- `GET /v1/desktops` → list
- `GET /v1/desktops/:id` → details
- `DELETE /v1/desktops/:id` → stop + unregister route

#### Diagnostics

- `GET /v1/desktops/:id/doctor` → checks (ports, services, nginx route file exists)

### Desktop shell

- The browser desktop shell must resolve terminal and bridge websocket endpoints against the desktop's public base URL.
- The shell must not prefer `localhost`, `127.0.0.1`, or `::1` for browser websocket connections when the desktop is being accessed through a non-loopback public URL.
- When the desktop web app is served through the local manager dev server on port `8899`, the manager must proxy Vite HMR websocket upgrades for both `/_aadm_hmr` and `/_aadm/desktop-app/_aadm_hmr` and preserve the original query string.
- The managed terminal session and terminal attach process must provide a clear-capable terminal type so shell startup scripts that invoke `clear` do not fail the Terminal tab.
- When `ai-agent-bridge` is enabled, its runtime configuration must allow the manager-owned workspace root `/opt/ai-agent-desktop-manager/data/workspaces` and mount that same absolute path inside the bridge container so session `repo_path` validation and process working directories agree.
- The Ansible deployment flow for `ai-agent-bridge` must ensure the Docker daemon is enabled before the bridge unit starts, and must restart the bridge unit whenever the shipped unit file, bridge config, or bridge environment file changes.
- The shipped `bridge.service` unit must expand API key values from `/opt/ai-agent-bridge/.env` before invoking `docker run`, so the container receives concrete provider credentials rather than literal placeholder strings.
- The final Ansible smoke verification must assert that `docker`, `aadm.service`, and `nginx` are active, and must also assert `bridge.service` is active when the bridge deployment path is enabled.
- The browser desktop shell must use a Pino-based logger for browser-side diagnostics.
- Browser logging must capture `console.log`, `console.info`, `console.debug`, `console.warn`, `console.error`, uncaught errors, and unhandled promise rejections.
- Browser logging must POST batched Pino log events to `/_aadm/logs` with the per-desktop browser logs token.
- The manager must ingest those browser log events and emit them through the server Pino logger without exposing sensitive auth headers or cookies.
- The AI Agent tab must initialize its provider selector from the configured `ai-agent-bridge` provider list in bridge YAML instead of a hardcoded single-provider fallback.
- Pressing Stop in the AI Agent tab must immediately clear the embedded `xterm.js` terminal output so stale session text is not left visible after the session ends.
- The AI Agent tab must preserve terminal scrollback so a user can scroll up to review previous agent messages from the current tab session.
- Acceptance criteria:
  - Given a public desktop URL on a non-loopback host and a relative websocket path, the browser connects to that public host.
  - Given a public desktop URL on a non-loopback host and a stored absolute websocket URL that points at loopback, the browser rewrites it to the public host before connecting.
  - The terminal websocket URL shown in the UI matches the resolved browser connection URL.
  - Given local desktop-app dev assets are served through the manager on port `8899` and Vite opens HMR at `/_aadm/desktop-app/_aadm_hmr?token=...`, the manager accepts that websocket upgrade and proxies it to the Vite dev server as `/_aadm_hmr?token=...`.
  - Given a shell profile or terminal helper that invokes `clear`, opening the Terminal tab still attaches successfully because the tmux session and attach wrapper both expose a non-dumb `TERM`.
  - Given the bridge receives `repo_path` `/opt/ai-agent-desktop-manager/data/workspaces/<desktop-id>`, session startup succeeds because that path is both allowlisted and mounted at the same absolute location inside the bridge container.
  - Given Ansible changes `bridge.service`, `bridge.yaml`, or the bridge `.env`, the playbook reloads systemd and restarts `bridge.service` before waiting on port `9445`.
  - Given `bridge.service` starts from `/opt/ai-agent-bridge/.env`, the `docker run` command passes the resolved `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, and `GEMINI_API_KEY` values into the container instead of the literal strings `$ANTHROPIC_API_KEY`, `$OPENAI_API_KEY`, and `$GEMINI_API_KEY`.
  - Given bridge installation is enabled, the final smoke verification inspects the running `ai-agent-bridge` container environment and fails if any provider API key is still the literal placeholder string `$ANTHROPIC_API_KEY`, `$OPENAI_API_KEY`, or `$GEMINI_API_KEY`.
  - At the end of the smoke play, Ansible fails if `docker`, `aadm.service`, or `nginx` are not active, and also fails if `bridge.service` is not active when bridge installation is enabled.
  - Given a browser console call after desktop config load, the web app emits a Pino browser log event to `/_aadm/logs`.
  - Given an uncaught browser error or unhandled promise rejection after desktop config load, the web app emits an error-level Pino browser log event to `/_aadm/logs`.
  - Given a valid batch of browser Pino log events at `/_aadm/logs`, the manager writes them through its server logger with browser metadata preserved.
  - Given the bridge YAML defines providers in a specific order, the AI Agent tab shows those configured provider names in that order and defaults to the first configured provider.
  - Given the AI Agent terminal shows prior session output, pressing Stop clears the visible `xterm.js` buffer before any later session starts.
  - Given the AI Agent terminal has emitted multiple messages during the current tab session, the user can scroll back in the `xterm.js` viewport to inspect earlier output.

### Orchestration

For each desktop, the manager must:

1. Allocate `display`, `wsPort`, `cdpPort`, `aabPort`.
2. Start runtime:
   - VNC (display)
   - websockify (port → VNC port)
   - Chrome (bound to that display, CDP port, unique user-data-dir)
   - ai-agent-browser instance bound to localhost, configured to that CDP port
3. Register Nginx route snippet.
4. Validate Nginx config (`nginx -t`).
5. Reload Nginx (`systemctl reload nginx`).

### Dynamic Nginx routing

- Nginx config includes a snippet directory:
  - `include /etc/nginx/conf.d/agent-desktops/*.conf;`
- Manager writes one file per desktop:
  - `/etc/nginx/conf.d/agent-desktops/desk-3.conf`
- Manager validates + reloads Nginx after changes.

### Cleanup

- TTL support: background sweep deletes expired desktops.
- Idle cleanup is a future enhancement; v1 focuses on TTL.

## Non-functional requirements

- Default bind to localhost only.
- Minimal privileges:
  - Run manager as service user (e.g., `aadm`)
  - Grant restricted sudo for `nginx -t`, `systemctl reload nginx`, `systemctl start/stop` for known units.
- Atomic writes for Nginx snippet files.
- Concurrency-safe allocations (file lock).

## Security

- Never expose CDP publicly; bind Chrome debug port to `127.0.0.1`.
- ai-agent-browser binds to `127.0.0.1`.
- noVNC is exposed via HTTPS through Nginx.
- Optional bearer auth for the manager API.
- No logging of cookies/headers by default.

## Milestones

### v0.1 (MVP)

- State registry (JSON file)
- Create/list/get/destroy
- Nginx snippet write + `nginx -t` + reload
- Basic doctor endpoint
- CLI wrapper

### v0.2

- MCP server wrapper
- TTL sweeper
- Better port allocation ranges

### v0.3

- Subdomain routing option
- Live event stream
- Per-user Linux accounts option

## Success criteria

- A developer can create 3 desktops and see:
  - 3 distinct noVNC URLs
  - 3 distinct ai-agent-browser endpoints
- Nginx reload remains safe and predictable.
- The agent can drive the entire lifecycle using a single “skill” toolset.

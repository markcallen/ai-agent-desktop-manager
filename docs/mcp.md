# MCP Integration

`ai-agent-desktop-manager` ships a stdio MCP server wrapper around the localhost manager API.

## Exposed tools

- `desktop.create`
- `desktop.list`
- `desktop.get`
- `desktop.destroy`
- `desktop.doctor`

All tools call the manager API at `AADM_URL` and forward `AADM_AUTH_TOKEN` as a bearer token when it is set.

## Run locally

```bash
AADM_URL=http://127.0.0.1:8899 npm run mcp
```

If the manager API is protected:

```bash
AADM_URL=http://127.0.0.1:8899 \
AADM_AUTH_TOKEN=replace-me \
npm run mcp
```

## Codex and Claude

Register a stdio MCP server with:

- command: `npm`
- args: `run`, `mcp`
- working directory: this repository root
- env:
  - `AADM_URL=http://127.0.0.1:8899`
  - `AADM_AUTH_TOKEN=...` when API auth is enabled

The exact config file shape varies by client version, but the process contract is stable: launch `npm run mcp` from this repo and provide the manager URL and optional bearer token through the environment.

## Notes

- `ttlMinutes` remains optional. Only desktops created with a TTL are eligible for background cleanup.
- `startUrl` can be restricted with `AADM_ALLOWED_START_URL_DOMAINS`.
- The manager rejects create requests if the allocated desktop ports are already listening according to `ss -lntH`.

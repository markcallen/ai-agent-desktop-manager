# TODO — ai-agent-desktop-manager

## MVP hardening
- [ ] Add TTL sweeper that deletes expired desktops every minute
- [ ] Add per-desktop “idle” tracking using ai-agent-browser heartbeat (optional)
- [ ] Add structured logging with request ids

## Nginx routing
- [ ] Support subdomain routing option (wildcard DNS + cert)
- [ ] Batch Nginx reload when creating multiple desktops
- [ ] Add optional per-desktop Basic Auth snippet support

## Orchestration
- [ ] Add “restart desktop” endpoint that restarts all units in order
- [ ] Add port collision detection via `ss -lnt`

## Agent skill integration
- [ ] Add MCP server wrapper exposing tools:
  - desktop.create
  - desktop.list
  - desktop.get
  - desktop.destroy
  - desktop.doctor
- [ ] Add tool docs for Claude/Codex configuration

## Testing
- [ ] Add end-to-end smoke tests against a real host setup

## Security
- [ ] Optional bearer auth for manager API (env-controlled)
- [ ] Redaction of secrets in logs (URLs, tokens)
- [ ] Add “allowed startUrl domains” allowlist option

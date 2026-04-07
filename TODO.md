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

- [x] Add end-to-end smoke tests against a real host setup
- [x] Provision a dedicated EC2 Linux instance for MVP validation (security group, SSH access, hostname/TLS plan)
- [x] Install and configure runtime dependencies on EC2 (`nginx`, `systemd`, VNC stack, `websockify`, Chrome, `ai-agent-browser`)
- [x] Deploy `ai-agent-desktop-manager` to EC2, install `systemd/*.service` + `ops/sudoers-aadm`, and start `aadm.service`
- [x] Execute full MVP acceptance on EC2 using `MVP_ACCEPTANCE.md` (create 3 desktops, doctor checks, destroy all) and capture command outputs
- [x] Persist EC2 acceptance artifacts in repo docs (`MVP_ACCEPTANCE.md`)
- [ ] Re-enable `ai-agent-browser` installation in `infra/ansible/playbooks/aadm_smoke.yml` after confirming the correct package source and install method
- [ ] Replace the hardcoded VNC password in `infra/ansible/playbooks/aadm_smoke.yml` with safer smoke-test credential handling and clear operator output
- [x] Add token and auth_request access control for the noVNC entrypoint
- [x] Enable HTTPS for the smoke-test noVNC/nginx endpoint with Let's Encrypt via certbot

## Security

- [ ] Optional bearer auth for manager API (env-controlled)
- [ ] Redaction of secrets in logs (URLs, tokens)
- [ ] Add “allowed startUrl domains” allowlist option

## Web auth

- [x] Add JWT token based auth for the webapp/noVNC entrypoint so VNC sessions are protected behind signed, expiring access tokens
- [x] Define token issuance, validation, expiry, and revocation behavior for desktop session URLs

## Deployment hardening

- [ ] Verify distro-specific binary paths and unit behavior on production host (`vncserver`, `websockify`, `google-chrome`, `ai-agent-browser`)

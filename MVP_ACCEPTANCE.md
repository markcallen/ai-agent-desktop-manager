# MVP Acceptance Report (v0.1)

## Status

- Local unit/integration test suite: **PASS**
- TypeScript build: **PASS**
- Real host orchestration acceptance (systemd + nginx + multi-desktop): **PASS**

## Local verification

1. `npm test`
   - unit: allocator behavior and exhaustion
   - unit: nginx snippet generation
   - integration: auth enforcement, create success + doctor checks, create rollback on nginx failure

2. `npm run build`
   - TypeScript compilation succeeds

## Real host acceptance — PASS

Validated by `./scripts/smoke-playwright.sh --test` against a live EC2 instance
(`t3.large`, Ubuntu 24.04, us-east-2) provisioned with `./scripts/ec2-smoke-test.sh`.
All 22 Playwright tests pass in ~42 seconds.

### 1. Manager health

```
GET /health → 200 { ok: true, version: "0.1.1", uptimeSec: ... }
```

### 2. Multi-desktop create and verify

Three desktops created across the test run (no-auth, token, auth_request modes):

| Desktop | Mode         | novncUrl               | aabUrl                  |
| ------- | ------------ | ---------------------- | ----------------------- |
| desk-N  | none         | `/desktop/N/vnc.html…` | `http://127.0.0.1:876N` |
| desk-N  | token        | `/desktop/N/vnc.html…` | `http://127.0.0.1:876N` |
| desk-N  | auth_request | `/desktop/N/vnc.html…` | `http://127.0.0.1:876N` |

Distinct displays, noVNC URLs, CDP ports, and AAB ports confirmed per desktop.

### 3. Doctor checks (all green)

For each created desktop:

- `services.vnc`, `services.websockify`, `services.chrome`, `services.aab` → `true`
- `ports.vnc`, `ports.websockify`, `ports.cdp`, `ports.aab` → `true`
- `nginx.snippetExists` → `true`
- `nginx.protected` → matches the desktop's auth mode

### 4. Browser acceptance

- **Token mode**: `accessUrl` → nginx 302 → `vnc.html` → cookie set → noVNC canvas renders
- **Token mode**: direct access without cookie → nginx returns 401
- **auth_request mode**: mock verifier returns 200 → noVNC canvas renders
- **auth_request mode**: mock verifier returns 401 → nginx returns 401

### 5. Destroy and cleanup

For each desktop:

- `DELETE /v1/desktops/:id` → `{ ok: true }`
- `GET /v1/desktops/:id` → 404
- Nginx snippet removed; `nginx -t` + reload remain healthy

## Notes

- Multi-desktop operation validated with three concurrent auth modes.
- Token access URL TTL, cookie path scoping, and `ttl_seconds_too_large` enforcement verified.
- auth_request mode tested via SSH reverse-tunnel mock verifier allowing allow/deny control from CI.
- The repository enforces deterministic display-derived port mapping and create rollback safety.

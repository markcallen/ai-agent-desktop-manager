# MVP Acceptance Report (v0.1)

## Status

- Local unit/integration test suite: PASS
- TypeScript build: PASS
- Real host orchestration acceptance (systemd + nginx + 3 desktops): PENDING

## Local verification completed

1. `npm test`

- unit: allocator behavior and exhaustion
- unit: nginx snippet generation
- integration: auth enforcement, create success + doctor checks, create rollback on nginx failure

2. `npm run build`

- TypeScript compilation succeeds

## Real host acceptance checklist (pending)

1. Start manager service and verify:

- `GET /health` returns `{ ok: true, ... }`

2. Create 3 desktops and verify:

- 3 distinct `novncUrl` values
- 3 distinct `aabUrl` values

3. Run doctor on each desktop and verify:

- systemd services active
- expected ports open
- nginx snippet exists

4. Destroy all desktops and verify:

- removed from list/state
- snippets removed
- nginx test/reload remains healthy

## Notes

- The repository now enforces deterministic display-derived port mapping and create rollback safety.
- Final validation requires a Linux host with working VNC/noVNC/websockify/chrome/ai-agent-browser and sudoers/systemd wiring.

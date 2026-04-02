# PLAN — MVP Delivery (v0.1)

## Execution status

- [x] Phase 1: Runtime Contract Alignment
- [x] Phase 2: Lifecycle Safety and Rollback
- [x] Phase 3: Doctor Endpoint Completion
- [x] Phase 4: Host Integration Assets (repo side)
- [x] Phase 5: Configuration and Validation
- [x] Phase 6: Tests
- [ ] Phase 7: MVP Acceptance on real target host (requires host with full runtime stack)

## Objective

Deliver the v0.1 MVP defined in `PRD.md`:

- JSON state registry
- create/list/get/destroy lifecycle
- dynamic Nginx snippet write + `nginx -t` + reload
- basic doctor endpoint
- CLI wrapper
- successful multi-desktop operation (3 desktops) with predictable cleanup

## Scope

### In scope (MVP)

- Make orchestration/runtime contracts consistent (display-to-port mapping and returned API values)
- Harden create/destroy flows for safe rollback on partial failures
- Complete doctor checks to include route file + port/service verification
- Provide usable systemd templates and documented host setup
- Validate configuration at startup
- Add minimum test coverage for allocator + Nginx snippet + integration behavior
- Run MVP acceptance validation and document results

### Out of scope (post-MVP)

- MCP wrapper
- TTL sweeper and idle cleanup
- Subdomain routing
- batch reload optimizations
- advanced auth and policy controls beyond current bearer token

## Work Plan

## Phase 1: Runtime Contract Alignment

1. Decide one port model and implement it consistently:

- Option A: derive ports from `display` everywhere
- Option B: pass explicit allocated ports into runtime units/scripts

2. Update API response values (`aabUrl`, `cdp`) to match actual runtime wiring.
3. Ensure persisted state reflects real process ports.

## Phase 2: Lifecycle Safety and Rollback

1. On create failure at any step:

- stop any units already started
- remove snippet if written
- avoid persisting a misleading running desktop record

2. On destroy:

- keep best-effort stop behavior
- ensure snippet removal + `nginx -t`/reload semantics are predictable and logged.

3. Add clear error paths for unit startup and nginx validation failures.

## Phase 3: Doctor Endpoint Completion

1. Extend doctor output to include:

- systemd unit statuses
- existence/path of expected Nginx snippet
- port checks for VNC/websockify/CDP/AAB listeners

2. Return a clear per-check pass/fail structure.

## Phase 4: Host Integration Assets

1. Replace placeholder `systemd/*.service` content with runnable templates for target host assumptions.
2. Ensure sudoers allowlist matches actual commands/units.
3. Fix docs to match repository reality (for example, remove or add referenced fallback scripts).
4. Provide a short deployment runbook in `README.md` for enabling the service end-to-end.

## Phase 5: Configuration and Validation

1. Add startup validation for:

- numeric range sanity (min <= max)
- port/display overlap risks
- required paths/binaries exist

2. Fail fast on invalid config with actionable error messages.

## Phase 6: Tests

1. Unit tests:

- allocator behavior and exhaustion
- Nginx snippet generation correctness

2. Integration tests (mocked shell/systemctl/nginx):

- create success path
- create rollback on nginx failure
- destroy cleanup path

3. Security/auth test:

- bearer token enforcement behavior

## Phase 7: MVP Acceptance

1. Validate `/health`.
2. Create 3 desktops and verify:

- 3 distinct noVNC URLs
- 3 distinct ai-agent-browser endpoints

3. Run doctor checks for each desktop.
4. Destroy all desktops and verify:

- removed from state/list
- snippet files removed
- Nginx test/reload remains healthy

5. Capture commands + outputs in a short verification section.

## Deliverables

- Updated server/runtime code implementing phases 1-3 and 5
- Updated `systemd/` and `ops/sudoers-aadm` integration assets
- Updated `README.md` deployment + validation instructions
- Test suite additions for unit/integration/security smoke
- Completed acceptance report for v0.1 MVP

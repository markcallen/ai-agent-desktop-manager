COMPOSE        := docker compose
LOCAL_COMPOSE  := $(COMPOSE) -f docker-compose.yaml -f docker-compose.local.yaml
CREATE_OWNER   ?= local
CREATE_LABEL   ?= test
CREATE_ROUTE_AUTH_MODE ?= token
ID             ?=

# ── production-style stack (built image, node dist/index.js) ─────────────────

up:
	$(COMPOSE) up --build

down:
	$(COMPOSE) down

logs:
	$(COMPOSE) logs -f

# ── local dev stack (source-mounted, hot-reload via tsx watch) ────────────────

up-local:
	$(LOCAL_COMPOSE) up --build --watch

down-local:
	$(LOCAL_COMPOSE) down

logs-local:
	$(LOCAL_COMPOSE) logs -f

check-local:
	@bash -lc 'set -euo pipefail; \
		echo "==> Checking local compose services"; \
		$(LOCAL_COMPOSE) ps; \
		echo; \
		echo "==> Checking manager health"; \
		curl -fsS http://127.0.0.1:8899/health | jq; \
		echo; \
		echo "==> Creating temporary desktop for doctor check"; \
		create_json=$$(curl -fsS -X POST http://127.0.0.1:8899/v1/desktops \
			-H "content-type: application/json" \
			-d "{\"owner\":\"local-check\",\"label\":\"make-check-local\"}"); \
		echo "$$create_json" | jq; \
		desktop_id=$$(echo "$$create_json" | jq -r ".id"); \
		if [[ -z "$$desktop_id" || "$$desktop_id" == "null" ]]; then \
			echo "failed to parse desktop id from create response" >&2; \
			exit 1; \
		fi; \
		cleanup() { \
			echo; \
			echo "==> Destroying temporary desktop $$desktop_id"; \
			curl -fsS -X DELETE "http://127.0.0.1:8899/v1/desktops/$$desktop_id" | jq || true; \
		}; \
		trap cleanup EXIT; \
		echo; \
		echo "==> Running doctor for $$desktop_id"; \
		curl -fsS "http://127.0.0.1:8899/v1/desktops/$$desktop_id/doctor" | jq; \
		echo; \
		echo "Local stack check passed."; \
	'

create-local-desktop:
	@bash -lc 'set -euo pipefail; \
		body=$$(jq -n \
			--arg owner "$(CREATE_OWNER)" \
			--arg label "$(CREATE_LABEL)" \
			--arg routeAuthMode "$(CREATE_ROUTE_AUTH_MODE)" \
			'"'"'{owner: $$owner, label: $$label} + (if $$routeAuthMode == "" then {} else {routeAuthMode: $$routeAuthMode} end)'"'"'); \
		create_json=$$(curl -fsS -X POST http://127.0.0.1:8899/v1/desktops \
			-H "content-type: application/json" \
			-d "$$body"); \
		echo "$$create_json" | jq; \
		access_url=$$(echo "$$create_json" | jq -r ".accessUrl // empty"); \
		if [[ -n "$$access_url" ]]; then \
			echo; \
			echo "Access URL: $$access_url"; \
		else \
			echo; \
			echo "No access URL returned. Set CREATE_ROUTE_AUTH_MODE=token to mint one." >&2; \
		fi; \
	'

destroy-local-desktop:
	@if [ -z "$(ID)" ]; then \
		echo "Usage: make destroy-local-desktop ID=desk-<n>" >&2; \
		exit 2; \
	fi
	@bash -lc 'set -euo pipefail; \
		curl -fsS -X DELETE "http://127.0.0.1:8899/v1/desktops/$(ID)" | jq; \
	'

# ── convenience ──────────────────────────────────────────────────────────────

# Remove persistent data volume (resets desktop state)
clean-data:
	$(COMPOSE) down -v

.PHONY: up down logs up-local down-local logs-local check-local create-local-desktop destroy-local-desktop clean-data

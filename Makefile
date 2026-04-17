COMPOSE        := docker compose
LOCAL_COMPOSE  := $(COMPOSE) -f docker-compose.yaml -f docker-compose.local.yaml

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

# ── convenience ──────────────────────────────────────────────────────────────

# Remove persistent data volume (resets desktop state)
clean-data:
	$(COMPOSE) down -v

.PHONY: up down logs up-local down-local logs-local clean-data

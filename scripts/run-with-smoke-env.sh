#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SMOKE_ENV_LOCAL="$ROOT_DIR/.env.smoke.local"
SMOKE_ENV_FALLBACK="$ROOT_DIR/.env.smoke"

if [[ -f "$SMOKE_ENV_LOCAL" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$SMOKE_ENV_LOCAL"
  set +a
elif [[ -f "$SMOKE_ENV_FALLBACK" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$SMOKE_ENV_FALLBACK"
  set +a
fi

exec "$@"

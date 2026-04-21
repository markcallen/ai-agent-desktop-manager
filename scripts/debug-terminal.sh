#!/usr/bin/env bash
# debug-terminal.sh — Run a focused diagnostic Playwright test against the
# desk-2 terminal tab on the smoke EC2 instance.
#
# Usage:
#   ./scripts/debug-terminal.sh [--keep-alive]
#
# The script:
#   1. Opens an SSH forward tunnel  local:18899 → EC2:8899  (aadm manager)
#   2. Mints a fresh access URL for desk-2 from the manager API
#   3. Runs test/playwright/terminal-debug.mts (Playwright + diagnostics)
#   4. Tears down the tunnel on exit (unless --keep-alive)
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TF_DIR="$ROOT_DIR/infra/smoke-test"
RUNTIME_DIR="$ROOT_DIR/infra/smoke-test/.runtime"
KEY_PATH="$RUNTIME_DIR/id_ed25519"

TUNNEL_MANAGER_LOCAL=18899
KEEP_ALIVE=false
SSH_PID=""

usage() {
  cat <<EOF
Usage: $(basename "$0") [--keep-alive]

  --keep-alive  Leave the SSH tunnel open after the test for manual debugging.
                Prints the tunnel PID and manager URL so you can inspect further.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --keep-alive) KEEP_ALIVE=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: $1" >&2; usage; exit 1 ;;
  esac
done

cleanup() {
  if [[ "$KEEP_ALIVE" == "true" && -n "$SSH_PID" ]]; then
    echo ""
    echo "debug-terminal: SSH tunnel kept alive (PID $SSH_PID)."
    echo "  Manager: http://127.0.0.1:${TUNNEL_MANAGER_LOCAL}"
    echo "  Kill with: kill $SSH_PID"
  elif [[ -n "$SSH_PID" ]]; then
    kill "$SSH_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
# 1. Get EC2 host
# ---------------------------------------------------------------------------
command -v terraform >/dev/null 2>&1 || { echo "terraform not found" >&2; exit 1; }

SMOKE_HOST="$(terraform -chdir="$TF_DIR" output -raw ssh_host 2>/dev/null)" || {
  echo "cannot get ssh_host from terraform state" >&2; exit 1
}
TLS_DOMAIN="$(terraform -chdir="$TF_DIR" output -raw tls_domain 2>/dev/null)" || true
PUBLIC_BASE_URL="https://${TLS_DOMAIN}"

echo "debug-terminal: EC2 host = $SMOKE_HOST"
echo "debug-terminal: public URL = $PUBLIC_BASE_URL"

# ---------------------------------------------------------------------------
# 2. Open SSH forward tunnel  local:18899 → EC2:8899
# ---------------------------------------------------------------------------
echo "debug-terminal: opening SSH tunnel..."
ssh \
  -i "$KEY_PATH" \
  -o BatchMode=yes \
  -o StrictHostKeyChecking=no \
  -o UserKnownHostsFile=/dev/null \
  -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=10 \
  -N \
  -L "${TUNNEL_MANAGER_LOCAL}:127.0.0.1:8899" \
  ubuntu@"$SMOKE_HOST" &
SSH_PID=$!

# Wait for tunnel to be ready
for _ in $(seq 1 20); do
  if bash -c ">/dev/tcp/127.0.0.1/$TUNNEL_MANAGER_LOCAL" 2>/dev/null; then
    echo "debug-terminal: tunnel ready."
    break
  fi
  sleep 1
done

# ---------------------------------------------------------------------------
# 3. Mint a fresh access URL for desk-2
# ---------------------------------------------------------------------------
echo "debug-terminal: minting access URL for desk-2..."
ACCESS_URL="$(
  curl -sf \
    -X POST \
    -H 'content-type: application/json' \
    -d '{}' \
    "http://127.0.0.1:${TUNNEL_MANAGER_LOCAL}/v1/desktops/desk-2/access-url" \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['accessUrl'])"
)" || {
  echo "debug-terminal: failed to mint access URL for desk-2 — is desk-2 running?" >&2
  exit 1
}
echo "debug-terminal: access URL = $ACCESS_URL"

# ---------------------------------------------------------------------------
# 4. Run the Playwright diagnostic test
# ---------------------------------------------------------------------------
echo "debug-terminal: running terminal diagnostic test..."
SMOKE_PLAYWRIGHT=true \
SMOKE_MANAGER_URL="http://127.0.0.1:${TUNNEL_MANAGER_LOCAL}" \
SMOKE_PUBLIC_BASE_URL="$PUBLIC_BASE_URL" \
SMOKE_ACCESS_URL="$ACCESS_URL" \
  node --import tsx --test \
    --test-name-pattern 'terminal debug' \
    test/playwright/terminal-debug.test.ts

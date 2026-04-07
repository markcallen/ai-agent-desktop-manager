#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TF_DIR="$ROOT_DIR/infra/smoke-test"
RUNTIME_DIR="$ROOT_DIR/infra/smoke-test/.runtime"
SUMMARY_PATH="$RUNTIME_DIR/aadm-smoke-summary.json"
SCREENSHOT_PATH="$RUNTIME_DIR/browser-smoke.png"
KEY_PATH="$RUNTIME_DIR/id_ed25519"

# Ports used for SSH port-forwarding during --test mode
TUNNEL_MANAGER_LOCAL=18899   # forwards to EC2:8899 (aadm manager)
TUNNEL_VERIFIER_LOCAL=19999  # mock verifier listens here; reverse-tunnelled as EC2:9999

# Global state for cleanup trap
SMOKE_HOST=""
SSH_PID=""
VERIFIER_PID=""
AADM_RECONFIGURED=false

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Options:
  --summary <path>                Summary JSON produced by ec2-smoke-test.sh
  --screenshot <path>             Screenshot output path
  --ignore-https-errors <bool>    Pass through to the browser smoke script (default: false)
  --test                          Run the full Playwright smoke test suite
  -h, --help                      Show this help
EOF
}

IGNORE_HTTPS_ERRORS="false"
RUN_PLAYWRIGHT_TEST="false"

command -v jq >/dev/null 2>&1 || { echo "missing required command: jq" >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "missing required command: node" >&2; exit 1; }
command -v terraform >/dev/null 2>&1 || { echo "missing required command: terraform" >&2; exit 1; }

# ---------------------------------------------------------------------------
# Cleanup: called by EXIT trap when --test mode is active
# ---------------------------------------------------------------------------
function smoke_test_cleanup() {
  echo "smoke-playwright: cleaning up..." >&2

  if [[ -n "$SMOKE_HOST" ]] && [[ "$AADM_RECONFIGURED" == "true" ]]; then
    ssh \
      -i "$KEY_PATH" \
      -o BatchMode=yes \
      -o StrictHostKeyChecking=no \
      -o UserKnownHostsFile=/dev/null \
      ubuntu@"$SMOKE_HOST" \
      'sudo sed -i "s|^AADM_DESKTOP_ROUTE_AUTH_REQUEST_URL=.*|AADM_DESKTOP_ROUTE_AUTH_REQUEST_URL=|" /opt/ai-agent-desktop-manager/.env \
       && sudo systemctl restart aadm.service' 2>/dev/null || true
  fi

  if [[ -n "$VERIFIER_PID" ]]; then
    kill "$VERIFIER_PID" 2>/dev/null || true
  fi

  if [[ -n "$SSH_PID" ]]; then
    kill "$SSH_PID" 2>/dev/null || true
  fi
}

function wait_for_local_port() {
  local port="$1"
  local retries="${2:-20}"
  for _ in $(seq 1 "$retries"); do
    if bash -c ">/dev/tcp/127.0.0.1/$port" 2>/dev/null; then
      return 0
    fi
    sleep 1
  done
  echo "port $port did not become reachable in time" >&2
  return 1
}

function wait_for_manager_health() {
  local retries="${1:-15}"
  for _ in $(seq 1 "$retries"); do
    if curl -sf "http://127.0.0.1:${TUNNEL_MANAGER_LOCAL}/health" > /dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  echo "manager health check timed out" >&2
  return 1
}

function run_playwright_test() {
  # -------------------------------------------------------------------------
  # 1. Get EC2 host from Terraform state
  # -------------------------------------------------------------------------
  SMOKE_HOST="$(terraform -chdir="$TF_DIR" output -raw ssh_host 2>/dev/null)" || {
    echo "cannot get EC2 host from terraform state — run ec2-smoke-test.sh first" >&2
    exit 1
  }

  local tls_domain
  tls_domain="$(terraform -chdir="$TF_DIR" output -raw tls_domain 2>/dev/null)" || true
  local public_base_url="https://${tls_domain}"

  # -------------------------------------------------------------------------
  # 2. Register cleanup trap (fires on any exit from here on)
  # -------------------------------------------------------------------------
  trap smoke_test_cleanup EXIT

  # -------------------------------------------------------------------------
  # 3. Start mock verifier locally (port 19999)
  #    Nginx on EC2 will reach it via the reverse SSH tunnel on EC2 port 9999.
  # -------------------------------------------------------------------------
  echo "smoke-playwright: starting mock verifier on port ${TUNNEL_VERIFIER_LOCAL}..." >&2
  MOCK_VERIFIER_PORT="$TUNNEL_VERIFIER_LOCAL" node "$ROOT_DIR/smoke/mock-verifier.mjs" &
  VERIFIER_PID=$!

  wait_for_local_port "$TUNNEL_VERIFIER_LOCAL" 10 || exit 1

  # -------------------------------------------------------------------------
  # 4. Open SSH tunnels:
  #    -L forward:  local:18899 → EC2:8899   (manager API)
  #    -R reverse:  EC2:9999   → local:19999 (nginx auth_request → mock verifier)
  # -------------------------------------------------------------------------
  echo "smoke-playwright: opening SSH tunnels to ${SMOKE_HOST}..." >&2
  ssh \
    -i "$KEY_PATH" \
    -o BatchMode=yes \
    -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/dev/null \
    -o ExitOnForwardFailure=yes \
    -o ServerAliveInterval=10 \
    -N \
    -L "${TUNNEL_MANAGER_LOCAL}:127.0.0.1:8899" \
    -R "9999:127.0.0.1:${TUNNEL_VERIFIER_LOCAL}" \
    ubuntu@"$SMOKE_HOST" &
  SSH_PID=$!

  wait_for_local_port "$TUNNEL_MANAGER_LOCAL" 20 || exit 1

  # -------------------------------------------------------------------------
  # 5. Update aadm .env with mock verifier URL and restart the service
  # -------------------------------------------------------------------------
  echo "smoke-playwright: configuring aadm auth_request URL on EC2..." >&2
  ssh \
    -i "$KEY_PATH" \
    -o BatchMode=yes \
    -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/dev/null \
    ubuntu@"$SMOKE_HOST" \
    'if sudo grep -q "^AADM_DESKTOP_ROUTE_AUTH_REQUEST_URL=" /opt/ai-agent-desktop-manager/.env; then
       sudo sed -i "s|^AADM_DESKTOP_ROUTE_AUTH_REQUEST_URL=.*|AADM_DESKTOP_ROUTE_AUTH_REQUEST_URL=http://127.0.0.1:9999/verify|" /opt/ai-agent-desktop-manager/.env
     else
       echo "AADM_DESKTOP_ROUTE_AUTH_REQUEST_URL=http://127.0.0.1:9999/verify" | sudo tee -a /opt/ai-agent-desktop-manager/.env > /dev/null
     fi
     sudo systemctl restart aadm.service'
  AADM_RECONFIGURED=true

  wait_for_manager_health 15 || exit 1

  # -------------------------------------------------------------------------
  # 6. Mint a fresh access URL for the desktop from the summary (if present)
  # -------------------------------------------------------------------------
  local smoke_access_url=""
  local smoke_vnc_password=""
  local smoke_desktop_id=""
  if [[ -f "$SUMMARY_PATH" ]]; then
    smoke_desktop_id="$(jq -r '.create.id // empty' "$SUMMARY_PATH")"
    smoke_vnc_password="$(jq -r '.vnc_password // empty' "$SUMMARY_PATH")"

    if [[ -n "$smoke_desktop_id" ]]; then
      smoke_access_url="$(
        curl -sf \
          -X POST \
          -H 'content-type: application/json' \
          -d '{}' \
          "http://127.0.0.1:${TUNNEL_MANAGER_LOCAL}/v1/desktops/${smoke_desktop_id}/access-url" \
          2>/dev/null \
        | jq -r '.accessUrl // empty'
      )" || true
    fi
  fi

  # -------------------------------------------------------------------------
  # 7. Run the Playwright test suite
  # -------------------------------------------------------------------------
  echo "smoke-playwright: running test suite..." >&2
  local exit_code=0
  SMOKE_PLAYWRIGHT=true \
  SMOKE_SUMMARY_PATH="$SUMMARY_PATH" \
  SMOKE_MANAGER_URL="http://127.0.0.1:${TUNNEL_MANAGER_LOCAL}" \
  SMOKE_MOCK_VERIFIER_URL="http://127.0.0.1:${TUNNEL_VERIFIER_LOCAL}" \
  SMOKE_PUBLIC_BASE_URL="$public_base_url" \
  SMOKE_ACCESS_URL="$smoke_access_url" \
  SMOKE_VNC_PASSWORD="$smoke_vnc_password" \
    node --import tsx --test test/playwright/smoke-playwright.test.ts \
    || exit_code=$?

  # trap fires on exit and handles cleanup
  return $exit_code
}

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --summary)
      SUMMARY_PATH="$2"
      shift 2
      ;;
    --screenshot)
      SCREENSHOT_PATH="$2"
      shift 2
      ;;
    --ignore-https-errors)
      IGNORE_HTTPS_ERRORS="$2"
      shift 2
      ;;
    --test)
      RUN_PLAYWRIGHT_TEST="true"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

# --test mode: SSH setup handles everything — no summary file required upfront
if [[ "$RUN_PLAYWRIGHT_TEST" == "true" ]]; then
  run_playwright_test
  exit $?
fi

# ---------------------------------------------------------------------------
# Screenshot mode: requires existing smoke summary
# ---------------------------------------------------------------------------
[[ -f "$SUMMARY_PATH" ]] || {
  echo "missing smoke summary: $SUMMARY_PATH" >&2
  echo "run ./scripts/ec2-smoke-test.sh run first" >&2
  exit 1
}

URL="$(jq -r '.accessUrl // .novncBaseUrl // empty' "$SUMMARY_PATH")"
PASSWORD="$(jq -r '.vnc_password // empty' "$SUMMARY_PATH")"
HAS_ACCESS_URL="$(jq -r 'if (.accessUrl // "") != "" then "true" else "false" end' "$SUMMARY_PATH")"

[[ -n "$URL" ]] || {
  echo "summary does not include accessUrl or novncBaseUrl: $SUMMARY_PATH" >&2
  exit 1
}

ARGS=(
  --url "$URL"
  --screenshot "$SCREENSHOT_PATH"
  --ignore-https-errors "$IGNORE_HTTPS_ERRORS"
)

if [[ -n "$PASSWORD" && "$HAS_ACCESS_URL" != "true" ]]; then
  ARGS+=(--vnc-password "$PASSWORD")
fi

node "$ROOT_DIR/smoke/browser-smoke.mjs" "${ARGS[@]}"

echo "browser smoke screenshot saved to $SCREENSHOT_PATH"

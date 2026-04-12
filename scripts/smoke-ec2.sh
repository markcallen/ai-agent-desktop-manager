#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TF_DIR="$ROOT_DIR/infra/smoke-test"
RUNTIME_DIR="$TF_DIR/.runtime"
KEY_PATH="$RUNTIME_DIR/id_ed25519"
SUMMARY_PATH="$RUNTIME_DIR/aadm-smoke-summary.json"
METADATA_PATH="$RUNTIME_DIR/smoke-metadata.env"
EC2_SMOKE_SCRIPT="$ROOT_DIR/scripts/ec2-smoke-test.sh"
PLAYWRIGHT_SMOKE_SCRIPT="$ROOT_DIR/scripts/smoke-playwright.sh"

AWS_REGION="${SMOKE_AWS_REGION:-${AWS_REGION:-}}"
TLS_DOMAIN="${SMOKE_TLS_DOMAIN:-}"
TLS_EMAIL="${SMOKE_TLS_EMAIL:-}"
INSTANCE_TYPE="${SMOKE_INSTANCE_TYPE:-}"
NAME_PREFIX="${SMOKE_NAME_PREFIX:-}"
SPOT_MAX_PRICE="${SMOKE_SPOT_MAX_PRICE:-}"
AAB_NPM_PACKAGE="${SMOKE_AAB_NPM_PACKAGE:-}"
WEB_INGRESS_CIDR="${SMOKE_WEB_INGRESS_CIDR:-}"
PUBLIC_WEB_INGRESS="${SMOKE_PUBLIC_WEB_INGRESS:-false}"
TLS_STAGING="${SMOKE_TLS_STAGING:-false}"
DESTROY_DESKTOP="${SMOKE_DESTROY_DESKTOP:-false}"
STACK_ATTEMPTED="false"
DESTROY_MODE="always"
ACTION="run"

usage() {
  cat <<EOF
Usage: $(basename "$0") [run|status] [--destroy] [--keep-alive]

Provision an EC2 smoke environment, run the Playwright smoke test remotely,
and optionally destroy the stack afterward.

Options:
  run           Provision EC2 and execute the smoke test (default)
  status        Print the saved access/debug commands for the current smoke stack
  --destroy     Destroy the EC2 smoke stack on exit, even when the test fails (default)
  --keep-alive  Leave the EC2 smoke stack running for manual debugging
  -h, --help    Show this help

Required environment variables:
  SMOKE_AWS_REGION   AWS region to provision in
  SMOKE_TLS_DOMAIN   Delegated Route 53 smoke zone
  SMOKE_TLS_EMAIL    Email used for certbot registration

Optional environment variables:
  SMOKE_INSTANCE_TYPE       EC2 instance type
  SMOKE_NAME_PREFIX         AWS resource name prefix
  SMOKE_SPOT_MAX_PRICE      Spot max price
  SMOKE_AAB_NPM_PACKAGE     ai-agent-browser package name
  SMOKE_WEB_INGRESS_CIDR    Override HTTPS ingress CIDR
  SMOKE_PUBLIC_WEB_INGRESS  Set to true to open 80/443 publicly
  SMOKE_TLS_STAGING         Set to true to use Let's Encrypt staging
  SMOKE_DESTROY_DESKTOP     Set to true to destroy the seeded desktop after verification
EOF
}

require_env() {
  local name="$1"
  local value="$2"
  if [[ -n "$value" ]]; then
    return
  fi

  echo "smoke-ec2: missing required environment variable: $name" >&2
  usage >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "smoke-ec2: missing required command: $1" >&2
    exit 1
  }
}

load_metadata() {
  if [[ -f "$METADATA_PATH" ]]; then
    # shellcheck disable=SC1090
    source "$METADATA_PATH"
  fi

  if [[ -z "$AWS_REGION" && -n "${SMOKE_AWS_REGION:-}" ]]; then
    AWS_REGION="$SMOKE_AWS_REGION"
  fi
}

print_status() {
  require_cmd terraform

  load_metadata

  if [[ -z "$AWS_REGION" ]]; then
    echo "smoke-ec2: no saved smoke metadata found. Run a keep-alive smoke test first." >&2
    exit 1
  fi

  local host
  local resolved_tls_domain

  host="$(terraform -chdir="$TF_DIR" output -raw ssh_host 2>/dev/null || true)"
  resolved_tls_domain="$(terraform -chdir="$TF_DIR" output -raw tls_domain 2>/dev/null || true)"

  if [[ -z "$host" || "$host" == "null" || "$host" == "None" ]]; then
    echo "smoke-ec2: no active smoke stack found in terraform state." >&2
    exit 1
  fi

  cat <<EOF
Smoke test host is ready.

SSH:
  ssh -i $KEY_PATH ubuntu@$host

Manager health:
  ssh -i $KEY_PATH ubuntu@$host 'curl -s http://127.0.0.1:8899/health | jq'

noVNC route after a successful smoke create:
  https://$resolved_tls_domain/

Summary file on the instance:
  /tmp/aadm-smoke-summary.json

Local summary file:
  $SUMMARY_PATH

Saved smoke metadata:
  $METADATA_PATH

Destroy:
  ./scripts/ec2-smoke-test.sh destroy --region $AWS_REGION
EOF
}

cleanup() {
  local exit_code=$?

  if [[ "$STACK_ATTEMPTED" == "true" && "$DESTROY_MODE" == "always" ]]; then
    echo "smoke-ec2: destroying EC2 smoke environment..." >&2
    if ! bash "$EC2_SMOKE_SCRIPT" destroy --region "$AWS_REGION"; then
      echo "smoke-ec2: destroy failed; inspect infra/smoke-test state before rerunning" >&2
      if [[ $exit_code -eq 0 ]]; then
        exit 1
      fi
    fi
  fi

  exit "$exit_code"
}

trap cleanup EXIT

while [[ $# -gt 0 ]]; do
  case "$1" in
    run)
      ACTION="run"
      shift
      ;;
    status)
      ACTION="status"
      shift
      ;;
    --destroy)
      DESTROY_MODE="always"
      shift
      ;;
    --keep-alive)
      DESTROY_MODE="manual"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "smoke-ec2: unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ "$ACTION" == "status" ]]; then
  print_status
  exit 0
fi

require_env "SMOKE_AWS_REGION" "$AWS_REGION"
require_env "SMOKE_TLS_DOMAIN" "$TLS_DOMAIN"
require_env "SMOKE_TLS_EMAIL" "$TLS_EMAIL"

ec2_args=(
  run
  --region "$AWS_REGION"
  --tls-domain "$TLS_DOMAIN"
  --tls-email "$TLS_EMAIL"
)

if [[ -n "$INSTANCE_TYPE" ]]; then
  ec2_args+=(--instance-type "$INSTANCE_TYPE")
fi

if [[ -n "$NAME_PREFIX" ]]; then
  ec2_args+=(--name-prefix "$NAME_PREFIX")
fi

if [[ -n "$SPOT_MAX_PRICE" ]]; then
  ec2_args+=(--spot-max-price "$SPOT_MAX_PRICE")
fi

if [[ -n "$AAB_NPM_PACKAGE" ]]; then
  ec2_args+=(--aab-npm-package "$AAB_NPM_PACKAGE")
fi

if [[ -n "$WEB_INGRESS_CIDR" ]]; then
  ec2_args+=(--web-ingress-cidr "$WEB_INGRESS_CIDR")
fi

if [[ "$PUBLIC_WEB_INGRESS" == "true" ]]; then
  ec2_args+=(--public-web-ingress)
fi

if [[ "$TLS_STAGING" == "true" ]]; then
  ec2_args+=(--tls-staging)
fi

if [[ "$DESTROY_DESKTOP" == "true" ]]; then
  ec2_args+=(--destroy-desktop)
fi

echo "smoke-ec2: provisioning EC2 smoke environment in ${AWS_REGION}..." >&2
STACK_ATTEMPTED="true"
bash "$EC2_SMOKE_SCRIPT" "${ec2_args[@]}"

echo "smoke-ec2: running remote Playwright smoke test..." >&2
bash "$PLAYWRIGHT_SMOKE_SCRIPT" --test

if [[ "$DESTROY_MODE" == "manual" ]]; then
  cat >&2 <<EOF
smoke-ec2: leaving EC2 smoke environment running for debugging.
Destroy it manually with:
  ./scripts/ec2-smoke-test.sh destroy --region ${AWS_REGION}
EOF
fi

echo "SMOKE TEST PASSED"

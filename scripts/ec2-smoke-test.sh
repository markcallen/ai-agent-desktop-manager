#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TF_DIR="$ROOT_DIR/infra/smoke-test"
ANSIBLE_DIR="$ROOT_DIR/infra/ansible"
PLAYBOOK="$ANSIBLE_DIR/playbooks/aadm_smoke.yml"
ANSIBLE_REQUIREMENTS="$ANSIBLE_DIR/requirements.yml"
ANSIBLE_ROLES_DIR="$ANSIBLE_DIR/roles"
RUNTIME_DIR="$TF_DIR/.runtime"
KEY_PATH="$RUNTIME_DIR/id_ed25519"
ARCHIVE_PATH="$RUNTIME_DIR/repo.tgz"
AI_AGENT_BROWSER_DIR="$(cd "$ROOT_DIR/../ai-agent-browser" && pwd)"
AI_AGENT_BROWSER_ARCHIVE_PATH="$RUNTIME_DIR/ai-agent-browser.tgz"
INVENTORY_PATH="$RUNTIME_DIR/inventory.ini"
SUMMARY_PATH="$RUNTIME_DIR/aadm-smoke-summary.json"
METADATA_PATH="$RUNTIME_DIR/smoke-metadata.env"

AWS_REGION=""
INSTANCE_TYPE="t3.large"
NAME_PREFIX="aadm-smoke"
DESTROY_ON_SUCCESS="false"
DESTROY_DESKTOP="false"
SPOT_MAX_PRICE=""
AAB_NPM_PACKAGE="ai-agent-browser"
TLS_DOMAIN=""
TLS_EMAIL=""
TLS_STAGING="false"
ACTION="run"
WEB_INGRESS_CIDR=""
PUBLIC_WEB_INGRESS="false"

usage() {
  cat <<EOF
Usage: $(basename "$0") [run|destroy|ssh] [options]

Options:
  --instance-type <type>       EC2 instance type (default: $INSTANCE_TYPE)
  --region <aws-region>        AWS region for the smoke test (required on first run; reused from runtime metadata afterward)
  --name-prefix <prefix>       Name prefix for AWS resources (default: $NAME_PREFIX)
  --spot-max-price <price>     Optional spot max price
  --aab-npm-package <package>  npm package used for ai-agent-browser (default: $AAB_NPM_PACKAGE)
  --web-ingress-cidr <cidr>    CIDR allowed to reach HTTP/HTTPS (default: your current IP)
  --public-web-ingress         Allow HTTP/HTTPS from 0.0.0.0/0
  --tls-domain <domain>        Delegated Route 53 zone used to mint a per-run smoke hostname
  --tls-email <email>          Email address used for certbot registration
  --tls-staging                Use the certbot staging endpoint
  --destroy-desktop            Destroy the test desktop after verification
  --destroy-on-success         Destroy the instance and AWS resources after a successful run
  -h, --help                   Show this help

Examples:
  $(basename "$0") run --region us-west-1 --tls-domain smoke.markcallen.dev --tls-email ops@example.com
  $(basename "$0") run --region us-west-1 --destroy-on-success
  $(basename "$0") run --region us-west-1 --tls-domain smoke.markcallen.dev --tls-email ops@example.com
  $(basename "$0") ssh --region us-west-1
  $(basename "$0") destroy --region us-west-1
EOF
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "missing required command: $1" >&2
    exit 1
  }
}

require_region() {
  if [[ -z "$AWS_REGION" ]]; then
    cat >&2 <<EOF
Missing required --region argument.

Example:

  ./scripts/ec2-smoke-test.sh run --region us-west-1

If this smoke environment was already created, rerun a successful or partially
successful `run` first so runtime metadata can be written for later `destroy`
and `ssh` commands.
EOF
    exit 1
  fi
}

require_tls_inputs() {
  if [[ -z "$TLS_DOMAIN" || -z "$TLS_EMAIL" ]]; then
    cat >&2 <<EOF
--tls-domain and --tls-email are required.

Example:

  ./scripts/ec2-smoke-test.sh run --region us-west-1 --tls-domain smoke.markcallen.dev --tls-email ops@example.com
EOF
    exit 1
  fi
}

load_metadata() {
  if [[ -f "$METADATA_PATH" ]]; then
    # shellcheck disable=SC1090
    source "$METADATA_PATH"
  fi

  if [[ -z "$AWS_REGION" && -n "${SMOKE_AWS_REGION:-}" ]]; then
    AWS_REGION="$SMOKE_AWS_REGION"
  fi

  if [[ -z "$TLS_DOMAIN" && -n "${SMOKE_TLS_ZONE:-}" ]]; then
    TLS_DOMAIN="$SMOKE_TLS_ZONE"
  fi

  if [[ "$NAME_PREFIX" == "aadm-smoke" && -n "${SMOKE_NAME_PREFIX:-}" ]]; then
    NAME_PREFIX="$SMOKE_NAME_PREFIX"
  fi

  if [[ "$INSTANCE_TYPE" == "t3.large" && -n "${SMOKE_INSTANCE_TYPE:-}" ]]; then
    INSTANCE_TYPE="$SMOKE_INSTANCE_TYPE"
  fi

  if [[ -z "$SPOT_MAX_PRICE" && -n "${SMOKE_SPOT_MAX_PRICE:-}" ]]; then
    SPOT_MAX_PRICE="$SMOKE_SPOT_MAX_PRICE"
  fi

  if [[ -z "$WEB_INGRESS_CIDR" && -n "${SMOKE_WEB_INGRESS_CIDR:-}" ]]; then
    WEB_INGRESS_CIDR="$SMOKE_WEB_INGRESS_CIDR"
  fi

  if [[ "$PUBLIC_WEB_INGRESS" == "false" && -n "${SMOKE_PUBLIC_WEB_INGRESS:-}" ]]; then
    PUBLIC_WEB_INGRESS="$SMOKE_PUBLIC_WEB_INGRESS"
  fi

}

save_metadata() {
  local resolved_tls_domain="$1"
  cat >"$METADATA_PATH" <<EOF
SMOKE_AWS_REGION=$AWS_REGION
SMOKE_INSTANCE_TYPE=$INSTANCE_TYPE
SMOKE_NAME_PREFIX=$NAME_PREFIX
SMOKE_SPOT_MAX_PRICE=$SPOT_MAX_PRICE
SMOKE_WEB_INGRESS_CIDR=$WEB_INGRESS_CIDR
SMOKE_PUBLIC_WEB_INGRESS=$PUBLIC_WEB_INGRESS
SMOKE_TLS_ZONE=$TLS_DOMAIN
SMOKE_TLS_DOMAIN=$resolved_tls_domain
EOF
}

require_default_vpc() {
  local vpc_id
  vpc_id="$(
    aws ec2 describe-vpcs \
      --region "$AWS_REGION" \
      --filters Name=isDefault,Values=true Name=state,Values=available \
      --query 'Vpcs[0].VpcId' \
      --output text 2>/dev/null || true
  )"

  if [[ -z "$vpc_id" || "$vpc_id" == "None" ]]; then
    cat >&2 <<EOF
No default VPC was found in $AWS_REGION.

This smoke test currently expects an existing default VPC in that region.
Create one with:

  aws ec2 create-default-vpc --region $AWS_REGION

After that completes, rerun:

  ./scripts/ec2-smoke-test.sh run --region $AWS_REGION
EOF
    exit 1
  fi
}

parse_args() {
  if [[ $# -gt 0 && "$1" != --* ]]; then
    ACTION="$1"
    shift
  fi

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --instance-type)
        INSTANCE_TYPE="$2"
        shift 2
        ;;
      --region)
        AWS_REGION="$2"
        shift 2
        ;;
      --name-prefix)
        NAME_PREFIX="$2"
        shift 2
        ;;
      --spot-max-price)
        SPOT_MAX_PRICE="$2"
        shift 2
        ;;
      --aab-npm-package)
        AAB_NPM_PACKAGE="$2"
        shift 2
        ;;
      --web-ingress-cidr)
        WEB_INGRESS_CIDR="$2"
        shift 2
        ;;
      --public-web-ingress)
        PUBLIC_WEB_INGRESS="true"
        shift
        ;;
      --tls-domain)
        TLS_DOMAIN="$2"
        shift 2
        ;;
      --tls-email)
        TLS_EMAIL="$2"
        shift 2
        ;;
      --tls-staging)
        TLS_STAGING="true"
        shift
        ;;
      --destroy-desktop)
        DESTROY_DESKTOP="true"
        shift
        ;;
      --destroy-on-success)
        DESTROY_ON_SUCCESS="true"
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
}

ensure_runtime_dir() {
  mkdir -p "$RUNTIME_DIR"
  chmod 700 "$RUNTIME_DIR"
}

generate_key() {
  if [[ -f "$KEY_PATH" && -f "$KEY_PATH.pub" ]]; then
    return
  fi
  ssh-keygen -t ed25519 -f "$KEY_PATH" -N "" -C "${NAME_PREFIX}@$(hostname)"
}

package_repo() {
  if [[ ! -d "$AI_AGENT_BROWSER_DIR" ]]; then
    cat >&2 <<EOF
Expected sibling ai-agent-browser checkout at:

  $AI_AGENT_BROWSER_DIR

The smoke-test playbook packages that repo and installs it on the EC2 host.
Clone it alongside this repo or update scripts/ec2-smoke-test.sh to use a different source.
EOF
    exit 1
  fi

  tar \
    --exclude="./.git" \
    --exclude="./node_modules" \
    --exclude="./dist" \
    --exclude="./data" \
    --exclude="./infra/smoke-test/.runtime" \
    -czf "$ARCHIVE_PATH" \
    -C "$ROOT_DIR" .

  tar \
    --exclude="./.git" \
    --exclude="./node_modules" \
    --exclude="./coverage" \
    --exclude="./dist" \
    -czf "$AI_AGENT_BROWSER_ARCHIVE_PATH" \
    -C "$AI_AGENT_BROWSER_DIR" .
}

public_ip_cidr() {
  local ip
  ip="$(curl -fsSL ifconfig.me)"
  printf '%s/32' "$ip"
}

terraform_base_args() {
  local ssh_cidr
  local web_cidr
  ssh_cidr="$(public_ip_cidr)"
  web_cidr="$WEB_INGRESS_CIDR"
  if [[ -z "$web_cidr" ]]; then
    web_cidr="$ssh_cidr"
  fi
  if [[ "$PUBLIC_WEB_INGRESS" == "true" ]]; then
    web_cidr="0.0.0.0/0"
  fi

  local args=(
    -chdir="$TF_DIR"
    -var "aws_region=$AWS_REGION"
    -var "instance_type=$INSTANCE_TYPE"
    -var "name_prefix=$NAME_PREFIX"
    -var "public_key=$(cat "$KEY_PATH.pub")"
    -var "ssh_ingress_cidr=$ssh_cidr"
    -var "web_ingress_cidr=$web_cidr"
  )

  if [[ -n "$SPOT_MAX_PRICE" ]]; then
    args+=(-var "spot_max_price=$SPOT_MAX_PRICE")
  fi

  if [[ -n "$TLS_DOMAIN" ]]; then
    args+=(-var "route53_zone_name=$TLS_DOMAIN")
  fi

  printf '%s\n' "${args[@]}"
}

terraform_init() {
  terraform -chdir="$TF_DIR" init
}

terraform_apply() {
  mapfile -t tf_args < <(terraform_base_args)
  terraform -chdir="$TF_DIR" apply -auto-approve "${tf_args[@]:1}"
}

terraform_destroy() {
  mapfile -t tf_args < <(terraform_base_args)
  terraform -chdir="$TF_DIR" destroy -auto-approve "${tf_args[@]:1}"
}

tf_output() {
  terraform -chdir="$TF_DIR" output -raw "$1"
}

wait_for_ssh() {
  local host="$1"
  local ssh_opts=(
    -i "$KEY_PATH"
    -o BatchMode=yes
    -o ConnectTimeout=10
    -o StrictHostKeyChecking=no
    -o UserKnownHostsFile=/dev/null
  )

  for _ in $(seq 1 40); do
    if ssh "${ssh_opts[@]}" ubuntu@"$host" true >/dev/null 2>&1; then
      return 0
    fi
    sleep 10
  done

  echo "ssh did not become ready in time" >&2
  return 1
}

write_inventory() {
  local host="$1"
  cat >"$INVENTORY_PATH" <<EOF
[smoke]
$host ansible_user=ubuntu ansible_ssh_private_key_file=$KEY_PATH
EOF
}

run_ansible() {
  local host="$1"
  local resolved_tls_domain="$2"
  local public_base_url="https://$resolved_tls_domain"

  write_inventory "$host"

  mkdir -p "$ANSIBLE_ROLES_DIR"
  ANSIBLE_CONFIG="$ANSIBLE_DIR/ansible.cfg" \
  ansible-galaxy role install -r "$ANSIBLE_REQUIREMENTS" -p "$ANSIBLE_ROLES_DIR"
  ANSIBLE_CONFIG="$ANSIBLE_DIR/ansible.cfg" \
  ansible-galaxy collection install -r "$ANSIBLE_REQUIREMENTS"

  ANSIBLE_CONFIG="$ANSIBLE_DIR/ansible.cfg" \
  ansible-playbook \
    -i "$INVENTORY_PATH" \
    "$PLAYBOOK" \
    -e "aadm_repo_archive_local=$ARCHIVE_PATH" \
    -e "aab_repo_archive_local=$AI_AGENT_BROWSER_ARCHIVE_PATH" \
    -e "aadm_public_base_url=$public_base_url" \
    -e "aadm_enable_https=true" \
    -e "aadm_tls_domain=$resolved_tls_domain" \
    -e "aadm_tls_email=$TLS_EMAIL" \
    -e "aadm_tls_staging=$TLS_STAGING" \
    -e "aadm_npm_package=$AAB_NPM_PACKAGE" \
    -e "aadm_smoke_destroy_desktop=$DESTROY_DESKTOP"
}

fetch_summary() {
  local host="$1"
  local scp_opts=(
    -i "$KEY_PATH"
    -o BatchMode=yes
    -o ConnectTimeout=10
    -o StrictHostKeyChecking=no
    -o UserKnownHostsFile=/dev/null
  )

  scp "${scp_opts[@]}" ubuntu@"$host":/tmp/aadm-smoke-summary.json "$SUMMARY_PATH"
}

print_access() {
  local host="$1"
  local resolved_tls_domain="$2"
  local public_url="https://$resolved_tls_domain/"
  cat <<EOF
Smoke test host is ready.

SSH:
  ssh -i $KEY_PATH ubuntu@$host

Manager health:
  ssh -i $KEY_PATH ubuntu@$host 'curl -s http://127.0.0.1:8899/health | jq'

noVNC route after a successful smoke create:
  $public_url

Summary file on the instance:
  /tmp/aadm-smoke-summary.json

Local summary file:
  $SUMMARY_PATH

Saved smoke metadata:
  $METADATA_PATH
EOF
}

run() {
  require_cmd aws
  require_cmd curl
  require_cmd jq
  require_cmd ssh
  require_cmd ssh-keygen
  require_cmd tar
  require_cmd terraform
  require_cmd ansible-playbook
  require_cmd ansible-galaxy

  require_region
  require_tls_inputs
  ensure_runtime_dir
  generate_key
  package_repo
  require_default_vpc
  terraform_init
  terraform_apply

  local host
  local resolved_tls_domain=""
  host="$(tf_output ssh_host)"
  resolved_tls_domain="$(tf_output tls_domain)"
  if [[ -z "$resolved_tls_domain" ]]; then
    echo "terraform did not return a generated tls_domain output" >&2
    exit 1
  fi
  save_metadata "$resolved_tls_domain"
  wait_for_ssh "$host"
  run_ansible "$host" "$resolved_tls_domain"
  fetch_summary "$host"
  print_access "$host" "$resolved_tls_domain"

  if [[ "$DESTROY_ON_SUCCESS" == "true" ]]; then
    terraform_destroy
  fi
}

ssh_into_host() {
  require_region
  local host
  host="$(tf_output ssh_host)"
  exec ssh -i "$KEY_PATH" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null ubuntu@"$host"
}

main() {
  parse_args "$@"
  load_metadata

  case "$ACTION" in
    run)
      run
      ;;
    destroy)
      require_region
      terraform_init
      terraform_destroy
      ;;
    ssh)
      ssh_into_host
      ;;
    *)
      echo "unknown action: $ACTION" >&2
      usage
      exit 1
      ;;
  esac
}

main "$@"

#!/usr/bin/env bash
set -euo pipefail

SUBDOMAIN_ZONE=""
RECORD_NAME=""
IPV4_ADDRESS=""
TTL="60"
COMMENT="aadm smoke delegated subdomain"

usage() {
  cat <<EOF
Usage: $(basename "$0") --subdomain-zone <zone> [options]

Create or reuse a delegated Route 53 hosted zone for smoke tests. If the
parent zone is also hosted in Route 53, the script will create/update the NS
delegation automatically. Otherwise it will print the NS records you must add
at your DNS provider, such as Cloudflare.

Options:
  --subdomain-zone <zone>   Delegated zone to create or reuse, e.g. smoke.example.com
  --record-name <fqdn>      Optional A record to create inside the delegated zone
  --ip <ipv4>               IPv4 address for --record-name
  --ttl <seconds>           TTL for created records (default: $TTL)
  --comment <text>          Hosted zone comment (default: $COMMENT)
  -h, --help                Show this help

Examples:
  $(basename "$0") --subdomain-zone smoke.example.com
  $(basename "$0") --subdomain-zone smoke.example.com --record-name run-20260403.smoke.example.com --ip 203.0.113.10
EOF
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "missing required command: $1" >&2
    exit 1
  }
}

normalize_zone() {
  local value="$1"
  value="${value%.}"
  printf '%s' "${value,,}"
}

fqdn_with_dot() {
  printf '%s.' "$(normalize_zone "$1")"
}

parent_zone_name() {
  local zone="$1"
  if [[ "$zone" != *.* ]]; then
    return 1
  fi
  printf '%s' "${zone#*.}"
}

list_hosted_zone_id() {
  local zone_dot="$1"
  aws route53 list-hosted-zones-by-name \
    --dns-name "$zone_dot" \
    --max-items 1 \
    --query "HostedZones[?Name == \`${zone_dot}\`].Id | [0]" \
    --output text
}

trim_zone_id() {
  local zone_id="$1"
  printf '%s' "${zone_id##*/}"
}

ensure_hosted_zone() {
  local zone="$1"
  local zone_dot
  zone_dot="$(fqdn_with_dot "$zone")"
  local existing_zone_id
  existing_zone_id="$(list_hosted_zone_id "$zone_dot")"

  if [[ -n "$existing_zone_id" && "$existing_zone_id" != "None" ]]; then
    printf '%s' "$(trim_zone_id "$existing_zone_id")"
    return 0
  fi

  local caller_ref
  caller_ref="aadm-smoke-$(date +%s)-$RANDOM"
  aws route53 create-hosted-zone \
    --name "$zone" \
    --caller-reference "$caller_ref" \
    --hosted-zone-config "Comment=${COMMENT},PrivateZone=false" \
    --query 'HostedZone.Id' \
    --output text | sed 's#^/hostedzone/##'
}

get_zone_name_servers() {
  local zone_id="$1"
  aws route53 get-hosted-zone \
    --id "$zone_id" \
    --query 'DelegationSet.NameServers' \
    --output text
}

upsert_ns_record() {
  local parent_zone_id="$1"
  local subdomain_zone="$2"
  shift 2
  local name_servers=("$@")
  local change_batch
  change_batch="$(mktemp)"

  {
    cat <<EOF
{
  "Comment": "Delegate ${subdomain_zone} to Route 53 for aadm smoke tests",
  "Changes": [
    {
      "Action": "UPSERT",
      "ResourceRecordSet": {
        "Name": "$(fqdn_with_dot "$subdomain_zone")",
        "Type": "NS",
        "TTL": ${TTL},
        "ResourceRecords": [
EOF
    local first="true"
    local ns
    for ns in "${name_servers[@]}"; do
      if [[ "$first" == "true" ]]; then
        first="false"
      else
        printf ',\n'
      fi
      printf '          { "Value": "%s" }' "$ns"
    done
    cat <<EOF

        ]
      }
    }
  ]
}
EOF
  } >"$change_batch"

  aws route53 change-resource-record-sets \
    --hosted-zone-id "$parent_zone_id" \
    --change-batch "file://${change_batch}" >/dev/null
  rm -f "$change_batch"
}

upsert_a_record() {
  local zone_id="$1"
  local record_name="$2"
  local ipv4="$3"
  local change_batch
  change_batch="$(mktemp)"

  cat >"$change_batch" <<EOF
{
  "Comment": "Create aadm smoke test A record for ${record_name}",
  "Changes": [
    {
      "Action": "UPSERT",
      "ResourceRecordSet": {
        "Name": "$(fqdn_with_dot "$record_name")",
        "Type": "A",
        "TTL": ${TTL},
        "ResourceRecords": [
          { "Value": "${ipv4}" }
        ]
      }
    }
  ]
}
EOF

  aws route53 change-resource-record-sets \
    --hosted-zone-id "$zone_id" \
    --change-batch "file://${change_batch}" >/dev/null
  rm -f "$change_batch"
}

print_manual_delegation_help() {
  local subdomain_zone="$1"
  shift
  local name_servers=("$@")

  cat <<EOF
Parent zone is not managed in Route 53, so delegation was not changed automatically.

Add these NS records at your DNS provider for:

  ${subdomain_zone}

Name servers:
EOF

  local ns
  for ns in "${name_servers[@]}"; do
    printf '  - %s\n' "$ns"
  done

  cat <<EOF

Cloudflare example:
1. Open the parent zone in Cloudflare.
2. Add an NS record for the name:
     ${subdomain_zone}
3. Enter all four Route 53 name servers above as the record values.
4. Keep the smoke-test hostname itself DNS-only. Do not proxy it through Cloudflare.

After delegation is live, rerun this script with --record-name and --ip to create the smoke hostname in Route 53.
EOF
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --subdomain-zone)
        SUBDOMAIN_ZONE="$2"
        shift 2
        ;;
      --record-name)
        RECORD_NAME="$2"
        shift 2
        ;;
      --ip)
        IPV4_ADDRESS="$2"
        shift 2
        ;;
      --ttl)
        TTL="$2"
        shift 2
        ;;
      --comment)
        COMMENT="$2"
        shift 2
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

validate_args() {
  if [[ -z "$SUBDOMAIN_ZONE" ]]; then
    echo "missing required --subdomain-zone" >&2
    usage
    exit 1
  fi

  SUBDOMAIN_ZONE="$(normalize_zone "$SUBDOMAIN_ZONE")"
  if [[ "$SUBDOMAIN_ZONE" != *.* ]]; then
    echo "--subdomain-zone must be a delegated subdomain such as smoke.example.com" >&2
    exit 1
  fi

  if [[ -n "$RECORD_NAME" && -z "$IPV4_ADDRESS" ]]; then
    echo "--record-name requires --ip" >&2
    exit 1
  fi

  if [[ -n "$IPV4_ADDRESS" && -z "$RECORD_NAME" ]]; then
    echo "--ip requires --record-name" >&2
    exit 1
  fi

  if [[ -n "$RECORD_NAME" ]]; then
    RECORD_NAME="$(normalize_zone "$RECORD_NAME")"
    case "$RECORD_NAME" in
      *."$SUBDOMAIN_ZONE"|"$SUBDOMAIN_ZONE")
        ;;
      *)
        echo "--record-name must be inside the delegated zone $SUBDOMAIN_ZONE" >&2
        exit 1
        ;;
    esac
  fi

  if ! [[ "$TTL" =~ ^[0-9]+$ ]]; then
    echo "--ttl must be an integer" >&2
    exit 1
  fi
}

main() {
  parse_args "$@"
  validate_args
  require_cmd aws

  local zone_id
  zone_id="$(ensure_hosted_zone "$SUBDOMAIN_ZONE")"

  mapfile -t name_servers < <(
    get_zone_name_servers "$zone_id" | tr '\t' '\n' | sed '/^$/d'
  )

  local parent_zone
  parent_zone="$(parent_zone_name "$SUBDOMAIN_ZONE")"
  local parent_zone_id=""
  if [[ -n "$parent_zone" ]]; then
    parent_zone_id="$(list_hosted_zone_id "$(fqdn_with_dot "$parent_zone")")"
  fi

  cat <<EOF
Delegated zone: ${SUBDOMAIN_ZONE}
Route 53 zone id: ${zone_id}
EOF

  if [[ -n "$parent_zone_id" && "$parent_zone_id" != "None" ]]; then
    upsert_ns_record "$(trim_zone_id "$parent_zone_id")" "$SUBDOMAIN_ZONE" "${name_servers[@]}"
    cat <<EOF
Parent zone ${parent_zone} is hosted in Route 53.
NS delegation has been upserted automatically.
EOF
  else
    print_manual_delegation_help "$SUBDOMAIN_ZONE" "${name_servers[@]}"
  fi

  if [[ -n "$RECORD_NAME" ]]; then
    upsert_a_record "$zone_id" "$RECORD_NAME" "$IPV4_ADDRESS"
    cat <<EOF

Created/updated A record:
  ${RECORD_NAME} -> ${IPV4_ADDRESS}
EOF
  fi

  cat <<EOF

Smoke test example:
  ./scripts/ec2-smoke-test.sh run --region us-west-1 --enable-https --tls-domain ${RECORD_NAME:-run-$(date +%Y%m%d).${SUBDOMAIN_ZONE}} --tls-email you@example.com
EOF
}

main "$@"

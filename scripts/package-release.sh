#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:-}"
OUTPUT_DIR="${2:-artifacts}"
ARCH="${3:-linux-x64}"

if [[ -z "${VERSION}" ]]; then
  VERSION="$(node -p "require('./package.json').version")"
fi

if [[ -z "${VERSION}" ]]; then
  echo "version is required" >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAGE_DIR="$(mktemp -d)"
PACKAGE_DIR="${STAGE_DIR}/ai-agent-desktop-manager"
ARTIFACT_BASENAME="ai-agent-desktop-manager-v${VERSION}-${ARCH}"
ARTIFACT_PATH="${ROOT_DIR}/${OUTPUT_DIR}/${ARTIFACT_BASENAME}.tar.gz"

cleanup() {
  rm -rf "${STAGE_DIR}"
}
trap cleanup EXIT

mkdir -p "${PACKAGE_DIR}" "${ROOT_DIR}/${OUTPUT_DIR}"

cp -R "${ROOT_DIR}/dist" "${PACKAGE_DIR}/dist"
cp -R "${ROOT_DIR}/systemd" "${PACKAGE_DIR}/systemd"
mkdir -p "${PACKAGE_DIR}/ops" "${PACKAGE_DIR}/scripts"
cp "${ROOT_DIR}/ops/sudoers-aadm" "${PACKAGE_DIR}/ops/sudoers-aadm"
cp "${ROOT_DIR}/package.json" "${PACKAGE_DIR}/package.json"
cp "${ROOT_DIR}/package-lock.json" "${PACKAGE_DIR}/package-lock.json"
cp "${ROOT_DIR}/README.md" "${PACKAGE_DIR}/README.md"
cp "${ROOT_DIR}/LICENSE" "${PACKAGE_DIR}/LICENSE"
cp "${ROOT_DIR}/.env.example" "${PACKAGE_DIR}/.env.example"
cp "${ROOT_DIR}/scripts/install-release.sh" "${PACKAGE_DIR}/scripts/install-release.sh"
chmod 0755 "${PACKAGE_DIR}/scripts/install-release.sh"

tar -C "${STAGE_DIR}" -czf "${ARTIFACT_PATH}" "ai-agent-desktop-manager"

echo "${ARTIFACT_PATH}"

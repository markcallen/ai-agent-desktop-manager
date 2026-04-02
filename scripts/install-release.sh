#!/usr/bin/env bash
set -euo pipefail

SERVICE_USER="aadm"
SERVICE_GROUP="aadm"
INSTALL_DIR="/opt/ai-agent-desktop-manager"

if [[ ! -f "./package.json" || ! -d "./dist" || ! -d "./systemd" ]]; then
  echo "run this script from the extracted release directory" >&2
  exit 1
fi

if [[ "${EUID}" -ne 0 ]]; then
  echo "this installer must be run as root (try again with sudo)" >&2
  exit 1
fi

if ! getent group "${SERVICE_GROUP}" >/dev/null 2>&1; then
  groupadd --system "${SERVICE_GROUP}"
fi

if ! id "${SERVICE_USER}" >/dev/null 2>&1; then
  useradd -r -m -g "${SERVICE_GROUP}" -s /usr/sbin/nologin "${SERVICE_USER}"
fi

install -d -o "${SERVICE_USER}" -g "${SERVICE_GROUP}" -m 0755 "${INSTALL_DIR}"
install -d -o "${SERVICE_USER}" -g "${SERVICE_GROUP}" -m 0755 "${INSTALL_DIR}/dist"
install -d -o "${SERVICE_USER}" -g "${SERVICE_GROUP}" -m 0755 "${INSTALL_DIR}/systemd"
cp -R ./dist/. "${INSTALL_DIR}/dist/"
cp -R ./systemd/. "${INSTALL_DIR}/systemd/"
chown -R "${SERVICE_USER}:${SERVICE_GROUP}" "${INSTALL_DIR}/dist" "${INSTALL_DIR}/systemd"
install -d -o "${SERVICE_USER}" -g "${SERVICE_GROUP}" -m 0755 "${INSTALL_DIR}/ops"
install -o "${SERVICE_USER}" -g "${SERVICE_GROUP}" -m 0644 ./package.json "${INSTALL_DIR}/package.json"
install -o "${SERVICE_USER}" -g "${SERVICE_GROUP}" -m 0644 ./package-lock.json "${INSTALL_DIR}/package-lock.json"
install -o "${SERVICE_USER}" -g "${SERVICE_GROUP}" -m 0644 ./.env.example "${INSTALL_DIR}/.env.example"
if [[ ! -f "${INSTALL_DIR}/.env" ]]; then
  install -o "${SERVICE_USER}" -g "${SERVICE_GROUP}" -m 0640 ./.env.example "${INSTALL_DIR}/.env"
fi
install -o "${SERVICE_USER}" -g "${SERVICE_GROUP}" -m 0644 ./ops/sudoers-aadm "${INSTALL_DIR}/ops/sudoers-aadm"

cd "${INSTALL_DIR}"
runuser -u "${SERVICE_USER}" -- npm ci --omit=dev

cp ./systemd/*.service /etc/systemd/system/
cp ./ops/sudoers-aadm /etc/sudoers.d/aadm
chmod 0440 /etc/sudoers.d/aadm

systemctl daemon-reload
systemctl enable --now aadm.service

echo "installed to ${INSTALL_DIR}"

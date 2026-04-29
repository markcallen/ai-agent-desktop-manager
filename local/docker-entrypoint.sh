#!/bin/bash
set -euo pipefail

# ---------- required directories ----------
mkdir -p /var/lib/aadm

AADM_STATE_DIR="${AADM_STATE_DIR:-/app/data}"
mkdir -p "${AADM_STATE_DIR}" "${AADM_STATE_DIR}/workspaces"
mkdir -p "${AADM_NGINX_SNIPPET_DIR:-${AADM_STATE_DIR}/nginx-snippets}"

AADM_PORT="${AADM_PORT:-8899}"

# ---------- start server in background ----------
"$@" &
SERVER_PID=$!

# ---------- wait for health ----------
echo "[entrypoint] waiting for server on :${AADM_PORT}..."
for i in $(seq 1 60); do
  if curl -sf "http://127.0.0.1:${AADM_PORT}/health" >/dev/null 2>&1; then
    echo "[entrypoint] server ready"
    break
  fi
  if ! kill -0 "${SERVER_PID}" 2>/dev/null; then
    echo "[entrypoint] server process exited unexpectedly" >&2
    exit 1
  fi
  sleep 1
done

# ---------- create initial desktop if none exists ----------
node --input-type=module <<EOF
const port = '${AADM_PORT}';
const base = 'http://127.0.0.1:' + port;

const list = await fetch(base + '/v1/desktops')
  .then(r => r.json())
  .catch(() => ({ desktops: [] }));

if (!list.desktops || list.desktops.length === 0) {
  console.log('[entrypoint] creating initial desktop...');
  const result = await fetch(base + '/v1/desktops', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ owner: 'local', label: 'local-dev' })
  }).then(r => r.json()).catch(e => ({ error: e.message }));
  console.log('[entrypoint] desktop:', JSON.stringify(result));
  if (result.id) {
    console.log('[entrypoint] open: http://localhost:' + port + '/_aadm/desktop/' + result.id);
  }
} else {
  const id = list.desktops[0].id;
  console.log('[entrypoint] desktop already exists:', id);
  console.log('[entrypoint] open: http://localhost:' + port + '/_aadm/desktop/' + id);
}
EOF

# ---------- foreground the server ----------
wait "${SERVER_PID}"

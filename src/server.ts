import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import replyFrom from '@fastify/reply-from';
import lockfile from 'proper-lockfile';
import path from 'node:path';
import net from 'node:net';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import crypto from 'node:crypto';
import type { WebSocket as WsWebSocket } from 'ws';

import { config } from './util/config.js';
import { authHook } from './util/auth.js';
import {
  loadState,
  saveState,
  type State,
  type DesktopRecord,
  nowMs,
  getStateDir
} from './util/store.js';
import { allocate } from './util/allocator.js';
import {
  buildSnippet,
  writeSnippet,
  writeGlobalSnippet,
  removeSnippet,
  nginxTest,
  nginxReload,
  snippetFilename
} from './util/nginx.js';
import {
  systemctlStart,
  systemctlStop,
  systemctlIsActive,
  unitName
} from './util/systemd.js';
import { CreateAccessUrlBody, CreateDesktopBody } from './api/types.js';
import { isPortOpen } from './util/net.js';
import { appVersion } from './util/app-version.js';
import {
  buildLoggerOptions,
  attachRequestIdHeader,
  REQUEST_ID_HEADER
} from './util/logging.js';
import {
  createDesktopAccessToken,
  desktopAccessCookieName,
  DESKTOP_ACCESS_TOKEN_QUERY_PARAM,
  resolveDesktopRouteAuth,
  verifyDesktopAccessToken
} from './util/route-auth.js';
import { findPortCollisions } from './util/port-usage.js';
import { isStartUrlAllowed } from './util/start-url.js';
import {
  desktopWorkspaceDir,
  ensureTmuxSession,
  ensureWorkspaceDir,
  isTmuxSessionActive,
  killTmuxSession,
  resizeTmuxSession,
  terminalMetadataForDesktop,
  terminalSessionName
} from './util/terminal.js';
import { acceptWebSocket } from './util/websocket.js';
import { createTerminalAttachProcess } from './util/terminal-pty.js';
import {
  buildBridgeHandler,
  managerBridgeWebsocketPath
} from './util/bridge.js';

function desktopId(display: number) {
  return `desk-${display}`;
}

function novncUrlFor(display: number) {
  const base = config.publicBaseUrl.replace(/\/$/, '');
  const prefix = config.novncPathPrefix.replace(/\/$/, '');
  const params = new URLSearchParams({
    path: `${prefix.replace(/^\//, '')}/${display}/websockify`,
    resize: 'remote',
    autoconnect: '1'
  });
  return `${base}${prefix}/${display}/vnc.html?${params.toString()}`;
}

function desktopAccessPathFor(display: number) {
  const prefix = config.novncPathPrefix.replace(/\/$/, '');
  return `${prefix}/${display}/access`;
}

function desktopShellRelativeUrlFor(display: number) {
  const prefix = config.novncPathPrefix.replace(/\/$/, '');
  return `${prefix}/${display}/`;
}

function aabUrlFor(port: number) {
  return `http://127.0.0.1:${port}`;
}

function terminalFor(
  desktop: Pick<
    DesktopRecord,
    'id' | 'display' | 'workspaceDir' | 'terminalSessionName'
  >
) {
  return terminalMetadataForDesktop(desktop);
}

function parseCookieValue(rawCookieHeader: string | undefined, name: string) {
  if (!rawCookieHeader) return undefined;

  for (const part of rawCookieHeader.split(';')) {
    const [cookieName, ...valueParts] = part.trim().split('=');
    if (cookieName === name) {
      return valueParts.join('=');
    }
  }

  return undefined;
}

function getDesktopAccessTokenSecret() {
  if (!config.desktopRouteTokenSecret) {
    throw new Error('invalid_config:desktop_route_token_secret_required');
  }
  return config.desktopRouteTokenSecret;
}

function mintDesktopAccessUrl(
  desktop: Pick<DesktopRecord, 'id' | 'display' | 'routeAuth'>,
  ttlSeconds?: number,
  issuedAtMs = nowMs()
) {
  if (desktop.routeAuth.mode !== 'token') return undefined;

  const effectiveTtlSeconds = ttlSeconds ?? desktop.routeAuth.token.ttlSeconds;
  const token = createDesktopAccessToken(
    desktop.id,
    getDesktopAccessTokenSecret(),
    effectiveTtlSeconds,
    issuedAtMs
  );
  const base = config.publicBaseUrl.replace(/\/$/, '');
  const accessUrl = new URL(`${base}${desktopAccessPathFor(desktop.display)}`);
  accessUrl.searchParams.set(DESKTOP_ACCESS_TOKEN_QUERY_PARAM, token);

  return {
    accessUrl: accessUrl.toString(),
    expiresAt: issuedAtMs + effectiveTtlSeconds * 1000
  };
}

function buildDesktopAccessCookie(
  desktop: Pick<DesktopRecord, 'id' | 'display'>,
  token: string,
  expiresAt: number
) {
  const cookieParts = [
    `${desktopAccessCookieName(desktop.id)}=${token}`,
    `Path=${config.novncPathPrefix.replace(/\/$/, '')}/${desktop.display}/`,
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.max(1, Math.floor((expiresAt - nowMs()) / 1000))}`
  ];

  if (new URL(config.publicBaseUrl).protocol === 'https:') {
    cookieParts.push('Secure');
  }

  return cookieParts.join('; ');
}

async function withStateLock<T>(fn: () => Promise<T>): Promise<T> {
  const lockPath = path.join(path.resolve(getStateDir()), 'state.lock');
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  await fs.writeFile(lockPath, '', { flag: 'a' });
  const release = await lockfile.lock(lockPath, {
    retries: { retries: 10, factor: 1.2, minTimeout: 50, maxTimeout: 250 }
  });
  try {
    return await fn();
  } finally {
    await release();
  }
}

async function stopUnitsByNames(
  units: string[],
  log: { warn: (obj: unknown, msg: string) => void }
) {
  const errors: string[] = [];
  for (const unit of units) {
    try {
      await systemctlStop(unit);
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      errors.push(msg);
      log.warn({ err: e, unit }, 'systemctl stop failed');
    }
  }
  return errors;
}

async function startUnits(
  display: number,
  log: { warn: (obj: unknown, msg: string) => void },
  startUrl?: string
) {
  const uVnc = unitName(config.unitVnc, display);
  const uWs = unitName(config.unitWebsockify, display);
  const uChrome = unitName(config.unitChrome, display);
  const uAab = unitName(config.unitAab, display);
  const started: string[] = [];

  try {
    // Start in dependency order.
    const env = startUrl ? { START_URL: startUrl } : undefined;
    await systemctlStart(uVnc, env);
    started.push(uVnc);
    await systemctlStart(uWs, env);
    started.push(uWs);
    await systemctlStart(uChrome, env);
    started.push(uChrome);
    await systemctlStart(uAab, env);
    started.push(uAab);
  } catch (e) {
    await stopUnitsByNames([...started].reverse(), log);
    throw e;
  }

  return { uVnc, uWs, uChrome, uAab, all: [uVnc, uWs, uChrome, uAab] };
}

async function stopUnits(
  display: number,
  log: { warn: (obj: unknown, msg: string) => void }
) {
  const uAab = unitName(config.unitAab, display);
  const uChrome = unitName(config.unitChrome, display);
  const uWs = unitName(config.unitWebsockify, display);
  const uVnc = unitName(config.unitVnc, display);

  // Stop in reverse order.
  const errors = await stopUnitsByNames([uAab, uChrome, uWs, uVnc], log);

  return { uVnc, uWs, uChrome, uAab, errors };
}

async function removeSnippetAndReload(
  id: string,
  log: { warn: (obj: unknown, msg: string) => void }
) {
  const issues: string[] = [];
  try {
    await removeSnippet(id);
    const testRes = await nginxTest();
    if (!testRes.ok) {
      issues.push(
        `nginx test failed during rollback: ${testRes.stderr || testRes.stdout}`
      );
      return issues;
    }

    const reloadRes = await nginxReload();
    if (!reloadRes.ok) {
      issues.push(
        `nginx reload failed during rollback: ${reloadRes.stderr || reloadRes.stdout}`
      );
    }
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    issues.push(`snippet rollback failed: ${msg}`);
    log.warn({ err: e, desktopId: id }, 'failed to rollback nginx snippet');
  }
  return issues;
}

async function restoreSnippetAndReload(
  desktop: Pick<DesktopRecord, 'id' | 'display' | 'wsPort' | 'routeAuth'>,
  log: { warn: (obj: unknown, msg: string) => void }
) {
  const issues: string[] = [];
  try {
    await writeSnippet(
      desktop.id,
      buildSnippet(
        desktop.id,
        desktop.display,
        desktop.wsPort,
        desktop.routeAuth
      )
    );
    const testRes = await nginxTest();
    if (!testRes.ok) {
      issues.push(
        `nginx test failed during restore: ${testRes.stderr || testRes.stdout}`
      );
      return issues;
    }

    const reloadRes = await nginxReload();
    if (!reloadRes.ok) {
      issues.push(
        `nginx reload failed during restore: ${reloadRes.stderr || reloadRes.stdout}`
      );
    }
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    issues.push(`snippet restore failed: ${msg}`);
    log.warn(
      { err: e, desktopId: desktop.id },
      'failed to restore nginx snippet'
    );
  }
  return issues;
}

async function rollbackCreatedDesktop(
  desktop: Pick<DesktopRecord, 'id' | 'display' | 'terminalSessionName'>,
  snippetWritten: boolean,
  log: { warn: (obj: unknown, msg: string) => void }
) {
  const issues: string[] = [];
  if (snippetWritten) {
    issues.push(...(await removeSnippetAndReload(desktop.id, log)));
  }

  const terminalStop = await killTmuxSession(desktop.terminalSessionName);
  if (!terminalStop.ok) {
    issues.push(`terminal stop failed during rollback: ${terminalStop.error}`);
  }

  const stopRes = await stopUnits(desktop.display, log);
  issues.push(
    ...stopRes.errors.map((err) => `stop failed during rollback: ${err}`)
  );
  return issues;
}

async function restoreDestroyedDesktop(
  desktop: DesktopRecord,
  log: { warn: (obj: unknown, msg: string) => void }
) {
  const issues: string[] = [];
  try {
    await ensureWorkspaceDir(desktop.workspaceDir);
    await ensureTmuxSession(desktop.terminalSessionName, desktop.workspaceDir);
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    issues.push(`terminal restore failed: ${msg}`);
    log.warn(
      { err: e, desktopId: desktop.id },
      'failed to restore terminal session'
    );
  }

  try {
    await startUnits(desktop.display, log);
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    issues.push(`unit restore failed: ${msg}`);
    log.warn(
      { err: e, desktopId: desktop.id },
      'failed to restore desktop units'
    );
  }

  issues.push(...(await restoreSnippetAndReload(desktop, log)));
  return issues;
}

async function restoreRunningDesktops(
  app: Pick<FastifyInstance, 'log'>,
  state?: State
) {
  const effectiveState = state ?? (await loadState());
  const restored: string[] = [];
  const failed: Array<{ id: string; issues: string[] }> = [];

  for (const desktop of effectiveState.desktops.filter(
    (entry) => entry.status === 'running'
  )) {
    const issues = await restoreDestroyedDesktop(desktop, app.log);
    if (issues.length === 0) {
      restored.push(desktop.id);
      continue;
    }

    failed.push({ id: desktop.id, issues });
    app.log.warn(
      { desktopId: desktop.id, issues },
      'desktop restore completed with issues'
    );
  }

  if (restored.length > 0) {
    app.log.info({ restored }, 'restored persisted desktops');
  }

  return { restored, failed };
}

type BuildAppOptions = {
  loggerStream?: NodeJS.WritableStream;
};

function genReqId(req: { headers: Record<string, unknown> }) {
  const incoming = req.headers[REQUEST_ID_HEADER];
  if (typeof incoming === 'string' && incoming.trim()) {
    return incoming.trim();
  }
  return crypto.randomUUID();
}

function authHeadersForInternalRequest() {
  if (!config.authToken) return undefined;
  return { authorization: `Bearer ${config.authToken}` };
}

export async function sweepExpiredDesktops(
  app: Pick<FastifyInstance, 'inject' | 'log'>,
  now = nowMs()
) {
  const state = await loadState();
  const expiredDesktopIds = state.desktops
    .filter(
      (desktop) => desktop.expiresAt !== undefined && desktop.expiresAt <= now
    )
    .map((desktop) => desktop.id);

  const deleted: string[] = [];
  const failed: Array<{ id: string; statusCode: number; body: unknown }> = [];

  for (const id of expiredDesktopIds) {
    const response = await app.inject({
      method: 'DELETE',
      url: `/v1/desktops/${id}`,
      headers: authHeadersForInternalRequest()
    });

    if (response.statusCode >= 200 && response.statusCode < 300) {
      deleted.push(id);
      continue;
    }

    let body: unknown = response.body;
    try {
      body = response.json();
    } catch {
      // keep raw body
    }

    failed.push({ id, statusCode: response.statusCode, body });
  }

  if (deleted.length > 0) {
    app.log.info({ deleted }, 'deleted expired desktops');
  }
  if (failed.length > 0) {
    app.log.warn({ failed }, 'failed to delete some expired desktops');
  }

  return { deleted, failed };
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webDistDir = path.resolve(__dirname, '../web/dist');
const viteDevUrl = config.viteDevUrl;

// One-time secret generated at startup — injected into the desktop config so
// only the browser app (which fetched the config) can post to /_aadm/logs.
const browserLogsToken = crypto.randomBytes(32).toString('hex');

function buildDesktopConfig(d: DesktopRecord) {
  const bridgeEnabled = !!config.bridgeAddr;
  const bridgeWebsocketUrl = managerBridgeWebsocketPath(d.id);

  return {
    desktop: {
      id: d.id,
      display: d.display,
      label: d.label || d.id,
      novncUrl: novncUrlFor(d.display)
    },
    terminal: {
      websocketUrl: d.terminalWebsocketUrl,
      websocketPath: d.terminalWebsocketPath,
      sessionName: d.terminalSessionName,
      workspaceDir: d.workspaceDir
    },
    bridge: {
      enabled: bridgeEnabled,
      websocketUrl: bridgeWebsocketUrl,
      websocketPath: bridgeWebsocketUrl,
      workspaceDir: d.workspaceDir,
      defaultProvider: 'claude',
      projectId: d.id
    },
    browserLogsToken
  };
}

export function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({
    logger: buildLoggerOptions(options.loggerStream) as never,
    genReqId,
    requestIdHeader: 'x-request-id',
    disableRequestLogging: false
  }) as unknown as FastifyInstance;
  const bridgeHandler = buildBridgeHandler();
  app.addHook('preHandler', authHook);
  app.addHook('onRequest', async (req, reply) => {
    attachRequestIdHeader(reply, req.log, req.id);
  });

  if (viteDevUrl) {
    void app.register(replyFrom);
  } else {
    void app.register(fastifyStatic, {
      root: webDistDir,
      prefix: '/_aadm/desktop-app/'
    });
  }

  app.server.on('upgrade', (req, socket, head) => {
    const requestUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
    const match = /^\/_aadm\/terminal\/([^/]+)\/ws$/.exec(requestUrl.pathname);
    const bridgeMatch = /^\/_aadm\/bridge\/([^/]+)\/ws$/.exec(
      requestUrl.pathname
    );
    const isViteHmr = viteDevUrl && requestUrl.pathname === '/_aadm_hmr';

    if (!match && !bridgeMatch && !isViteHmr) {
      socket.destroy();
      return;
    }

    if (isViteHmr && viteDevUrl) {
      const target = new URL(viteDevUrl);
      const port = parseInt(target.port || '80', 10);
      const proxySocket = net.connect(port, target.hostname);
      const headers = Object.entries(req.headers)
        .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
        .join('\r\n');
      proxySocket.write(`GET /_aadm_hmr HTTP/1.1\r\n${headers}\r\n\r\n`);
      proxySocket.pipe(socket);
      socket.pipe(proxySocket);
      proxySocket.on('error', () => socket.destroy());
      socket.on('close', () => proxySocket.destroy());
      return;
    }

    if (bridgeMatch) {
      if (!bridgeHandler) {
        socket.write('HTTP/1.1 501 Not Implemented\r\n\r\n');
        socket.destroy();
        return;
      }

      const desktopId = bridgeMatch[1];
      void (async () => {
        const st = await loadState();
        const desktop = st.desktops.find((entry) => entry.id === desktopId);
        if (!desktop) {
          socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
          socket.destroy();
          return;
        }

        bridgeHandler.handleUpgrade(req, socket, head, (ws: WsWebSocket) => {
          bridgeHandler.emit('connection', ws, req);
        });
      })().catch(() => {
        socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
        socket.destroy();
      });
      return;
    }

    const desktopId = match?.[1];
    if (!desktopId) {
      socket.destroy();
      return;
    }
    void (async () => {
      const st = await loadState();
      const desktop = st.desktops.find((entry) => entry.id === desktopId);
      if (!desktop) {
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
        socket.destroy();
        return;
      }

      const cols = Math.max(
        1,
        Number.parseInt(requestUrl.searchParams.get('cols') ?? '120', 10) || 120
      );
      const rows = Math.max(
        1,
        Number.parseInt(requestUrl.searchParams.get('rows') ?? '40', 10) || 40
      );

      await ensureWorkspaceDir(desktop.workspaceDir);
      await ensureTmuxSession(
        desktop.terminalSessionName,
        desktop.workspaceDir
      );

      const terminalProcess = createTerminalAttachProcess({
        sessionName: desktop.terminalSessionName,
        cols,
        rows
      });

      const ws = acceptWebSocket(req, socket, {
        onMessage(message) {
          try {
            const parsed = JSON.parse(message) as
              | { type?: string; data?: string; cols?: number; rows?: number }
              | undefined;
            if (!parsed || typeof parsed.type !== 'string') return;

            if (parsed.type === 'input' && typeof parsed.data === 'string') {
              terminalProcess.stdin.write(parsed.data);
              return;
            }

            if (
              parsed.type === 'resize' &&
              Number.isInteger(parsed.cols) &&
              Number.isInteger(parsed.rows)
            ) {
              void resizeTmuxSession(
                desktop.terminalSessionName,
                Number(parsed.cols),
                Number(parsed.rows)
              );
            }
          } catch {
            // ignore invalid messages
          }
        },
        onClose() {
          terminalProcess.kill('SIGTERM');
        }
      });

      if (!ws) return;

      ws.sendJson({
        type: 'ready',
        desktopId: desktop.id,
        terminal: terminalFor(desktop)
      });

      terminalProcess.stdout.on('data', (chunk) => {
        ws.sendJson({
          type: 'output',
          data: Buffer.from(chunk).toString('base64')
        });
      });
      terminalProcess.stderr.on('data', (chunk) => {
        ws.sendJson({
          type: 'output',
          data: Buffer.from(chunk).toString('base64')
        });
      });
      terminalProcess.on('close', (code) => {
        ws.sendJson({
          type: 'exit',
          code: code ?? 0
        });
        ws.close();
      });
      terminalProcess.on('error', (error) => {
        ws.sendJson({
          type: 'error',
          error: error.message
        });
        ws.close();
      });
    })().catch(() => {
      socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
      socket.destroy();
    });
  });

  app.get('/health', async () => {
    return {
      ok: true,
      version: appVersion,
      uptimeSec: Math.floor(process.uptime())
    };
  });

  app.get('/healthz/live', async () => {
    return { ok: true };
  });

  app.get('/healthz/ready', async (_, reply) => {
    try {
      await loadState();
      return { ok: true };
    } catch (err) {
      reply.code(503);
      return { ok: false, error: String(err) };
    }
  });

  app.get('/', async (_, reply) => {
    const st = await loadState();
    const hostname = os.hostname();
    const uptimeSec = Math.floor(process.uptime());
    const uptimeStr =
      uptimeSec < 60
        ? `${uptimeSec}s`
        : uptimeSec < 3600
          ? `${Math.floor(uptimeSec / 60)}m ${uptimeSec % 60}s`
          : `${Math.floor(uptimeSec / 3600)}h ${Math.floor((uptimeSec % 3600) / 60)}m`;
    const desktopRows = st.desktops
      .map(
        (d) =>
          `<tr>
            <td><code>${d.id}</code></td>
            <td>${d.label ?? ''}</td>
            <td>${d.owner ?? ''}</td>
            <td><a href="/_aadm/desktop/${d.id}">open</a></td>
          </tr>`
      )
      .join('\n');
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>AADM — ${hostname}</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 800px; margin: 2rem auto; padding: 0 1rem; color: #222; }
    h1 { font-size: 1.4rem; margin-bottom: 0.25rem; }
    .meta { color: #666; font-size: 0.9rem; margin-bottom: 1.5rem; }
    table { border-collapse: collapse; width: 100%; }
    th, td { text-align: left; padding: 0.4rem 0.75rem; border-bottom: 1px solid #e0e0e0; }
    th { background: #f5f5f5; font-weight: 600; }
    code { background: #f0f0f0; padding: 0.1em 0.3em; border-radius: 3px; font-size: 0.9em; }
    .section { margin-top: 1.5rem; }
    .kv { display: grid; grid-template-columns: max-content 1fr; gap: 0.25rem 1rem; }
    .kv dt { color: #666; font-size: 0.9rem; }
    .kv dd { margin: 0; }
  </style>
</head>
<body>
  <h1>AI Agent Desktop Manager</h1>
  <div class="meta">version ${appVersion} &nbsp;·&nbsp; ${hostname}</div>

  <div class="section">
    <dl class="kv">
      <dt>Uptime</dt>        <dd>${uptimeStr}</dd>
      <dt>Public URL</dt>    <dd><code>${config.publicBaseUrl}</code></dd>
      <dt>Bridge</dt>        <dd>${config.bridgeAddr ? `<code>${config.bridgeAddr}</code>` : '<span style="color:#999">not configured</span>'}</dd>
      <dt>Desktops</dt>      <dd>${st.desktops.length}</dd>
    </dl>
  </div>

  <div class="section">
    <h2 style="font-size:1rem">Desktops</h2>
    ${
      st.desktops.length === 0
        ? '<p style="color:#999">No desktops.</p>'
        : `<table>
      <thead><tr><th>ID</th><th>Label</th><th>Owner</th><th></th></tr></thead>
      <tbody>${desktopRows}</tbody>
    </table>`
    }
  </div>
</body>
</html>`;
    reply.type('text/html');
    return html;
  });

  app.get('/v1/desktops', async () => {
    const st = await loadState();
    return { desktops: st.desktops };
  });

  app.get('/v1/desktops/:id', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const st = await loadState();
    const d = st.desktops.find((x) => x.id === id);
    if (!d) return reply.code(404).send({ ok: false, error: 'not_found' });
    return d;
  });

  app.post('/v1/desktops/:id/access-url', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const parsed = CreateAccessUrlBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        ok: false,
        error: 'invalid_body',
        details: parsed.error.flatten()
      });
    }

    const st = await loadState();
    const d = st.desktops.find((desktop) => desktop.id === id);
    if (!d) return reply.code(404).send({ ok: false, error: 'not_found' });
    if (d.routeAuth.mode !== 'token') {
      return reply.code(400).send({
        ok: false,
        error: 'route_auth_mode_not_supported'
      });
    }

    const requestedTtlSeconds = parsed.data.ttlSeconds;
    if (
      requestedTtlSeconds &&
      requestedTtlSeconds > config.desktopRouteTokenTtlSeconds
    ) {
      return reply.code(400).send({
        ok: false,
        error: 'ttl_seconds_too_large',
        maxTtlSeconds: config.desktopRouteTokenTtlSeconds
      });
    }

    const access = mintDesktopAccessUrl(d, requestedTtlSeconds);
    if (!access) {
      return reply
        .code(500)
        .send({ ok: false, error: 'route_auth_mode_not_supported' });
    }

    return {
      id: d.id,
      routeAuth: d.routeAuth,
      accessUrl: access.accessUrl,
      expiresAt: access.expiresAt
    };
  });

  app.post('/v1/desktops/:id/terminal-access', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const parsed = CreateAccessUrlBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        ok: false,
        error: 'invalid_body',
        details: parsed.error.flatten()
      });
    }

    const st = await loadState();
    const d = st.desktops.find((desktop) => desktop.id === id);
    if (!d) return reply.code(404).send({ ok: false, error: 'not_found' });

    const requestedTtlSeconds = parsed.data.ttlSeconds;
    if (
      d.routeAuth.mode === 'token' &&
      requestedTtlSeconds &&
      requestedTtlSeconds > config.desktopRouteTokenTtlSeconds
    ) {
      return reply.code(400).send({
        ok: false,
        error: 'ttl_seconds_too_large',
        maxTtlSeconds: config.desktopRouteTokenTtlSeconds
      });
    }

    const access = mintDesktopAccessUrl(d, requestedTtlSeconds);
    return {
      id: d.id,
      routeAuth: d.routeAuth,
      terminal: terminalFor(d),
      ...(access
        ? {
            accessUrl: access.accessUrl,
            accessUrlExpiresAt: access.expiresAt
          }
        : {})
    };
  });

  app.get('/_aadm/access/:id', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const query = req.query as Record<string, string | undefined>;
    const token = query?.[DESKTOP_ACCESS_TOKEN_QUERY_PARAM];
    const st = await loadState();
    const d = st.desktops.find((desktop) => desktop.id === id);
    if (!d) return reply.code(404).send({ ok: false, error: 'not_found' });
    if (d.routeAuth.mode !== 'token') {
      return reply.code(404).send({ ok: false, error: 'not_found' });
    }
    if (!token) {
      return reply.code(401).send({ ok: false, error: 'missing_access_token' });
    }

    const verified = verifyDesktopAccessToken(
      token,
      d.id,
      getDesktopAccessTokenSecret()
    );
    if (!verified) {
      return reply.code(401).send({ ok: false, error: 'invalid_access_token' });
    }

    reply.header('cache-control', 'no-store');
    reply.header(
      'set-cookie',
      buildDesktopAccessCookie(d, token, verified.expiresAt)
    );
    return reply.redirect(desktopShellRelativeUrlFor(d.display));
  });

  app.get('/_aadm/desktop/:id', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const st = await loadState();
    const d = st.desktops.find((desktop) => desktop.id === id);
    if (!d) return reply.code(404).send({ ok: false, error: 'not_found' });

    reply.header('cache-control', 'no-store');
    if (viteDevUrl) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (reply as any).from(`${viteDevUrl}/_aadm/desktop-app/`);
    }
    const indexHtml = await fs.readFile(
      path.join(webDistDir, 'index.html'),
      'utf-8'
    );
    // Inject desktop ID so the React app can identify itself even when nginx
    // proxies /desktop/:display/ → /_aadm/desktop/:id (URL bar shows nginx path).
    const injected = indexHtml.replace(
      '<script',
      `<script>window.__AADM_DESKTOP_ID__=${JSON.stringify(id)};</script><script`
    );
    reply.type('text/html; charset=utf-8');
    return injected;
  });

  app.get('/_aadm/desktop/:id/config', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const st = await loadState();
    const d = st.desktops.find((desktop) => desktop.id === id);
    if (!d) return reply.code(404).send({ ok: false, error: 'not_found' });

    reply.header('cache-control', 'no-store');
    return buildDesktopConfig(d);
  });

  interface BrowserLogEntry {
    level?: string;
    msg?: string;
    time?: number;
    source?: string;
    [key: string]: unknown;
  }

  interface BrowserPinoLogEvent {
    ts?: number;
    messages?: unknown[];
    bindings?: Record<string, unknown>[];
    level?: {
      label?: string;
      value?: number;
    };
  }

  interface BrowserPinoBatchEntry {
    level?: string;
    logEvent?: BrowserPinoLogEvent;
  }

  function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function stringifyBrowserMessage(value: unknown) {
    if (typeof value === 'string') return value;
    if (value instanceof Error) return value.message;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  function normalizeBrowserPinoBatchEntry(entry: BrowserPinoBatchEntry) {
    const logEvent = entry.logEvent;
    if (!logEvent) return undefined;

    const meta: Record<string, unknown> = { browser: true };
    if (typeof logEvent.ts === 'number') {
      meta.browserTime = logEvent.ts;
    }

    for (const binding of logEvent.bindings ?? []) {
      if (isRecord(binding)) {
        Object.assign(meta, binding);
      }
    }

    const messages = Array.isArray(logEvent.messages) ? logEvent.messages : [];
    let message = '';

    if (messages.length > 0) {
      const [first, second, ...rest] = messages;

      if (isRecord(first)) {
        Object.assign(meta, first);
        if (typeof second === 'string') {
          message = second;
          if (rest.length > 0) meta.args = rest;
        } else {
          message = stringifyBrowserMessage(
            first.msg ?? first.message ?? first
          );
          if (second !== undefined) {
            meta.args = [second, ...rest];
          }
        }
      } else if (typeof first === 'string') {
        message = first;
        if (second !== undefined) {
          meta.args = [second, ...rest];
        }
      } else {
        message = stringifyBrowserMessage(first);
        if (second !== undefined) {
          meta.args = [second, ...rest];
        }
      }
    }

    return {
      level: entry.level ?? logEvent.level?.label ?? 'info',
      msg: message,
      meta
    };
  }

  app.post('/_aadm/logs', async (req, reply) => {
    const token = req.headers['x-aadm-logs-token'];
    if (token !== browserLogsToken) {
      return reply.code(403).send({ ok: false, error: 'invalid_token' });
    }

    const pinoBatchEntries = isRecord(req.body)
      ? Array.isArray(req.body.logs)
        ? (req.body.logs as BrowserPinoBatchEntry[])
        : []
      : [];
    const legacyEntries = Array.isArray(req.body)
      ? (req.body as BrowserLogEntry[])
      : [];

    for (const entry of pinoBatchEntries) {
      const normalized = normalizeBrowserPinoBatchEntry(entry);
      if (!normalized) continue;

      switch (normalized.level) {
        case 'trace':
          req.log.trace(normalized.meta, normalized.msg);
          break;
        case 'debug':
          req.log.debug(normalized.meta, normalized.msg);
          break;
        case 'warn':
          req.log.warn(normalized.meta, normalized.msg);
          break;
        case 'error':
        case 'fatal':
          req.log.error(normalized.meta, normalized.msg);
          break;
        default:
          req.log.info(normalized.meta, normalized.msg);
      }
    }

    for (const entry of legacyEntries) {
      const { level, msg, time, source, ...rest } = entry;
      const message = msg ?? '';
      const meta: Record<string, unknown> = { browser: true, ...rest };
      if (source) meta.source = source;
      if (time) meta.browserTime = time;

      switch (level) {
        case 'trace':
          req.log.trace(meta, message);
          break;
        case 'debug':
          req.log.debug(meta, message);
          break;
        case 'warn':
          req.log.warn(meta, message);
          break;
        case 'error':
          req.log.error(meta, message);
          break;
        default:
          req.log.info(meta, message);
          break;
      }
    }

    return reply.send({ ok: true });
  });

  if (viteDevUrl) {
    app.get('/_aadm/desktop-app/*', async (req, reply) => {
      const suffix = (req.params as { '*': string })['*'];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (reply as any).from(`${viteDevUrl}/_aadm/desktop-app/${suffix}`);
    });
  }

  app.get('/_aadm/verify/:id', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const st = await loadState();
    const d = st.desktops.find((desktop) => desktop.id === id);
    if (!d) return reply.code(404).send({ ok: false, error: 'not_found' });
    if (d.routeAuth.mode !== 'token') {
      return reply.code(404).send({ ok: false, error: 'not_found' });
    }

    const token = parseCookieValue(
      req.headers.cookie,
      desktopAccessCookieName(d.id)
    );
    if (!token) {
      return reply
        .code(401)
        .send({ ok: false, error: 'missing_access_cookie' });
    }

    const verified = verifyDesktopAccessToken(
      token,
      d.id,
      getDesktopAccessTokenSecret()
    );
    if (!verified) {
      return reply
        .code(401)
        .send({ ok: false, error: 'invalid_access_cookie' });
    }

    reply.header('cache-control', 'no-store');
    return reply.code(204).send();
  });

  app.post('/v1/desktops', async (req, reply) => {
    const parsed = CreateDesktopBody.safeParse(req.body ?? {});
    if (!parsed.success)
      return reply.code(400).send({
        ok: false,
        error: 'invalid_body',
        details: parsed.error.flatten()
      });

    if (
      parsed.data.startUrl &&
      !isStartUrlAllowed(parsed.data.startUrl, config.allowedStartUrlDomains)
    ) {
      return reply.code(400).send({
        ok: false,
        error: 'start_url_not_allowed',
        allowedDomains: config.allowedStartUrlDomains
      });
    }

    return await withStateLock(async () => {
      const st = await loadState();
      const alloc = allocate(st.desktops);
      const portCollisions = await findPortCollisions([
        alloc.vncPort,
        alloc.wsPort,
        alloc.cdpPort,
        alloc.aabPort
      ]);
      if (portCollisions.length > 0) {
        return reply.code(409).send({
          ok: false,
          error: 'ports_unavailable',
          ports: portCollisions
        });
      }

      const id = desktopId(alloc.display);
      const workspaceDir = desktopWorkspaceDir(id);
      const tmuxSession = terminalSessionName(id);
      const createdAt = nowMs();
      const ttlMinutes = parsed.data.ttlMinutes;
      const expiresAt = ttlMinutes
        ? createdAt + ttlMinutes * 60_000
        : undefined;

      const novncUrl = novncUrlFor(alloc.display);
      const aabUrl = aabUrlFor(alloc.aabPort);
      let routeAuth;
      try {
        routeAuth = resolveDesktopRouteAuth(config, parsed.data.routeAuthMode);
      } catch (e) {
        return reply.code(500).send({
          ok: false,
          error: 'route_auth_config_invalid',
          details: String((e as Error)?.message ?? e)
        });
      }

      const record: DesktopRecord = {
        id,
        owner: parsed.data.owner,
        label: parsed.data.label,
        ttlMinutes,
        createdAt,
        expiresAt,
        status: 'running',
        display: alloc.display,
        vncPort: alloc.vncPort,
        wsPort: alloc.wsPort,
        cdpPort: alloc.cdpPort,
        aabPort: alloc.aabPort,
        novncUrl,
        aabUrl,
        workspaceDir,
        terminalSessionName: tmuxSession,
        terminalWebsocketPath: terminalFor({
          id,
          display: alloc.display,
          workspaceDir,
          terminalSessionName: tmuxSession
        }).websocketPath,
        terminalWebsocketUrl: terminalFor({
          id,
          display: alloc.display,
          workspaceDir,
          terminalSessionName: tmuxSession
        }).websocketUrl,
        startUrl: parsed.data.startUrl,
        routeAuth
      };

      // 1) start units
      try {
        await startUnits(alloc.display, app.log, parsed.data.startUrl);
      } catch (e) {
        return reply.code(500).send({
          ok: false,
          error: 'failed_start_units',
          details: String((e as Error)?.message ?? e)
        });
      }

      try {
        await ensureWorkspaceDir(workspaceDir);
        await ensureTmuxSession(tmuxSession, workspaceDir);
      } catch (e) {
        await stopUnits(alloc.display, app.log);
        return reply.code(500).send({
          ok: false,
          error: 'terminal_init_failed',
          details: String((e as Error)?.message ?? e)
        });
      }

      // 2) write nginx snippet
      let snippetWritten = false;
      try {
        const snippet = buildSnippet(
          id,
          alloc.display,
          alloc.wsPort,
          routeAuth
        );
        await writeSnippet(id, snippet);
        snippetWritten = true;

        const t = await nginxTest();
        if (!t.ok) {
          throw new Error(`nginx_test_failed: ${t.stderr || t.stdout}`);
        }

        const r = await nginxReload();
        if (!r.ok) {
          throw new Error(`nginx_reload_failed: ${r.stderr || r.stdout}`);
        }
      } catch (e) {
        if (snippetWritten) {
          try {
            await removeSnippet(id);
          } catch (cleanupErr) {
            app.log.warn(
              { err: cleanupErr },
              'failed to remove nginx snippet during rollback'
            );
          }
        }
        await killTmuxSession(tmuxSession);
        await stopUnits(alloc.display, app.log);
        return reply.code(500).send({
          ok: false,
          error: 'nginx_update_failed',
          details: String((e as Error)?.message ?? e)
        });
      }

      const nextState: State = {
        desktops: [...st.desktops, record]
      };
      try {
        await saveState(nextState);
      } catch (e) {
        const cleanupIssues = await rollbackCreatedDesktop(
          record,
          snippetWritten,
          app.log
        );
        return reply.code(500).send({
          ok: false,
          error: 'state_persist_failed',
          details: String((e as Error)?.message ?? e),
          cleanupIssues
        });
      }

      const access = mintDesktopAccessUrl(record);

      return {
        id: record.id,
        display: record.display,
        novncUrl: record.novncUrl,
        aabUrl: record.aabUrl,
        terminal: terminalFor(record),
        cdp: { host: '127.0.0.1', port: record.cdpPort },
        status: record.status,
        routeAuth: record.routeAuth,
        ...(access
          ? {
              accessUrl: access.accessUrl,
              accessUrlExpiresAt: access.expiresAt
            }
          : {})
      };
    });
  });

  app.delete('/v1/desktops/:id', async (req, reply) => {
    const id = (req.params as { id: string }).id;

    return await withStateLock(async () => {
      const st = await loadState();
      const idx = st.desktops.findIndex((x) => x.id === id);
      if (idx === -1)
        return reply.code(404).send({ ok: false, error: 'not_found' });

      const d = st.desktops[idx];

      const stopRes = await stopUnits(d.display, app.log);
      const terminalStop = await killTmuxSession(d.terminalSessionName);

      let nginxIssue: string | undefined;
      try {
        await removeSnippet(id);
        const t = await nginxTest();
        if (!t.ok) {
          nginxIssue = t.stderr || t.stdout || 'nginx test failed';
        } else {
          const r = await nginxReload();
          if (!r.ok) nginxIssue = r.stderr || r.stdout || 'nginx reload failed';
        }
      } catch (e) {
        nginxIssue = String((e as Error)?.message ?? e);
        app.log.warn({ err: e }, 'nginx cleanup failed');
      }

      const nextState: State = {
        desktops: st.desktops.filter((_, desktopIndex) => desktopIndex !== idx)
      };
      try {
        await saveState(nextState);
      } catch (e) {
        const restoreIssues = await restoreDestroyedDesktop(d, app.log);
        return reply.code(500).send({
          ok: false,
          error: 'state_persist_failed',
          details: String((e as Error)?.message ?? e),
          warnings: {
            stopErrors: stopRes.errors,
            terminalIssue: terminalStop.ok ? undefined : terminalStop.error,
            nginxIssue,
            restoreIssues
          }
        });
      }

      return {
        ok: true,
        warnings: {
          stopErrors: stopRes.errors,
          terminalIssue: terminalStop.ok ? undefined : terminalStop.error,
          nginxIssue
        }
      };
    });
  });

  app.get('/v1/desktops/:id/doctor', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const st = await loadState();
    const d = st.desktops.find((x) => x.id === id);
    if (!d) return reply.code(404).send({ ok: false, error: 'not_found' });

    const uVnc = unitName(config.unitVnc, d.display);
    const uWs = unitName(config.unitWebsockify, d.display);
    const uChrome = unitName(config.unitChrome, d.display);
    const uAab = unitName(config.unitAab, d.display);

    const [
      aVnc,
      aWs,
      aChrome,
      aAab,
      tmuxSessionActive,
      vncPortOpen,
      wsPortOpen,
      cdpPortOpen,
      aabPortOpen
    ] = await Promise.all([
      systemctlIsActive(uVnc),
      systemctlIsActive(uWs),
      systemctlIsActive(uChrome),
      systemctlIsActive(uAab),
      isTmuxSessionActive(d.terminalSessionName),
      isPortOpen('127.0.0.1', d.vncPort),
      isPortOpen('127.0.0.1', d.wsPort),
      isPortOpen('127.0.0.1', d.cdpPort),
      isPortOpen('127.0.0.1', d.aabPort)
    ]);

    const snippetPath = snippetFilename(id);
    let snippetExists = false;
    try {
      await fs.access(snippetPath);
      snippetExists = true;
    } catch {
      // snippetExists remains false
    }

    const checks = {
      services: {
        vnc: aVnc.code === 0,
        websockify: aWs.code === 0,
        chrome: aChrome.code === 0,
        aab: aAab.code === 0
      },
      terminal: {
        tmuxSession: tmuxSessionActive
      },
      ports: {
        vnc: vncPortOpen,
        websockify: wsPortOpen,
        cdp: cdpPortOpen,
        aab: aabPortOpen
      },
      nginx: {
        snippetExists,
        protected: d.routeAuth.mode !== 'none'
      }
    };

    return {
      ok:
        checks.services.vnc &&
        checks.services.websockify &&
        checks.services.chrome &&
        checks.services.aab &&
        checks.terminal.tmuxSession &&
        checks.ports.vnc &&
        checks.ports.websockify &&
        checks.ports.cdp &&
        checks.ports.aab &&
        checks.nginx.snippetExists,
      desktop: d,
      routeAuth: d.routeAuth,
      checks,
      systemd: {
        vnc: {
          unit: uVnc,
          code: aVnc.code,
          status: aVnc.stdout.trim() || aVnc.stderr.trim()
        },
        websockify: {
          unit: uWs,
          code: aWs.code,
          status: aWs.stdout.trim() || aWs.stderr.trim()
        },
        chrome: {
          unit: uChrome,
          code: aChrome.code,
          status: aChrome.stdout.trim() || aChrome.stderr.trim()
        },
        aab: {
          unit: uAab,
          code: aAab.code,
          status: aAab.stdout.trim() || aAab.stderr.trim()
        }
      },
      nginx: {
        snippetPath,
        snippetExists
      },
      links: {
        novncUrl: d.novncUrl,
        aabUrl: d.aabUrl,
        terminalWebsocketUrl: d.terminalWebsocketUrl
      }
    };
  });

  return app;
}

export async function startServer() {
  await fs.mkdir(config.nginxSnippetDir, { recursive: true });
  await fs.mkdir(getStateDir(), { recursive: true });
  await fs.mkdir(config.workspaceRootDir, { recursive: true });
  await writeGlobalSnippet();
  await fs.access(config.nginxBin, fsConstants.X_OK);
  await fs.access(config.systemctlBin, fsConstants.X_OK);
  await fs.access(config.tmuxBin, fsConstants.X_OK);
  await fs.access(config.scriptBin, fsConstants.X_OK);

  const app = buildApp();
  await restoreRunningDesktops(app);
  if (config.ttlSweepIntervalMs > 0) {
    const timer = setInterval(() => {
      void sweepExpiredDesktops(app);
    }, config.ttlSweepIntervalMs);
    timer.unref();
    app.addHook('onClose', async () => {
      clearInterval(timer);
    });
  }
  await app.listen({ host: config.host, port: config.port });
  app.log.info(
    { host: config.host, port: config.port },
    'ai-agent-desktop-manager started'
  );
  return app;
}

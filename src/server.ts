import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import lockfile from 'proper-lockfile';
import path from 'node:path';
import fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import crypto from 'node:crypto';

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

function novncRelativeUrlFor(display: number) {
  const prefix = config.novncPathPrefix.replace(/\/$/, '');
  const params = new URLSearchParams({
    path: `${prefix.replace(/^\//, '')}/${display}/websockify`,
    resize: 'remote',
    autoconnect: '1'
  });
  return `${prefix}/${display}/vnc.html?${params.toString()}`;
}

function desktopAccessPathFor(display: number) {
  const prefix = config.novncPathPrefix.replace(/\/$/, '');
  return `${prefix}/${display}/access`;
}

function aabUrlFor(port: number) {
  return `http://127.0.0.1:${port}`;
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
  desktop: Pick<DesktopRecord, 'id' | 'display'>,
  snippetWritten: boolean,
  log: { warn: (obj: unknown, msg: string) => void }
) {
  const issues: string[] = [];
  if (snippetWritten) {
    issues.push(...(await removeSnippetAndReload(desktop.id, log)));
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

export function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({
    logger: buildLoggerOptions(options.loggerStream) as never,
    genReqId,
    requestIdHeader: 'x-request-id',
    disableRequestLogging: false
  }) as unknown as FastifyInstance;
  app.addHook('preHandler', authHook);
  app.addHook('onRequest', async (req, reply) => {
    attachRequestIdHeader(reply, req.log, req.id);
  });

  app.get('/health', async () => {
    return {
      ok: true,
      version: appVersion,
      uptimeSec: Math.floor(process.uptime())
    };
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
    return reply.redirect(novncRelativeUrlFor(d.display));
  });

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
            nginxIssue,
            restoreIssues
          }
        });
      }

      return {
        ok: true,
        warnings: {
          stopErrors: stopRes.errors,
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
      vncPortOpen,
      wsPortOpen,
      cdpPortOpen,
      aabPortOpen
    ] = await Promise.all([
      systemctlIsActive(uVnc),
      systemctlIsActive(uWs),
      systemctlIsActive(uChrome),
      systemctlIsActive(uAab),
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
        aabUrl: d.aabUrl
      }
    };
  });

  return app;
}

export async function startServer() {
  await fs.mkdir(config.nginxSnippetDir, { recursive: true });
  await fs.mkdir(getStateDir(), { recursive: true });
  await fs.access(config.nginxBin, fsConstants.X_OK);
  await fs.access(config.systemctlBin, fsConstants.X_OK);

  const app = buildApp();
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

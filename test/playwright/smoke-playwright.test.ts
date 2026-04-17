/**
 * Playwright smoke test — runs against a live EC2 smoke environment.
 * Invoke via:   ./scripts/smoke-playwright.sh --test
 *
 * The script sets up SSH port-forwards, a mock auth_request verifier, and
 * exports the env vars consumed here before launching this file.
 *
 * TODO: add ai-agent-browser (AAB) health and screenshot assertions once
 *       the AAB HTTP API surface is stabilised.
 */

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import type { BrowserContext, Page } from 'playwright-core';
import { maybeEnterPassword } from '../../smoke/browser-smoke.mjs';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const SKIP = !process.env.SMOKE_PLAYWRIGHT;
const SKIP_REASON =
  'set SMOKE_PLAYWRIGHT=true — run via scripts/smoke-playwright.sh --test';

const MANAGER_URL = process.env.SMOKE_MANAGER_URL ?? 'http://127.0.0.1:8899';
const MOCK_VERIFIER_URL = process.env.SMOKE_MOCK_VERIFIER_URL ?? '';
const PUBLIC_BASE_URL = (process.env.SMOKE_PUBLIC_BASE_URL ?? '').replace(
  /\/$/,
  ''
);
const SMOKE_SUMMARY_PATH = process.env.SMOKE_SUMMARY_PATH ?? '';
const SMOKE_ACCESS_URL = process.env.SMOKE_ACCESS_URL ?? '';
const VNC_PASSWORD = process.env.SMOKE_VNC_PASSWORD ?? 'SmokePassw0rd!';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function api(
  method: string,
  path: string,
  body?: Record<string, unknown>
): Promise<Response> {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { 'content-type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  return fetch(`${MANAGER_URL}${path}`, init);
}

async function waitForDoctor(
  id: string,
  retries = 20,
  delayMs = 3000
): Promise<Record<string, unknown>> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await api('GET', `/v1/desktops/${id}/doctor`);
      if (res.ok) {
        const doc = (await res.json()) as Record<string, unknown>;
        if (doc.ok) return doc;
      }
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(
    `doctor check did not return ok for ${id} after ${retries} retries`
  );
}

async function withBrowser<T>(
  fn: (ctx: BrowserContext) => Promise<T>
): Promise<T> {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const ctx = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 900 }
  });
  try {
    return await fn(ctx);
  } finally {
    await ctx.close();
    await browser.close();
  }
}

async function desktopFrame(page: Page) {
  const frameHandle = await page
    .waitForSelector('iframe[data-aadm-desktop-frame]', {
      timeout: 5000,
      state: 'attached'
    })
    .catch(() => null);

  return (await frameHandle?.contentFrame()) ?? null;
}

async function canvasDimensions(page: Page) {
  const frame = await desktopFrame(page);
  const target = frame ?? page;
  return await target.evaluate(() => {
    const c = document.querySelector('canvas');
    return c ? { w: c.width, h: c.height } : null;
  });
}

async function expectTerminalReady(page: Page) {
  // Use state:'attached' because these mounts are inside hidden tab panels
  // in the 3-tab layout and are not visible until the Terminal tab is active.
  await page.waitForSelector('#terminal-mount', { state: 'attached' });
  await page.waitForSelector('#agent-terminal-mount', { state: 'attached' });
  await page.waitForFunction(
    () => {
      const status = document.querySelector('#terminal-status');
      if (!(status instanceof HTMLElement)) return false;
      const text = status.textContent ?? '';
      return (
        !/failed to load|connection failed|closed/i.test(text) &&
        /attached to tmux session|connected to tmux session/i.test(text) &&
        Boolean(document.querySelector('#terminal-mount .xterm')) &&
        Boolean(document.querySelector('#agent-terminal-mount .xterm'))
      );
    },
    undefined,
    { timeout: 30000 }
  );
}

async function loadSmokeSummary(): Promise<Record<string, unknown> | null> {
  if (!SMOKE_SUMMARY_PATH) return null;

  try {
    const raw = await fs.readFile(SMOKE_SUMMARY_PATH, 'utf8');
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Created desktop IDs — cleaned up by after() hook on any test failure
// ---------------------------------------------------------------------------

const createdIds: string[] = [];

function trackId(id: string) {
  createdIds.push(id);
}

function untrackId(id: string) {
  const idx = createdIds.indexOf(id);
  if (idx !== -1) createdIds.splice(idx, 1);
}

after(async () => {
  for (const id of [...createdIds]) {
    try {
      await api('DELETE', `/v1/desktops/${id}`);
    } catch {
      // best-effort cleanup
    }
  }
});

// ---------------------------------------------------------------------------
// Pre-flight: verify env is usable before spending time on browser tests
// ---------------------------------------------------------------------------

before(async () => {
  if (SKIP) return;
  const res = await api('GET', '/health').catch(() => null);
  if (!res?.ok) {
    throw new Error(
      `manager at ${MANAGER_URL} is not healthy — check SSH tunnel (SMOKE_MANAGER_URL)`
    );
  }
  if (!PUBLIC_BASE_URL) {
    throw new Error(
      'SMOKE_PUBLIC_BASE_URL is required for browser tests — set via smoke-playwright.sh --test'
    );
  }
});

test(
  'smoke host keeps role noVNC on :1 and seeds managed desktop as desk-2',
  { skip: SKIP ? SKIP_REASON : false, timeout: 180_000 },
  async () => {
    const summary = await loadSmokeSummary();
    assert.ok(summary, 'smoke summary is available');

    const created = summary.create as
      | { id?: string; display?: number; routeAuth?: { mode?: string } }
      | undefined;
    assert.equal(created?.id, 'desk-2');
    assert.equal(created?.display, 2);
    assert.equal(created?.routeAuth?.mode, 'token');

    const accessUrl = String(summary.accessUrl ?? '');
    assert.match(
      accessUrl,
      /^https:\/\/.+\/desktop\/2\/access\?token=/,
      'summary access URL points at managed desktop 2'
    );

    await withBrowser(async (ctx) => {
      const page = await ctx.newPage();
      await page.goto(
        `${PUBLIC_BASE_URL}/vnc.html?autoconnect=1&resize=remote`,
        {
          waitUntil: 'domcontentloaded',
          timeout: 30_000
        }
      );

      await maybeEnterPassword(page, VNC_PASSWORD);

      const dims = await page.evaluate(() => {
        const c = document.querySelector('canvas');
        return c ? { w: c.width, h: c.height } : null;
      });
      assert.ok(
        dims && dims.w > 0 && dims.h > 0,
        `root noVNC desktop rendered ${JSON.stringify(dims)}`
      );
    });
  }
);

// ---------------------------------------------------------------------------
// 1. Health endpoint
// ---------------------------------------------------------------------------

test(
  'GET /health returns ok with version and uptime',
  { skip: SKIP ? SKIP_REASON : false },
  async () => {
    const res = await api('GET', '/health');
    assert.equal(res.status, 200, '/health status');
    const body = (await res.json()) as {
      ok: boolean;
      version: string;
      uptimeSec: number;
    };
    assert.equal(body.ok, true);
    assert.equal(typeof body.version, 'string');
    assert.ok(body.version.length > 0, 'version non-empty');
    assert.ok(
      Number.isFinite(body.uptimeSec) && body.uptimeSec >= 0,
      'uptimeSec >= 0'
    );
  }
);

// ---------------------------------------------------------------------------
// 2. List endpoint
// ---------------------------------------------------------------------------

test(
  'GET /v1/desktops returns desktops array',
  { skip: SKIP ? SKIP_REASON : false },
  async () => {
    const res = await api('GET', '/v1/desktops');
    assert.equal(res.status, 200);
    const body = (await res.json()) as { desktops: unknown[] };
    assert.ok(Array.isArray(body.desktops), 'desktops is an array');
  }
);

// ---------------------------------------------------------------------------
// 3. 404 on nonexistent desktop
// ---------------------------------------------------------------------------

test(
  'GET /v1/desktops/:id → 404 for unknown id',
  { skip: SKIP ? SKIP_REASON : false },
  async () => {
    const res = await api('GET', '/v1/desktops/desk-does-not-exist-99');
    assert.equal(res.status, 404);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, 'not_found');
  }
);

// ---------------------------------------------------------------------------
// 4. No-auth desktop: full lifecycle
// ---------------------------------------------------------------------------

test(
  'no-auth desktop lifecycle (create / get / doctor / access-url error / delete)',
  { skip: SKIP ? SKIP_REASON : false, timeout: 120_000 },
  async (t) => {
    // --- create ---
    const createRes = await api('POST', '/v1/desktops', {
      owner: 'smoke-test',
      label: 'no-auth',
      ttlMinutes: 30,
      startUrl: 'https://example.com',
      routeAuthMode: 'none'
    });
    assert.equal(createRes.status, 200, 'create status');
    const desktop = (await createRes.json()) as {
      id: string;
      display: number;
      status: string;
      novncUrl: string;
      aabUrl: string;
      cdp: { host: string; port: number };
      routeAuth: { mode: string };
      accessUrl?: string;
    };
    assert.ok(desktop.id, 'id present');
    assert.ok(desktop.display >= 1, 'display allocated');
    assert.equal(desktop.status, 'running');
    assert.equal(desktop.routeAuth.mode, 'none');
    assert.ok(desktop.novncUrl, 'novncUrl present');
    assert.ok(desktop.aabUrl, 'aabUrl present');
    assert.ok(desktop.cdp?.port, 'cdp port present');
    assert.equal(desktop.accessUrl, undefined, 'no accessUrl for mode:none');
    trackId(desktop.id);

    // --- GET /v1/desktops/:id ---
    await t.test('GET by id returns correct record', async () => {
      const res = await api('GET', `/v1/desktops/${desktop.id}`);
      assert.equal(res.status, 200);
      const got = (await res.json()) as {
        id: string;
        owner: string;
        label: string;
      };
      assert.equal(got.id, desktop.id);
      assert.equal(got.owner, 'smoke-test');
      assert.equal(got.label, 'no-auth');
    });

    // --- doctor ---
    await t.test('doctor reports all green and unprotected', async () => {
      const doc = await waitForDoctor(desktop.id);
      const checks = doc.checks as {
        services: Record<string, boolean>;
        ports: Record<string, boolean>;
        nginx: { snippetExists: boolean; protected: boolean };
      };
      assert.equal(checks.services.vnc, true, 'vnc service');
      assert.equal(checks.services.websockify, true, 'websockify service');
      assert.equal(checks.services.chrome, true, 'chrome service');
      assert.equal(checks.services.aab, true, 'aab service');
      assert.equal(checks.ports.vnc, true, 'vnc port');
      assert.equal(checks.ports.websockify, true, 'websockify port');
      assert.equal(checks.ports.cdp, true, 'cdp port');
      assert.equal(checks.ports.aab, true, 'aab port');
      assert.equal(checks.nginx.snippetExists, true, 'nginx snippet exists');
      assert.equal(checks.nginx.protected, false, 'route is not protected');
    });

    // --- access-url on non-token desktop → 400 ---
    await t.test(
      'POST /access-url returns 400 for mode:none desktop',
      async () => {
        const res = await api(
          'POST',
          `/v1/desktops/${desktop.id}/access-url`,
          {}
        );
        assert.equal(res.status, 400);
        const body = (await res.json()) as { error: string };
        assert.equal(body.error, 'route_auth_mode_not_supported');
      }
    );

    // --- delete ---
    await t.test(
      'DELETE removes desktop; subsequent GET returns 404',
      async () => {
        const delRes = await api('DELETE', `/v1/desktops/${desktop.id}`);
        assert.equal(delRes.status, 200);
        const del = (await delRes.json()) as { ok: boolean };
        assert.equal(del.ok, true);

        const getRes = await api('GET', `/v1/desktops/${desktop.id}`);
        assert.equal(getRes.status, 404);
        untrackId(desktop.id);
      }
    );
  }
);

// ---------------------------------------------------------------------------
// 5. Token desktop: full lifecycle + browser
// ---------------------------------------------------------------------------

test(
  'token desktop lifecycle (create / doctor / access-url / browser canvas / blocked / delete)',
  { skip: SKIP ? SKIP_REASON : false, timeout: 360_000 },
  async (t) => {
    // --- create ---
    const createRes = await api('POST', '/v1/desktops', {
      owner: 'smoke-test',
      label: 'token-auth',
      ttlMinutes: 30,
      startUrl: 'https://example.com',
      routeAuthMode: 'token'
    });
    assert.equal(createRes.status, 200, 'create status');
    const desktop = (await createRes.json()) as {
      id: string;
      display: number;
      novncUrl: string;
      routeAuth: { mode: string; token: { ttlSeconds: number } };
      accessUrl: string;
      accessUrlExpiresAt: number;
    };
    assert.equal(desktop.routeAuth.mode, 'token');
    assert.ok(desktop.accessUrl, 'accessUrl present on create');
    assert.ok(
      desktop.accessUrlExpiresAt > Date.now(),
      'accessUrl not yet expired'
    );
    trackId(desktop.id);

    // --- doctor ---
    await t.test('doctor reports all green and protected', async () => {
      const doc = await waitForDoctor(desktop.id);
      const checks = doc.checks as {
        services: Record<string, boolean>;
        ports: Record<string, boolean>;
        nginx: { snippetExists: boolean; protected: boolean };
      };
      assert.equal(checks.services.vnc, true);
      assert.equal(checks.services.websockify, true);
      assert.equal(checks.services.chrome, true);
      assert.equal(checks.services.aab, true);
      assert.equal(checks.ports.vnc, true);
      assert.equal(checks.ports.websockify, true);
      assert.equal(checks.ports.cdp, true);
      assert.equal(checks.ports.aab, true);
      assert.equal(checks.nginx.snippetExists, true);
      assert.equal(checks.nginx.protected, true, 'token route is protected');
    });

    // --- access-url endpoint ---
    await t.test('POST /access-url returns fresh token URL', async () => {
      const res = await api(
        'POST',
        `/v1/desktops/${desktop.id}/access-url`,
        {}
      );
      assert.equal(res.status, 200);
      const body = (await res.json()) as {
        accessUrl: string;
        expiresAt: number;
        routeAuth: { mode: string };
      };
      assert.ok(body.accessUrl.includes('/access?token='), 'accessUrl shape');
      assert.ok(body.expiresAt > Date.now(), 'expiresAt in future');
      assert.equal(body.routeAuth.mode, 'token');
    });

    await t.test(
      'POST /access-url rejects ttlSeconds exceeding server max',
      async () => {
        // Must be > server TTL config (default 900s) but within Zod schema max (86400)
        const res = await api('POST', `/v1/desktops/${desktop.id}/access-url`, {
          ttlSeconds: 1800
        });
        assert.equal(res.status, 400);
        const body = (await res.json()) as { error: string };
        assert.equal(body.error, 'ttl_seconds_too_large');
      }
    );

    // --- browser: token flow → canvas ---
    await t.test(
      'browser: accessUrl loads shell and embedded canvas renders',
      { timeout: 180_000 },
      async () => {
        const freshRes = await api(
          'POST',
          `/v1/desktops/${desktop.id}/access-url`,
          {}
        );
        const { accessUrl } = (await freshRes.json()) as { accessUrl: string };

        await withBrowser(async (ctx) => {
          const page = await ctx.newPage();
          await page.goto(accessUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 30_000
          });

          assert.ok(
            page.url().includes(`/desktop/${desktop.display}/`),
            `expected redirect to shell route, got ${page.url()}`
          );
          // These elements are in hidden tab panels — use state:'attached'
          await page.waitForSelector('iframe[data-aadm-desktop-frame]', {
            state: 'attached'
          });
          await page.waitForSelector('#terminal-mount', { state: 'attached' });
          await expectTerminalReady(page);

          // Cookie must be set with the correct path
          const cookies = await ctx.cookies();
          const accessCookie = cookies.find((c) =>
            c.name.startsWith('aadm_desktop_access_')
          );
          assert.ok(accessCookie, 'aadm_desktop_access cookie present');
          assert.ok(
            accessCookie!.path.startsWith(`/desktop/${desktop.display}/`),
            `cookie path should start with /desktop/${desktop.display}/`
          );

          // Switch to noVNC tab so the iframe is visible before checking canvas
          await page.click('[data-tab-btn="novnc"]', { force: true });
          await maybeEnterPassword(page, VNC_PASSWORD);

          const dims = await canvasDimensions(page);
          assert.ok(
            dims && dims.w > 0 && dims.h > 0,
            `canvas rendered ${JSON.stringify(dims)}`
          );
        });
      }
    );

    // --- browser: direct noVNC access without cookie → 401 ---
    await t.test(
      'browser: direct access without cookie returns 401',
      { timeout: 30_000 },
      async () => {
        const novncUrl = `${PUBLIC_BASE_URL}/desktop/${desktop.display}/vnc.html?path=desktop/${desktop.display}/websockify&resize=remote&autoconnect=1`;
        await withBrowser(async (ctx) => {
          const page = await ctx.newPage();
          const response = await page.goto(novncUrl, {
            waitUntil: 'commit',
            timeout: 30_000
          });
          assert.equal(
            response?.status(),
            401,
            'unauthenticated request returns 401'
          );
        });
      }
    );

    // --- delete ---
    await t.test(
      'DELETE removes desktop; subsequent GET returns 404',
      async () => {
        const delRes = await api('DELETE', `/v1/desktops/${desktop.id}`);
        assert.equal(delRes.status, 200);
        const del = (await delRes.json()) as { ok: boolean };
        assert.equal(del.ok, true);

        const getRes = await api('GET', `/v1/desktops/${desktop.id}`);
        assert.equal(getRes.status, 404);
        untrackId(desktop.id);
      }
    );
  }
);

// ---------------------------------------------------------------------------
// 6. Existing summary desktop: token access URL flow
//    Verifies the desktop provisioned by ec2-smoke-test.sh is still reachable.
//    Skipped if no fresh access URL was minted by the smoke script.
// ---------------------------------------------------------------------------

test(
  'summary desktop: fresh access URL loads canvas',
  {
    skip:
      SKIP || !SMOKE_ACCESS_URL
        ? SKIP
          ? SKIP_REASON
          : 'no SMOKE_ACCESS_URL — summary desktop may have been destroyed'
        : false,
    timeout: 180_000
  },
  async () => {
    await withBrowser(async (ctx) => {
      const page = await ctx.newPage();
      await page.goto(SMOKE_ACCESS_URL, {
        waitUntil: 'domcontentloaded',
        timeout: 30_000
      });

      assert.ok(
        page.url().includes('/desktop/2/'),
        `expected shell route, got ${page.url()}`
      );
      // These elements are in hidden tab panels — use state:'attached'
      await page.waitForSelector('iframe[data-aadm-desktop-frame]', {
        state: 'attached'
      });
      await page.waitForSelector('#terminal-mount', { state: 'attached' });
      await expectTerminalReady(page);

      // Switch to noVNC tab so the iframe is visible before checking canvas
      await page.click('[data-tab-btn="novnc"]', { force: true });
      await maybeEnterPassword(page, VNC_PASSWORD);

      const dims = await canvasDimensions(page);
      assert.ok(
        dims && dims.w > 0 && dims.h > 0,
        `canvas rendered ${JSON.stringify(dims)}`
      );
    });
  }
);

// ---------------------------------------------------------------------------
// 7. auth_request desktop: full lifecycle + browser allow/deny
// ---------------------------------------------------------------------------

test(
  'auth_request desktop lifecycle (create / doctor / browser allow / browser deny / delete)',
  {
    skip:
      SKIP || !MOCK_VERIFIER_URL
        ? SKIP
          ? SKIP_REASON
          : 'SMOKE_MOCK_VERIFIER_URL not set — skipping auth_request tests'
        : false,
    timeout: 360_000
  },
  async (t) => {
    // --- create ---
    const createRes = await api('POST', '/v1/desktops', {
      owner: 'smoke-test',
      label: 'auth-request',
      ttlMinutes: 30,
      routeAuthMode: 'auth_request'
    });
    assert.equal(
      createRes.status,
      200,
      'create status — AADM_DESKTOP_ROUTE_AUTH_REQUEST_URL must be set on server'
    );
    const desktop = (await createRes.json()) as {
      id: string;
      display: number;
      routeAuth: { mode: string; authRequest: { url: string } };
    };
    assert.equal(desktop.routeAuth.mode, 'auth_request');
    assert.ok(desktop.routeAuth.authRequest.url, 'authRequest.url present');
    trackId(desktop.id);

    // --- doctor ---
    await t.test('doctor reports all green and protected', async () => {
      const doc = await waitForDoctor(desktop.id);
      const checks = doc.checks as {
        services: Record<string, boolean>;
        nginx: { snippetExists: boolean; protected: boolean };
      };
      assert.equal(checks.services.vnc, true);
      assert.equal(checks.services.websockify, true);
      assert.equal(checks.nginx.snippetExists, true);
      assert.equal(
        checks.nginx.protected,
        true,
        'auth_request route is protected'
      );
    });

    // --- browser: verifier allows → canvas renders ---
    await t.test(
      'browser: mock verifier allows → noVNC canvas renders',
      { timeout: 180_000 },
      async () => {
        // Set mock to allow
        await fetch(`${MOCK_VERIFIER_URL}/allow`, { method: 'POST' });

        // Navigate directly to vnc.html with autoconnect=1 so noVNC sees the param
        // (navigating to /desktop/N/ would proxy vnc.html content but the browser URL
        // would not carry ?autoconnect=1, causing noVNC to show a connect dialog)
        const prefix = `/desktop/${desktop.display}`;
        const entryUrl = `${PUBLIC_BASE_URL}${prefix}/vnc.html?path=${prefix.replace(/^\//, '')}/websockify&resize=remote&autoconnect=1`;
        await withBrowser(async (ctx) => {
          const page = await ctx.newPage();
          await page.goto(entryUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 30_000
          });

          await maybeEnterPassword(page, VNC_PASSWORD);

          const dims = await page.evaluate(() => {
            const c = document.querySelector('canvas');
            return c ? { w: c.width, h: c.height } : null;
          });
          assert.ok(
            dims && dims.w > 0 && dims.h > 0,
            `canvas rendered ${JSON.stringify(dims)}`
          );
        });
      }
    );

    // --- browser: verifier denies → 401 ---
    await t.test(
      'browser: mock verifier denies → 401',
      { timeout: 30_000 },
      async () => {
        // Set mock to deny
        await fetch(`${MOCK_VERIFIER_URL}/deny`, { method: 'POST' });

        const prefix = `/desktop/${desktop.display}`;
        const entryUrl = `${PUBLIC_BASE_URL}${prefix}/vnc.html?path=${prefix.replace(/^\//, '')}/websockify&resize=remote&autoconnect=1`;
        await withBrowser(async (ctx) => {
          const page = await ctx.newPage();
          const response = await page.goto(entryUrl, {
            waitUntil: 'commit',
            timeout: 30_000
          });
          assert.equal(response?.status(), 401, 'denied request returns 401');
        });

        // Reset to allow so the next subtest isn't affected
        await fetch(`${MOCK_VERIFIER_URL}/allow`, { method: 'POST' });
      }
    );

    // --- access-url on auth_request desktop → 400 ---
    await t.test(
      'POST /access-url returns 400 for auth_request desktop',
      async () => {
        const res = await api(
          'POST',
          `/v1/desktops/${desktop.id}/access-url`,
          {}
        );
        assert.equal(res.status, 400);
        const body = (await res.json()) as { error: string };
        assert.equal(body.error, 'route_auth_mode_not_supported');
      }
    );

    // --- delete ---
    await t.test(
      'DELETE removes desktop; subsequent GET returns 404',
      async () => {
        const delRes = await api('DELETE', `/v1/desktops/${desktop.id}`);
        assert.equal(delRes.status, 200);
        const del = (await delRes.json()) as { ok: boolean };
        assert.equal(del.ok, true);

        const getRes = await api('GET', `/v1/desktops/${desktop.id}`);
        assert.equal(getRes.status, 404);
        untrackId(desktop.id);
      }
    );
  }
);

// ---------------------------------------------------------------------------
// 8. 3-tab layout: verify each panel loads correctly via access URL
// ---------------------------------------------------------------------------

test(
  'tab layout: AI Agent, Terminal (tmux), and noVNC panels each load correctly',
  {
    skip:
      SKIP || !SMOKE_ACCESS_URL
        ? SKIP
          ? SKIP_REASON
          : 'no SMOKE_ACCESS_URL — skipping tab layout test'
        : false,
    timeout: 360_000
  },
  async (t) => {
    await withBrowser(async (ctx) => {
      const page = await ctx.newPage();
      await page.goto(SMOKE_ACCESS_URL, {
        waitUntil: 'domcontentloaded',
        timeout: 30_000
      });

      // Confirm redirect to shell route
      assert.ok(
        page.url().includes('/desktop/2/'),
        `expected shell route, got ${page.url()}`
      );

      // Tab bar must be present with 3 tabs
      await page.waitForSelector('#aadm-tab-bar', { timeout: 10_000 });
      const tabCount = await page.evaluate(
        () => document.querySelectorAll('[data-tab-btn]').length
      );
      assert.equal(tabCount, 3, '3 tab buttons present');

      // ----- Tab 1: AI Agent (active by default) ----------------------------
      await t.test('AI Agent tab: provider and controls visible', async () => {
        await page.waitForSelector('#agent-status', { timeout: 15_000 });
        await page.waitForSelector('#agent-terminal-mount', {
          timeout: 15_000
        });

        const hasClaudeOption = await page.evaluate(() => {
          const select = document.querySelector('#agent-provider');
          if (!(select instanceof HTMLSelectElement)) return false;
          return Array.from(select.options).some((o) => o.value === 'claude');
        });
        assert.ok(hasClaudeOption, 'agent-provider has "claude" option');

        const hasControls = await page.evaluate(
          () =>
            Boolean(document.querySelector('#agent-start')) &&
            Boolean(document.querySelector('#agent-stop'))
        );
        assert.ok(hasControls, 'agent start/stop buttons present');
      });

      // ----- Tab 2: Terminal (tmux) -----------------------------------------
      await t.test(
        'Terminal tab: tmux attaches with at least 1 window',
        async () => {
          // Use force:true to bypass stability check — xterm initialization can
          // briefly cause layout shifts that make the tab bar "not stable".
          await page.click('[data-tab-btn="terminal"]', { force: true });
          await page.waitForSelector('#terminal-mount', { timeout: 15_000 });

          // Wait for tmux to attach AND confirm the session name in one function
          // so there is no race between the waitForFunction and a subsequent evaluate.
          await page.waitForFunction(
            () => {
              const status = document.querySelector('#terminal-status');
              if (!(status instanceof HTMLElement)) return false;
              const text = status.textContent ?? '';
              return (
                /attached to tmux session/i.test(text) &&
                /aadm-desk/i.test(text)
              );
            },
            undefined,
            { timeout: 60_000 }
          );

          // xterm rendered inside mount
          await page.waitForSelector('#terminal-mount .xterm', {
            timeout: 15_000
          });
        }
      );

      // ----- Tab 3: noVNC (Chrome desktop) ----------------------------------
      await t.test(
        'noVNC tab: iframe canvas renders Chrome desktop',
        async () => {
          await page.click('[data-tab-btn="novnc"]', { force: true });

          const frameHandle = await page.waitForSelector(
            'iframe[data-aadm-desktop-frame]',
            { state: 'attached', timeout: 15_000 }
          );
          const frame = await frameHandle.contentFrame();
          assert.ok(frame, 'contentFrame available');

          // Enter VNC password if needed and wait for canvas
          await maybeEnterPassword(page, VNC_PASSWORD);

          const dims = await canvasDimensions(page);
          assert.ok(
            dims && dims.w > 0 && dims.h > 0,
            `noVNC canvas rendered ${JSON.stringify(dims)}`
          );
        }
      );
    });
  }
);

// ---------------------------------------------------------------------------
// TODO items
// ---------------------------------------------------------------------------

test.todo(
  'aab: verify ai-agent-browser health, screenshot, and console-events endpoints for each desktop'
);

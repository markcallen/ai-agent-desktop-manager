import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import type { FastifyInstance } from 'fastify';

type ExecCall = { cmd: string; args: string[]; sudo: boolean };

let app: FastifyInstance;
let calls: ExecCall[] = [];
let failNginxTest = false;
let tmpRoot = '';
let saveFailuresRemaining = 0;
let loggerOutput = '';

const authHeaders = { authorization: 'Bearer test-token' };

async function importServerWithEnv() {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aadm-integration-'));
  const stateDir = path.join(tmpRoot, 'state');
  const nginxDir = path.join(tmpRoot, 'nginx');
  const loggerStream = new PassThrough();
  loggerOutput = '';
  loggerStream.setEncoding('utf8');
  loggerStream.on('data', (chunk) => {
    loggerOutput += chunk;
  });

  const execMod = await import('../../src/util/exec.ts');
  const configMod = await import('../../src/util/config.ts');
  const netMod = await import('../../src/util/net.ts');
  configMod.config.authToken = 'test-token';
  configMod.config.ttlSweepIntervalMs = 60_000;
  configMod.config.desktopRouteAuthMode = 'none';
  configMod.config.desktopRouteAuthRequestUrl = 'http://127.0.0.1:3001/verify';
  configMod.config.desktopRouteAuthRequestHeaders = [
    'x-auth-request-user',
    'x-orchestrator-token'
  ];
  configMod.config.desktopRouteTokenSecret = 'test-secret';
  configMod.config.desktopRouteTokenTtlSeconds = 900;
  configMod.config.allowedStartUrlDomains = [];
  configMod.config.stateDir = stateDir;
  configMod.config.workspaceRootDir = path.join(stateDir, 'workspaces');
  configMod.config.tmuxConfPath = path.join(stateDir, 'tmux.conf');
  configMod.config.nginxSnippetDir = nginxDir;
  configMod.config.publicBaseUrl = 'https://host.example.com';
  netMod.setPortChecker(async () => true);
  const storeMod = await import('../../src/util/store.ts');
  storeMod.setSaveStateHook(async (state, next) => {
    if (saveFailuresRemaining > 0) {
      saveFailuresRemaining -= 1;
      throw new Error('simulated state save failure');
    }
    await next(state);
  });

  execMod.setExecRunner(async (cmd, args, opts) => {
    calls.push({ cmd, args, sudo: Boolean(opts?.sudo) });

    if (cmd.endsWith('nginx') && args[0] === '-t') {
      if (failNginxTest)
        return { code: 1, stdout: '', stderr: 'invalid nginx config' };
      return { code: 0, stdout: 'ok', stderr: '' };
    }

    if (
      cmd.endsWith('systemctl') &&
      args[0] === 'reload' &&
      args[1] === 'nginx'
    ) {
      return { code: 0, stdout: '', stderr: '' };
    }

    if (cmd.endsWith('systemctl') && args[0] === 'is-active') {
      return { code: 0, stdout: 'active\n', stderr: '' };
    }

    if (
      cmd.endsWith('systemctl') &&
      (args[0] === 'start' || args[0] === 'stop')
    ) {
      return { code: 0, stdout: '', stderr: '' };
    }

    return { code: 0, stdout: '', stderr: '' };
  });

  const serverMod = await import('../../src/server.ts');
  app = serverMod.buildApp({ loggerStream });
  await app.ready();

  return { execMod, netMod, serverMod, configMod };
}

test.before(async () => {
  calls = [];
  failNginxTest = false;
  saveFailuresRemaining = 0;
  await importServerWithEnv();
});

test.after(async () => {
  if (app) await app.close();
  try {
    const execMod = await import('../../src/util/exec.ts');
    const netMod = await import('../../src/util/net.ts');
    const storeMod = await import('../../src/util/store.ts');
    execMod.resetExecRunner();
    netMod.resetPortChecker();
    storeMod.setSaveStateHook();
  } catch {
    // no-op cleanup
  }
  if (tmpRoot) {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});

test(
  'auth token is required when configured',
  { concurrency: false },
  async () => {
    assert.ok(app);
    const noAuth = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(noAuth.statusCode, 401);

    const withAuth = await app.inject({
      method: 'GET',
      url: '/health',
      headers: authHeaders
    });
    assert.equal(withAuth.statusCode, 200);

    const forwardedReqId = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { ...authHeaders, 'x-request-id': 'external-req-123' }
    });
    assert.equal(forwardedReqId.statusCode, 200);
    assert.equal(forwardedReqId.headers['x-request-id'], 'external-req-123');
  }
);

test(
  'create success persists state and doctor includes snippet/ports/services',
  { concurrency: false },
  async () => {
    assert.ok(app);
    calls = [];
    failNginxTest = false;

    const create = await app.inject({
      method: 'POST',
      url: '/v1/desktops',
      headers: { ...authHeaders, 'content-type': 'application/json' },
      payload: { owner: 'codex', label: 'test' }
    });
    assert.equal(create.statusCode, 200);
    const created = create.json();
    assert.equal(created.id, 'desk-1');
    assert.ok(create.headers['x-request-id']);
    assert.equal(
      created.novncUrl,
      'https://host.example.com/desktop/1/vnc.html?path=desktop%2F1%2Fwebsockify&resize=remote&autoconnect=1'
    );
    assert.deepEqual(created.terminal, {
      sessionName: 'aadm-desk-1',
      workspaceDir: path.join(stateDirFromTmpRoot(), 'workspaces', 'desk-1'),
      websocketPath: '/desktop/1/terminal/ws',
      websocketUrl: 'wss://host.example.com/desktop/1/terminal/ws'
    });

    const doctor = await app.inject({
      method: 'GET',
      url: '/v1/desktops/desk-1/doctor',
      headers: authHeaders
    });

    assert.equal(doctor.statusCode, 200);
    const body = doctor.json();
    assert.equal(body.ok, true);
    assert.equal(body.checks.nginx.snippetExists, true);
    assert.equal(body.checks.nginx.protected, false);
    assert.equal(body.checks.terminal.tmuxSession, true);
    assert.equal(body.checks.ports.vnc, true);
    assert.equal(body.checks.ports.websockify, true);
    assert.equal(body.checks.ports.cdp, true);
    assert.equal(body.checks.ports.aab, true);
    assert.deepEqual(body.routeAuth, { mode: 'none' });
  }
);

test(
  'terminal-access endpoint returns terminal metadata and token bootstrap details',
  { concurrency: false },
  async () => {
    assert.ok(app);

    const create = await app.inject({
      method: 'POST',
      url: '/v1/desktops',
      headers: { ...authHeaders, 'content-type': 'application/json' },
      payload: {
        owner: 'codex',
        label: 'terminal-token',
        routeAuthMode: 'token'
      }
    });
    assert.equal(create.statusCode, 200);

    const terminal = await app.inject({
      method: 'POST',
      url: '/v1/desktops/desk-2/terminal-access',
      headers: authHeaders
    });
    assert.equal(terminal.statusCode, 200);
    assert.deepEqual(terminal.json(), {
      id: 'desk-2',
      routeAuth: {
        mode: 'token',
        token: {
          ttlSeconds: 900
        }
      },
      terminal: {
        sessionName: 'aadm-desk-2',
        workspaceDir: path.join(stateDirFromTmpRoot(), 'workspaces', 'desk-2'),
        websocketPath: '/desktop/2/terminal/ws',
        websocketUrl: 'wss://host.example.com/desktop/2/terminal/ws'
      },
      accessUrl: terminal.json().accessUrl,
      accessUrlExpiresAt: terminal.json().accessUrlExpiresAt
    });
    assert.match(
      terminal.json().accessUrl,
      /^https:\/\/host\.example\.com\/desktop\/2\/access\?token=/
    );
    assert.equal(typeof terminal.json().accessUrlExpiresAt, 'number');
  }
);

test(
  'create with auth_request route protection persists metadata and doctor reports it',
  { concurrency: false },
  async () => {
    assert.ok(app);
    calls = [];

    const create = await app.inject({
      method: 'POST',
      url: '/v1/desktops',
      headers: { ...authHeaders, 'content-type': 'application/json' },
      payload: {
        owner: 'codex',
        label: 'protected',
        routeAuthMode: 'auth_request'
      }
    });
    assert.equal(create.statusCode, 200);
    assert.deepEqual(create.json().routeAuth, {
      mode: 'auth_request',
      authRequest: {
        url: 'http://127.0.0.1:3001/verify',
        forwardedHeaders: ['x-auth-request-user', 'x-orchestrator-token']
      }
    });

    const getDesktop = await app.inject({
      method: 'GET',
      url: '/v1/desktops/desk-3',
      headers: authHeaders
    });
    assert.equal(getDesktop.statusCode, 200);
    assert.equal(getDesktop.json().routeAuth.mode, 'auth_request');

    const doctor = await app.inject({
      method: 'GET',
      url: '/v1/desktops/desk-3/doctor',
      headers: authHeaders
    });
    assert.equal(doctor.statusCode, 200);
    assert.equal(doctor.json().checks.nginx.protected, true);
    assert.equal(doctor.json().routeAuth.mode, 'auth_request');

    const snippetPath = path.join(tmpRoot, 'nginx', 'desk-3.conf');
    const snippet = await fs.readFile(snippetPath, 'utf-8');
    assert.match(snippet, /auth_request \/_aadm\/auth\/desk-3;/);
    assert.match(snippet, /proxy_pass http:\/\/127\.0\.0\.1:3001\/verify;/);
  }
);

function stateDirFromTmpRoot() {
  return path.join(tmpRoot, 'state');
}

test(
  'create with token route protection returns a secure access url and verifier endpoints honor it',
  { concurrency: false },
  async () => {
    assert.ok(app);
    calls = [];

    const create = await app.inject({
      method: 'POST',
      url: '/v1/desktops',
      headers: { ...authHeaders, 'content-type': 'application/json' },
      payload: {
        owner: 'codex',
        label: 'token-protected',
        routeAuthMode: 'token'
      }
    });
    assert.equal(create.statusCode, 200);
    assert.deepEqual(create.json().routeAuth, {
      mode: 'token',
      token: {
        ttlSeconds: 900
      }
    });
    assert.match(
      create.json().accessUrl,
      /^https:\/\/host\.example\.com\/desktop\/4\/access\?token=/
    );

    const returnedAccessUrl = new URL(create.json().accessUrl);
    const access = await app.inject({
      method: 'GET',
      url: `/_aadm/access/desk-4${returnedAccessUrl.search}`
    });
    assert.equal(access.statusCode, 302);
    assert.equal(access.headers.location, '/desktop/4/');
    assert.match(access.headers['set-cookie'] ?? '', /HttpOnly/);
    assert.match(access.headers['set-cookie'] ?? '', /Secure/);

    const verifyDenied = await app.inject({
      method: 'GET',
      url: '/_aadm/verify/desk-4'
    });
    assert.equal(verifyDenied.statusCode, 401);

    const verifyAllowed = await app.inject({
      method: 'GET',
      url: '/_aadm/verify/desk-4',
      headers: {
        cookie: String(access.headers['set-cookie']).split(';')[0]
      }
    });
    assert.equal(verifyAllowed.statusCode, 204);

    const minted = await app.inject({
      method: 'POST',
      url: '/v1/desktops/desk-4/access-url',
      headers: { ...authHeaders, 'content-type': 'application/json' },
      payload: { ttlSeconds: 120 }
    });
    assert.equal(minted.statusCode, 200);
    assert.match(
      minted.json().accessUrl,
      /^https:\/\/host\.example\.com\/desktop\/4\/access\?token=/
    );

    const snippetPath = path.join(tmpRoot, 'nginx', 'desk-4.conf');
    const snippet = await fs.readFile(snippetPath, 'utf-8');
    assert.match(
      snippet,
      /proxy_pass http:\/\/127\.0\.0\.1:8899\/_aadm\/verify\/desk-4;/
    );
    assert.match(snippet, /location = \/desktop\/4\/access/);
  }
);

test(
  'desktop shell route returns terminal-enabled HTML for a managed desktop',
  { concurrency: false },
  async () => {
    assert.ok(app);

    const create = await app.inject({
      method: 'POST',
      url: '/v1/desktops',
      headers: { ...authHeaders, 'content-type': 'application/json' },
      payload: {
        owner: 'codex',
        label: 'shell',
        routeAuthMode: 'token'
      }
    });
    assert.equal(create.statusCode, 200);
    const created = create.json();

    const shell = await app.inject({
      method: 'GET',
      url: `/_aadm/desktop/${created.id}`
    });
    assert.equal(shell.statusCode, 200);
    assert.match(
      String(shell.headers['content-type']),
      /^text\/html; charset=utf-8/
    );
    assert.match(shell.body, /data-aadm-desktop-frame/);
    assert.match(shell.body, /\/_aadm\/assets\/xterm\.css/);
    assert.match(shell.body, /\/_aadm\/assets\/xterm\.js/);
    assert.match(shell.body, /\/_aadm\/assets\/addon-fit\.js/);
    assert.match(shell.body, /id="terminal-mount"/);
    assert.match(shell.body, /id="agent-terminal-mount"/);
    assert.match(shell.body, /AI Agent/);
    assert.match(
      shell.body,
      new RegExp(
        `/desktop/${created.display}/vnc\\.html\\?path=desktop/${created.display}/websockify`
      )
    );
    assert.match(
      shell.body,
      new RegExp(
        `wss://host\\.example\\.com/desktop/${created.display}/terminal/ws`
      )
    );
    assert.match(
      shell.body,
      new RegExp(
        `wss://host\\.example\\.com/desktop/${created.display}/bridge/ws`
      )
    );
    assert.match(shell.body, /Bridge not configured on this host\./);
    assert.doesNotMatch(shell.body, /cdn\.jsdelivr\.net/);
    assert.doesNotMatch(shell.body, /id="terminal-command"/);
    assert.doesNotMatch(shell.body, /id="terminal-output"/);
    assert.match(shell.body, /Attached to tmux session/);
  }
);

test(
  'desktop shell advertises bridge availability when ai-agent-bridge is configured',
  { concurrency: false },
  async () => {
    assert.ok(app);
    const configMod = await import('../../src/util/config.ts');
    const previousBridgeAddr = configMod.config.bridgeAddr;
    configMod.config.bridgeAddr = '127.0.0.1:9445';

    try {
      const create = await app.inject({
        method: 'POST',
        url: '/v1/desktops',
        headers: { ...authHeaders, 'content-type': 'application/json' },
        payload: {
          owner: 'codex',
          label: 'bridge-shell',
          routeAuthMode: 'token'
        }
      });
      assert.equal(create.statusCode, 200);
      const created = create.json();

      const shell = await app.inject({
        method: 'GET',
        url: `/_aadm/desktop/${created.id}`
      });
      assert.equal(shell.statusCode, 200);
      assert.match(
        shell.body,
        /Bridge available\. Start a session to attach the agent terminal\./
      );
      assert.match(shell.body, /id="agent-start"/);
      assert.match(shell.body, /id="agent-stop"/);
      assert.match(shell.body, /id="agent-provider"/);
      assert.match(shell.body, new RegExp(`"enabled":true`));
    } finally {
      configMod.config.bridgeAddr = previousBridgeAddr;
    }
  }
);

test(
  'create failure on nginx test rolls back units, snippet, and state record',
  { concurrency: false },
  async () => {
    assert.ok(app);
    calls = [];
    failNginxTest = true;

    const before = await app.inject({
      method: 'GET',
      url: '/v1/desktops',
      headers: authHeaders
    });
    assert.equal(before.statusCode, 200);
    const beforeDesktops = before.json().desktops;
    const failedDisplay = beforeDesktops.length + 1;

    const create = await app.inject({
      method: 'POST',
      url: '/v1/desktops',
      headers: { ...authHeaders, 'content-type': 'application/json' },
      payload: {
        owner: 'codex',
        label: 'rollback',
        routeAuthMode: 'auth_request'
      }
    });
    assert.equal(create.statusCode, 500);

    const list = await app.inject({
      method: 'GET',
      url: '/v1/desktops',
      headers: authHeaders
    });
    assert.equal(list.statusCode, 200);
    assert.equal(
      list.json().desktops.length,
      beforeDesktops.length,
      'failed create should not add a desktop record'
    );

    const snippetPath = path.join(
      tmpRoot,
      'nginx',
      `desk-${failedDisplay}.conf`
    );
    await assert.rejects(fs.access(snippetPath));

    const stopCalls = calls.filter(
      (c) => c.cmd.endsWith('systemctl') && c.args[0] === 'stop'
    );
    assert.ok(stopCalls.length >= 1);
  }
);

test(
  'create failure on state save rolls back units, snippet, and persisted record',
  { concurrency: false },
  async () => {
    assert.ok(app);
    calls = [];
    failNginxTest = false;
    saveFailuresRemaining = 1;

    const before = await app.inject({
      method: 'GET',
      url: '/v1/desktops',
      headers: authHeaders
    });
    assert.equal(before.statusCode, 200);
    const beforeDesktops = before.json().desktops;
    const failedDisplay = beforeDesktops.length + 1;

    const create = await app.inject({
      method: 'POST',
      url: '/v1/desktops',
      headers: { ...authHeaders, 'content-type': 'application/json' },
      payload: { owner: 'codex', label: 'save-fail' }
    });
    assert.equal(create.statusCode, 500);
    assert.equal(create.json().error, 'state_persist_failed');

    const list = await app.inject({
      method: 'GET',
      url: '/v1/desktops',
      headers: authHeaders
    });
    assert.equal(list.statusCode, 200);
    assert.equal(
      list.json().desktops.length,
      beforeDesktops.length,
      'state save failure should not add a partial desktop record'
    );

    const snippetPath = path.join(
      tmpRoot,
      'nginx',
      `desk-${failedDisplay}.conf`
    );
    await assert.rejects(fs.access(snippetPath));

    const stopCalls = calls.filter(
      (c) => c.cmd.endsWith('systemctl') && c.args[0] === 'stop'
    );
    assert.ok(stopCalls.length >= 1);
  }
);

test(
  'destroy failure on state save restores services and leaves persisted record intact',
  { concurrency: false },
  async () => {
    assert.ok(app);
    calls = [];
    saveFailuresRemaining = 1;

    const before = await app.inject({
      method: 'GET',
      url: '/v1/desktops',
      headers: authHeaders
    });
    assert.equal(before.statusCode, 200);
    const beforeDesktops = before.json().desktops;

    const destroy = await app.inject({
      method: 'DELETE',
      url: '/v1/desktops/desk-1',
      headers: authHeaders
    });
    assert.equal(destroy.statusCode, 500);
    assert.equal(destroy.json().error, 'state_persist_failed');

    const list = await app.inject({
      method: 'GET',
      url: '/v1/desktops',
      headers: authHeaders
    });
    assert.equal(list.statusCode, 200);
    assert.equal(
      list.json().desktops.length,
      beforeDesktops.length,
      'destroy save failure should preserve the persisted desktop record'
    );

    const snippetPath = path.join(tmpRoot, 'nginx', 'desk-1.conf');
    await fs.access(snippetPath);

    const stopCalls = calls.filter(
      (c) => c.cmd.endsWith('systemctl') && c.args[0] === 'stop'
    );
    const startCalls = calls.filter(
      (c) => c.cmd.endsWith('systemctl') && c.args[0] === 'start'
    );
    assert.ok(stopCalls.length >= 1);
    assert.ok(startCalls.length >= 4);
  }
);

test(
  'ttl sweep deletes only desktops whose expiresAt has elapsed',
  { concurrency: false },
  async () => {
    assert.ok(app);
    const serverMod = await import('../../src/server.ts');

    const before = await app.inject({
      method: 'GET',
      url: '/v1/desktops',
      headers: authHeaders
    });
    const beforeIds = before
      .json()
      .desktops.map((desktop: { id: string }) => desktop.id);

    const ttlCreate = await app.inject({
      method: 'POST',
      url: '/v1/desktops',
      headers: { ...authHeaders, 'content-type': 'application/json' },
      payload: { owner: 'codex', label: 'ttl', ttlMinutes: 1 }
    });
    assert.equal(ttlCreate.statusCode, 200);
    const ttlId = ttlCreate.json().id;

    const noTtlCreate = await app.inject({
      method: 'POST',
      url: '/v1/desktops',
      headers: { ...authHeaders, 'content-type': 'application/json' },
      payload: { owner: 'codex', label: 'no-ttl' }
    });
    assert.equal(noTtlCreate.statusCode, 200);
    const noTtlId = noTtlCreate.json().id;

    const sweep = await serverMod.sweepExpiredDesktops(
      app,
      Date.now() + 61_000
    );
    assert.deepEqual(sweep.deleted, [ttlId]);
    assert.deepEqual(sweep.failed, []);

    const after = await app.inject({
      method: 'GET',
      url: '/v1/desktops',
      headers: authHeaders
    });
    const afterIds = after
      .json()
      .desktops.map((desktop: { id: string }) => desktop.id);
    assert.deepEqual(
      afterIds,
      [...beforeIds, noTtlId],
      'only ttl-backed desktop should be removed by the sweep'
    );
  }
);

test(
  'startUrl allowlist rejects unapproved domains',
  { concurrency: false },
  async () => {
    assert.ok(app);
    const configMod = await import('../../src/util/config.ts');
    configMod.config.allowedStartUrlDomains = ['github.com'];

    const denied = await app.inject({
      method: 'POST',
      url: '/v1/desktops',
      headers: { ...authHeaders, 'content-type': 'application/json' },
      payload: {
        owner: 'codex',
        label: 'blocked',
        startUrl: 'https://example.com'
      }
    });
    assert.equal(denied.statusCode, 400);
    assert.equal(denied.json().error, 'start_url_not_allowed');

    const allowed = await app.inject({
      method: 'POST',
      url: '/v1/desktops',
      headers: { ...authHeaders, 'content-type': 'application/json' },
      payload: {
        owner: 'codex',
        label: 'allowed',
        startUrl: 'https://gist.github.com/mark'
      }
    });
    assert.equal(allowed.statusCode, 200);

    configMod.config.allowedStartUrlDomains = [];
  }
);

test(
  'create rejects port collisions discovered via ss',
  { concurrency: false },
  async () => {
    assert.ok(app);
    calls = [];
    const before = await app.inject({
      method: 'GET',
      url: '/v1/desktops',
      headers: authHeaders
    });
    const nextDisplay = before.json().desktops.length + 1;
    const nextVncPort = 5900 + nextDisplay;

    const execMod = await import('../../src/util/exec.ts');
    execMod.setExecRunner(async (cmd, args, opts) => {
      calls.push({ cmd, args, sudo: Boolean(opts?.sudo) });

      if (cmd === 'ss' && args[0] === '-lntH') {
        return {
          code: 0,
          stdout: `LISTEN 0 128 127.0.0.1:${nextVncPort} 0.0.0.0:*\n`,
          stderr: ''
        };
      }

      if (cmd.endsWith('systemctl') && args[0] === 'is-active') {
        return { code: 0, stdout: 'active\n', stderr: '' };
      }

      return { code: 0, stdout: '', stderr: '' };
    });

    const create = await app.inject({
      method: 'POST',
      url: '/v1/desktops',
      headers: { ...authHeaders, 'content-type': 'application/json' },
      payload: { owner: 'codex', label: 'collision' }
    });
    assert.equal(create.statusCode, 409);
    assert.equal(create.json().error, 'ports_unavailable');
    assert.deepEqual(create.json().ports, [nextVncPort]);
  }
);

test(
  'request logging redacts token query params and sensitive headers',
  { concurrency: false },
  async () => {
    assert.ok(app);

    const response = await app.inject({
      method: 'GET',
      url: '/_aadm/access/desk-1?token=top-secret',
      headers: { authorization: 'Bearer super-secret' }
    });

    assert.equal(response.statusCode, 404);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.match(
      loggerOutput,
      /"url":"\/_aadm\/access\/desk-1\?token=%5BREDACTED%5D"/
    );
    assert.doesNotMatch(loggerOutput, /top-secret/);
    assert.doesNotMatch(loggerOutput, /super-secret/);
  }
);

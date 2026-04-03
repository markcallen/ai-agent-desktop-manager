import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';

type ExecCall = { cmd: string; args: string[]; sudo: boolean };

let app: FastifyInstance;
let calls: ExecCall[] = [];
let failNginxTest = false;
let tmpRoot = '';
let saveFailuresRemaining = 0;

const authHeaders = { authorization: 'Bearer test-token' };

async function importServerWithEnv() {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aadm-integration-'));
  const stateDir = path.join(tmpRoot, 'state');
  const nginxDir = path.join(tmpRoot, 'nginx');

  const execMod = await import('../../src/util/exec.ts');
  const configMod = await import('../../src/util/config.ts');
  const netMod = await import('../../src/util/net.ts');
  configMod.config.authToken = 'test-token';
  configMod.config.desktopRouteAuthMode = 'none';
  configMod.config.desktopRouteAuthRequestUrl = 'http://127.0.0.1:3001/verify';
  configMod.config.desktopRouteAuthRequestHeaders = [
    'x-auth-request-user',
    'x-orchestrator-token'
  ];
  configMod.config.stateDir = stateDir;
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
  app = serverMod.buildApp();
  await app.ready();

  return { execMod, netMod };
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
    assert.equal(
      created.novncUrl,
      'https://host.example.com/desktop/1/vnc.html?path=desktop%2F1%2Fwebsockify&resize=remote&autoconnect=1'
    );

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
    assert.equal(body.checks.ports.vnc, true);
    assert.equal(body.checks.ports.websockify, true);
    assert.equal(body.checks.ports.cdp, true);
    assert.equal(body.checks.ports.aab, true);
    assert.deepEqual(body.routeAuth, { mode: 'none' });
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
      url: '/v1/desktops/desk-2',
      headers: authHeaders
    });
    assert.equal(getDesktop.statusCode, 200);
    assert.equal(getDesktop.json().routeAuth.mode, 'auth_request');

    const doctor = await app.inject({
      method: 'GET',
      url: '/v1/desktops/desk-2/doctor',
      headers: authHeaders
    });
    assert.equal(doctor.statusCode, 200);
    assert.equal(doctor.json().checks.nginx.protected, true);
    assert.equal(doctor.json().routeAuth.mode, 'auth_request');

    const snippetPath = path.join(tmpRoot, 'nginx', 'desk-2.conf');
    const snippet = await fs.readFile(snippetPath, 'utf-8');
    assert.match(snippet, /auth_request \/_aadm\/auth\/desk-2;/);
    assert.match(snippet, /proxy_pass http:\/\/127\.0\.0\.1:3001\/verify;/);
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

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

const authHeaders = { authorization: 'Bearer test-token' };

async function importServerWithEnv() {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aadm-integration-'));
  const stateDir = path.join(tmpRoot, 'state');
  const nginxDir = path.join(tmpRoot, 'nginx');

  const execMod = await import('../../src/util/exec.ts');
  const configMod = await import('../../src/util/config.ts');
  const netMod = await import('../../src/util/net.ts');
  configMod.config.authToken = 'test-token';
  configMod.config.stateDir = stateDir;
  configMod.config.nginxSnippetDir = nginxDir;
  configMod.config.publicBaseUrl = 'https://host.example.com';
  netMod.setPortChecker(async () => true);

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
  await importServerWithEnv();
});

test.after(async () => {
  if (app) await app.close();
  try {
    const execMod = await import('../../src/util/exec.ts');
    const netMod = await import('../../src/util/net.ts');
    execMod.resetExecRunner();
    netMod.resetPortChecker();
  } catch {
    // no-op cleanup
  }
  if (tmpRoot) {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});

test('auth token is required when configured', async () => {
  assert.ok(app);
  const noAuth = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(noAuth.statusCode, 401);

  const withAuth = await app.inject({
    method: 'GET',
    url: '/health',
    headers: authHeaders
  });
  assert.equal(withAuth.statusCode, 200);
});

test('create success persists state and doctor includes snippet/ports/services', async () => {
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
  assert.equal(body.checks.ports.vnc, true);
  assert.equal(body.checks.ports.websockify, true);
  assert.equal(body.checks.ports.cdp, true);
  assert.equal(body.checks.ports.aab, true);
});

test('create failure on nginx test rolls back units, snippet, and state record', async () => {
  assert.ok(app);
  calls = [];
  failNginxTest = true;

  const create = await app.inject({
    method: 'POST',
    url: '/v1/desktops',
    headers: { ...authHeaders, 'content-type': 'application/json' },
    payload: { owner: 'codex', label: 'rollback' }
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
    1,
    'only initial successful desktop should remain'
  );

  const snippetPath = path.join(tmpRoot, 'nginx', 'desk-2.conf');
  await assert.rejects(fs.access(snippetPath));

  const stopCalls = calls.filter(
    (c) => c.cmd.endsWith('systemctl') && c.args[0] === 'stop'
  );
  assert.ok(stopCalls.length >= 1);
});

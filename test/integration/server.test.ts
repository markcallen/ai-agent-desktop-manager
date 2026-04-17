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

function installDefaultSaveStateHook(
  storeMod: Awaited<typeof import('../../src/util/store.ts')>
) {
  storeMod.setSaveStateHook(async (state, next) => {
    if (saveFailuresRemaining > 0) {
      saveFailuresRemaining -= 1;
      throw new Error('simulated state save failure');
    }
    await next(state);
  });
}

function installDefaultExecRunner(
  execMod: Awaited<typeof import('../../src/util/exec.ts')>
) {
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
}

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
  installDefaultSaveStateHook(storeMod);
  installDefaultExecRunner(execMod);

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
      websocketPath: '/_aadm/terminal/desk-1/ws',
      websocketUrl: '/_aadm/terminal/desk-1/ws'
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
        websocketPath: '/_aadm/terminal/desk-2/ws',
        websocketUrl: '/_aadm/terminal/desk-2/ws'
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
    const cookieHeader = Array.isArray(access.headers['set-cookie'])
      ? access.headers['set-cookie'][0]
      : (access.headers['set-cookie'] ?? '');
    assert.match(cookieHeader, /HttpOnly/);
    assert.match(cookieHeader, /Secure/);

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
  'desktop shell route returns Vite HTML and config JSON for a managed desktop',
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

    // Shell route returns the Vite index.html
    const shell = await app.inject({
      method: 'GET',
      url: `/_aadm/desktop/${created.id}`
    });
    assert.equal(shell.statusCode, 200);
    assert.match(
      String(shell.headers['content-type']),
      /^text\/html; charset=utf-8/
    );
    assert.match(shell.body, /<div id="root">/);
    assert.match(shell.body, /\/_aadm\/desktop-app\//);

    // Config endpoint returns JSON with terminal and bridge metadata
    const cfg = await app.inject({
      method: 'GET',
      url: `/_aadm/desktop/${created.id}/config`
    });
    assert.equal(cfg.statusCode, 200);
    const json = cfg.json() as {
      desktop: { id: string; display: number; label: string; novncUrl: string };
      terminal: {
        websocketUrl: string;
        sessionName: string;
        workspaceDir: string;
      };
      bridge: { enabled: boolean; websocketUrl: string };
    };
    assert.equal(json.desktop.id, created.id);
    assert.equal(json.desktop.display, created.display);
    assert.equal(json.desktop.label, 'shell');
    assert.match(json.desktop.novncUrl, /\/desktop\//);
    assert.equal(
      json.terminal.websocketUrl,
      `/_aadm/terminal/desk-${created.display}/ws`
    );
    assert.equal(json.bridge.enabled, false);
    assert.equal(
      json.bridge.websocketUrl,
      `/_aadm/bridge/desk-${created.display}/ws`
    );
  }
);

test(
  'desktop config endpoint reports bridge enabled when ai-agent-bridge is configured',
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

      const cfg = await app.inject({
        method: 'GET',
        url: `/_aadm/desktop/${created.id}/config`
      });
      assert.equal(cfg.statusCode, 200);
      const json = cfg.json() as { bridge: { enabled: boolean } };
      assert.equal(json.bridge.enabled, true);
    } finally {
      configMod.config.bridgeAddr = previousBridgeAddr;
    }
  }
);

test(
  'startServer restores tmux sessions for persisted running desktops',
  { concurrency: false },
  async () => {
    assert.ok(app);

    const configMod = await import('../../src/util/config.ts');
    const storeMod = await import('../../src/util/store.ts');
    const statePath = path.join(stateDirFromTmpRoot(), 'state.json');
    const previousState = await fs.readFile(statePath, 'utf-8');
    const previousConfig = {
      host: configMod.config.host,
      port: configMod.config.port,
      nginxBin: configMod.config.nginxBin,
      systemctlBin: configMod.config.systemctlBin,
      tmuxBin: configMod.config.tmuxBin,
      scriptBin: configMod.config.scriptBin
    };

    await fs.writeFile(
      statePath,
      JSON.stringify(
        {
          desktops: [
            {
              id: 'desk-1',
              label: 'restored-shell',
              createdAt: Date.now(),
              status: 'running',
              display: 1,
              vncPort: 5901,
              wsPort: 6081,
              cdpPort: 9222,
              aabPort: 8765,
              novncUrl: 'https://host.example.com/desktop/1/',
              aabUrl: 'http://127.0.0.1:8765',
              workspaceDir: path.join(
                stateDirFromTmpRoot(),
                'workspaces',
                'desk-1'
              ),
              terminalSessionName: 'aadm-desk-1',
              terminalWebsocketPath: '/_aadm/terminal/desk-1/ws',
              terminalWebsocketUrl: '/_aadm/terminal/desk-1/ws',
              routeAuth: { mode: 'none' }
            }
          ]
        },
        null,
        2
      ),
      'utf-8'
    );

    configMod.config.host = '127.0.0.1';
    configMod.config.port = 0;
    configMod.config.nginxBin = '/bin/sh';
    configMod.config.systemctlBin = '/bin/sh';
    storeMod.setSaveStateHook();

    calls = [];

    const execMod = await import('../../src/util/exec.ts');
    const missingTmuxSessions = new Set<string>();
    execMod.setExecRunner(async (cmd, args, opts) => {
      calls.push({ cmd, args, sudo: Boolean(opts?.sudo) });

      if (cmd.endsWith('nginx') && args[0] === '-t') {
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
      if (cmd.endsWith('tmux')) {
        const command = args[2];
        if (command === 'has-session') {
          return {
            code: 1,
            stdout: '',
            stderr: `can't find session: ${args[4] ?? 'unknown'}`
          };
        }
        if (command === 'new-session') {
          missingTmuxSessions.add(args[4] ?? '');
        }
        return { code: 0, stdout: '', stderr: '' };
      }

      return { code: 0, stdout: '', stderr: '' };
    });

    const serverMod = await import('../../src/server.ts');
    const restoredApp = await serverMod.startServer();

    try {
      const tmuxCommands = calls.map((call) => call.args[2]);
      assert.ok(tmuxCommands.includes('has-session'));
      assert.ok(tmuxCommands.includes('new-session'));
      assert.ok(tmuxCommands.includes('new-window'));
    } finally {
      await restoredApp.close();
      configMod.config.host = previousConfig.host;
      configMod.config.port = previousConfig.port;
      configMod.config.nginxBin = previousConfig.nginxBin;
      configMod.config.systemctlBin = previousConfig.systemctlBin;
      configMod.config.tmuxBin = previousConfig.tmuxBin;
      configMod.config.scriptBin = previousConfig.scriptBin;
      installDefaultSaveStateHook(storeMod);
      installDefaultExecRunner(execMod);
      await fs.writeFile(statePath, previousState, 'utf-8');
    }
  }
);

test(
  'desktop config normalizes legacy persisted terminal websocket URLs',
  { concurrency: false },
  async () => {
    assert.ok(app);

    await fs.mkdir(stateDirFromTmpRoot(), { recursive: true });
    await fs.writeFile(
      path.join(stateDirFromTmpRoot(), 'state.json'),
      JSON.stringify(
        {
          desktops: [
            {
              id: 'desk-1',
              label: 'legacy-shell',
              createdAt: Date.now(),
              status: 'running',
              display: 1,
              vncPort: 5901,
              wsPort: 6081,
              cdpPort: 9222,
              aabPort: 8765,
              novncUrl: 'https://host.example.com/desktop/1/',
              aabUrl: 'http://127.0.0.1:8765',
              workspaceDir: path.join(
                stateDirFromTmpRoot(),
                'workspaces',
                'desk-1'
              ),
              terminalSessionName: 'aadm-desk-1',
              terminalWebsocketPath: '/desktop/1/terminal/ws',
              terminalWebsocketUrl: 'ws://localhost:8899/desktop/1/terminal/ws',
              routeAuth: { mode: 'none' }
            }
          ]
        },
        null,
        2
      ),
      'utf-8'
    );

    const cfg = await app.inject({
      method: 'GET',
      url: '/_aadm/desktop/desk-1/config'
    });
    assert.equal(cfg.statusCode, 200);
    const json = cfg.json() as {
      terminal: { websocketPath: string; websocketUrl: string };
    };
    assert.equal(json.terminal.websocketPath, '/_aadm/terminal/desk-1/ws');
    assert.equal(json.terminal.websocketUrl, '/_aadm/terminal/desk-1/ws');
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

test(
  'browser log ingestion accepts pino browser batches and writes them to the server logger',
  { concurrency: false },
  async () => {
    assert.ok(app);

    const desktops = await app.inject({
      method: 'GET',
      url: '/v1/desktops',
      headers: authHeaders
    });
    assert.equal(desktops.statusCode, 200);
    const desktopId = desktops.json().desktops[0]?.id;
    assert.equal(typeof desktopId, 'string');

    const config = await app.inject({
      method: 'GET',
      url: `/_aadm/desktop/${desktopId}/config`,
      headers: authHeaders
    });
    assert.equal(config.statusCode, 200);

    const response = await app.inject({
      method: 'POST',
      url: '/_aadm/logs',
      headers: {
        'content-type': 'application/json',
        'x-aadm-logs-token': config.json().browserLogsToken
      },
      payload: {
        logs: [
          {
            level: 'warn',
            logEvent: {
              ts: 123456,
              level: { label: 'warn', value: 40 },
              bindings: [{ desktopId }],
              messages: [{ component: 'terminal' }, 'socket disconnected']
            }
          }
        ]
      }
    });

    assert.equal(response.statusCode, 200);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.match(loggerOutput, /socket disconnected/);
    assert.match(loggerOutput, /"browser":true/);
    assert.match(loggerOutput, new RegExp(`"desktopId":"${desktopId}"`));
    assert.match(loggerOutput, /"component":"terminal"/);
  }
);

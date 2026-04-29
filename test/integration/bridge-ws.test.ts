import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { Duplex } from 'node:stream';

class FakeUpgradeSocket extends Duplex {
  writes: Buffer[] = [];

  _read() {}

  _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void
  ) {
    this.writes.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    callback();
  }

  destroy(error?: Error) {
    queueMicrotask(() => {
      if (error) {
        this.emit('error', error);
      }
      this.emit('close');
    });
    return this;
  }
}

test('bridge websocket upgrade succeeds when bridge is configured', async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aadm-bridge-ws-'));

  try {
    const execMod = await import('../../src/util/exec.ts');
    const configMod = await import('../../src/util/config.ts');
    const netMod = await import('../../src/util/net.ts');
    const storeMod = await import('../../src/util/store.ts');

    configMod.config.authToken = 'test-token';
    configMod.config.bridgeAddr = '127.0.0.1:9445';
    configMod.config.stateDir = path.join(tmpRoot, 'state');
    configMod.config.workspaceRootDir = path.join(
      tmpRoot,
      'state',
      'workspaces'
    );
    configMod.config.tmuxConfPath = path.join(tmpRoot, 'state', 'tmux.conf');
    configMod.config.nginxSnippetDir = path.join(tmpRoot, 'nginx');
    configMod.config.publicBaseUrl = 'https://host.example.com';
    netMod.setPortChecker(async () => true);
    storeMod.setSaveStateHook();

    execMod.setExecRunner(async (cmd, args) => {
      if (cmd.endsWith('nginx') && args[0] === '-t') {
        return { code: 0, stdout: 'ok', stderr: '' };
      }
      if (cmd.endsWith('systemctl')) {
        return { code: 0, stdout: 'active\n', stderr: '' };
      }
      if (cmd.endsWith('tmux')) {
        return { code: 0, stdout: '', stderr: '' };
      }
      return { code: 0, stdout: '', stderr: '' };
    });

    const serverMod = await import('../../src/server.ts');
    const app = serverMod.buildApp();
    await app.ready();

    try {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/v1/desktops',
        headers: {
          authorization: 'Bearer test-token',
          'content-type': 'application/json'
        },
        payload: { owner: 'codex', label: 'bridge-ws-test' }
      });
      assert.equal(createResponse.statusCode, 200);

      const socket = new FakeUpgradeSocket();
      const request = new EventEmitter() as EventEmitter & {
        headers: Record<string, string>;
        url: string;
        method: string;
        socket: FakeUpgradeSocket;
      };
      request.headers = {
        connection: 'Upgrade',
        upgrade: 'websocket',
        'sec-websocket-version': '13',
        'sec-websocket-key': 'dGVzdC1rZXktMDEyMzQ1Ng=='
      };
      request.url = '/_aadm/bridge/desk-1/ws';
      request.method = 'GET';
      request.socket = socket;

      app.server.emit('upgrade', request, socket, Buffer.alloc(0));
      await new Promise((resolve) => setTimeout(resolve, 25));

      const rawWrites = Buffer.concat(socket.writes).toString('utf8');
      assert.match(rawWrites, /HTTP\/1\.1 101 Switching Protocols/);
    } finally {
      await app.close();
    }
  } finally {
    try {
      const execMod = await import('../../src/util/exec.ts');
      const netMod = await import('../../src/util/net.ts');
      const storeMod = await import('../../src/util/store.ts');
      execMod.resetExecRunner();
      netMod.resetPortChecker();
      storeMod.setSaveStateHook();
    } catch {
      // ignore cleanup failures in test teardown
    }
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});

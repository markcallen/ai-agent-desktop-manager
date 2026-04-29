import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { EventEmitter } from 'node:events';
import { Duplex } from 'node:stream';

class FakeSocket extends Duplex {
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
      if (error) this.emit('error', error);
      this.emit('close');
    });
    return this;
  }
}

test('vite HMR websocket upgrade accepts desktop-app-prefixed path and preserves query string', async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aadm-vite-hmr-'));
  const originalConnect = net.connect;
  let capturedTarget:
    | { port: number; host: string; proxySocket: FakeSocket }
    | undefined;

  try {
    const execMod = await import('../../src/util/exec.ts');
    const configMod = await import('../../src/util/config.ts');
    const netMod = await import('../../src/util/net.ts');
    const storeMod = await import('../../src/util/store.ts');

    configMod.config.authToken = 'test-token';
    configMod.config.stateDir = path.join(tmpRoot, 'state');
    configMod.config.workspaceRootDir = path.join(
      tmpRoot,
      'state',
      'workspaces'
    );
    configMod.config.tmuxConfPath = path.join(tmpRoot, 'state', 'tmux.conf');
    configMod.config.nginxSnippetDir = path.join(tmpRoot, 'nginx');
    configMod.config.publicBaseUrl = 'https://host.example.com';
    configMod.config.viteDevUrl = 'http://127.0.0.1:5173';
    netMod.setPortChecker(async () => true);
    storeMod.setSaveStateHook();
    execMod.setExecRunner(async () => ({ code: 0, stdout: '', stderr: '' }));

    net.connect = ((port: number, host: string) => {
      const proxySocket = new FakeSocket();
      capturedTarget = { port, host, proxySocket };
      return proxySocket as unknown as ReturnType<typeof net.connect>;
    }) as typeof net.connect;

    const serverMod = await import('../../src/server.ts');
    const app = serverMod.buildApp();
    await app.ready();

    try {
      const browserSocket = new FakeSocket();
      const request = new EventEmitter() as EventEmitter & {
        headers: Record<string, string>;
        url: string;
      };
      request.headers = {
        host: 'localhost:8899',
        connection: 'Upgrade',
        upgrade: 'websocket',
        'sec-websocket-key': 'dGVzdC1rZXktMDEyMzQ1Ng=='
      };
      request.url = '/_aadm/desktop-app/_aadm_hmr?token=test-hmr-token';

      app.server.emit('upgrade', request, browserSocket, Buffer.alloc(0));
      await new Promise((resolve) => setTimeout(resolve, 25));

      assert.ok(capturedTarget);
      assert.equal(capturedTarget.port, 5173);
      assert.equal(capturedTarget.host, '127.0.0.1');

      const proxiedRequest = Buffer.concat(
        capturedTarget.proxySocket.writes
      ).toString('utf8');
      assert.match(
        proxiedRequest,
        /^GET \/_aadm_hmr\?token=test-hmr-token HTTP\/1\.1\r\n/m
      );
    } finally {
      await app.close();
    }
  } finally {
    net.connect = originalConnect;
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

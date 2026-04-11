import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough, Duplex } from 'node:stream';

class FakeTerminalProcess extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();

  kill() {
    this.emit('close', 0);
    return true;
  }
}

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

  clientSend(chunk: Buffer) {
    this.emit('data', chunk);
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

function maskedTextFrame(text: string) {
  const payload = Buffer.from(text);
  const mask = Buffer.from([1, 2, 3, 4]);
  const header = Buffer.from([0x81, 0x80 | payload.length, ...mask]);
  const maskedPayload = Buffer.alloc(payload.length);
  for (let index = 0; index < payload.length; index += 1) {
    maskedPayload[index] = payload[index] ^ mask[index % 4];
  }
  return Buffer.concat([header, maskedPayload]);
}

function parseServerTextFrames(writes: Buffer[]) {
  const frames: string[] = [];

  for (const write of writes) {
    if (write.includes(Buffer.from('HTTP/1.1 101 Switching Protocols'))) {
      continue;
    }

    let offset = 0;
    while (offset + 2 <= write.length) {
      const first = write[offset];
      const second = write[offset + 1];
      const opcode = first & 0x0f;
      if (opcode === 0x8) {
        offset += 2;
        continue;
      }

      let payloadLength = second & 0x7f;
      offset += 2;
      if (payloadLength === 126) {
        payloadLength = write.readUInt16BE(offset);
        offset += 2;
      } else if (payloadLength === 127) {
        payloadLength = Number(write.readBigUInt64BE(offset));
        offset += 8;
      }

      frames.push(
        write.subarray(offset, offset + payloadLength).toString('utf8')
      );
      offset += payloadLength;
    }
  }

  return frames;
}

test('terminal websocket upgrade proxies tmux attach output and input', async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aadm-terminal-ws-'));

  const execMod = await import('../../src/util/exec.ts');
  const configMod = await import('../../src/util/config.ts');
  const netMod = await import('../../src/util/net.ts');
  const terminalPtyMod = await import('../../src/util/terminal-pty.ts');
  const storeMod = await import('../../src/util/store.ts');

  configMod.config.authToken = 'test-token';
  configMod.config.stateDir = path.join(tmpRoot, 'state');
  configMod.config.workspaceRootDir = path.join(tmpRoot, 'state', 'workspaces');
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

  const fakeProcess = new FakeTerminalProcess();
  terminalPtyMod.setTerminalAttachFactory(
    () =>
      fakeProcess as unknown as ReturnType<
        typeof terminalPtyMod.createTerminalAttachProcess
      >
  );

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
      payload: { owner: 'codex', label: 'ws-test' }
    });
    assert.equal(createResponse.statusCode, 200);

    const inputChunks: Buffer[] = [];
    fakeProcess.stdin.on('data', (chunk) => {
      inputChunks.push(Buffer.from(chunk));
    });

    const socket = new FakeUpgradeSocket();
    const request = new EventEmitter() as EventEmitter & {
      headers: Record<string, string>;
      url: string;
    };
    request.headers = {
      upgrade: 'websocket',
      'sec-websocket-key': 'dGVzdC1rZXktMDEyMzQ1Ng=='
    };
    request.url = '/_aadm/terminal/desk-1/ws?cols=120&rows=40';

    app.server.emit('upgrade', request, socket, Buffer.alloc(0));
    await new Promise((resolve) => setTimeout(resolve, 25));

    fakeProcess.stdout.write('\u001b[32mhello\u001b[0m');
    socket.clientSend(
      maskedTextFrame(
        JSON.stringify({ type: 'input', data: 'docker compose up\n' })
      )
    );
    await new Promise((resolve) => setTimeout(resolve, 25));

    const rawWrites = Buffer.concat(socket.writes).toString('utf8');
    assert.match(rawWrites, /HTTP\/1\.1 101 Switching Protocols/);

    const messages = parseServerTextFrames(socket.writes).map((frame) =>
      JSON.parse(frame)
    );
    assert.equal(messages[0].type, 'ready');
    assert.equal(messages[1].type, 'output');
    assert.equal(
      Buffer.from(String(messages[1].data), 'base64').toString('utf8'),
      '\u001b[32mhello\u001b[0m'
    );
    assert.equal(
      Buffer.concat(inputChunks).toString('utf8'),
      'docker compose up\n'
    );
  } finally {
    await app.close();
    terminalPtyMod.resetTerminalAttachFactory();
    execMod.resetExecRunner();
    netMod.resetPortChecker();
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});

#!/usr/bin/env node
import fs from 'node:fs/promises';
import { argv, env, exit } from 'node:process';

type Command = 'follow' | 'eval' | 'navigate' | 'page-info' | 'screenshot';

type EventMessage = {
  event: string;
  data: Record<string, unknown>;
};

type ResponseMessage = {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
};

function flag(name: string) {
  const idx = argv.indexOf(name);
  if (idx === -1) return undefined;
  return argv[idx + 1];
}

function has(name: string) {
  return argv.includes(name);
}

function command(): Command {
  const cmd = (argv[2] as Command | undefined) ?? 'follow';
  if (['follow', 'eval', 'navigate', 'page-info', 'screenshot'].includes(cmd)) {
    return cmd;
  }
  console.error(
    'Unknown command. Use: follow|eval|navigate|page-info|screenshot'
  );
  exit(2);
}

function positional(index: number) {
  const args = argv.slice(3).filter((arg, i, items) => {
    if (!arg.startsWith('--')) return true;
    const next = items[i + 1];
    return next === undefined || next.startsWith('--');
  });
  return args[index];
}

function baseUrl() {
  return flag('--url') ?? env.AAB_URL ?? 'http://127.0.0.1:8765';
}

function wsUrl() {
  const explicit = flag('--ws-url') ?? env.AAB_WS_URL;
  if (explicit) return explicit;

  const base = new URL(baseUrl());
  base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  base.pathname = '/ws';
  base.search = '';
  return base.toString();
}

function outPath() {
  return flag('--out') ?? 'screenshot.png';
}

function followAfterCommand(cmd: Command) {
  return has('--follow') || cmd === 'follow';
}

function printEvent(msg: EventMessage) {
  if (msg.event === 'console_message') {
    const data = msg.data ?? {};
    const loc = data.url
      ? ` ${data.url}:${Number(data.lineNumber ?? 0) + 1}`
      : '';
    console.log(`[console.${data.level ?? 'log'}] ${data.text ?? ''}${loc}`);
    return;
  }

  if (msg.event === 'page_navigated') {
    console.log(`[page] ${msg.data?.url ?? ''}`);
    return;
  }

  if (
    msg.event === 'browser_connected' ||
    msg.event === 'browser_disconnected'
  ) {
    console.log(`[browser] ${msg.event} ${JSON.stringify(msg.data ?? {})}`);
    return;
  }

  if (has('--verbose')) {
    console.log(JSON.stringify(msg));
  }
}

async function connectWebSocket() {
  if (typeof WebSocket === 'undefined') {
    throw new Error('WebSocket is not available in this Node runtime');
  }

  const socket = new WebSocket(wsUrl());
  const pending = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (err: Error) => void }
  >();

  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true });
    socket.addEventListener(
      'error',
      () => reject(new Error('websocket_connect_failed')),
      { once: true }
    );
  });

  socket.addEventListener('message', (event) => {
    const raw = String(event.data);
    let data: EventMessage | ResponseMessage;
    try {
      data = JSON.parse(raw);
    } catch {
      console.error(raw);
      return;
    }

    if ('event' in data) {
      printEvent(data);
      return;
    }

    const waiter = pending.get(data.id);
    if (!waiter) return;
    pending.delete(data.id);
    if (data.ok) {
      waiter.resolve(data.result);
    } else {
      waiter.reject(new Error(data.error ?? 'unknown_error'));
    }
  });

  socket.addEventListener('close', () => {
    for (const waiter of pending.values()) {
      waiter.reject(new Error('websocket_closed'));
    }
    pending.clear();
  });

  let nextId = 1;

  async function send(method: string, params?: Record<string, unknown>) {
    const id = String(nextId++);
    const payload = JSON.stringify({ id, method, params });
    const response = new Promise<unknown>((resolve, reject) => {
      pending.set(id, { resolve, reject });
    });
    socket.send(payload);
    return response;
  }

  return { socket, send };
}

async function waitUntilInterrupted(socket: WebSocket) {
  await new Promise<void>((resolve) => {
    const stop = () => {
      try {
        socket.close();
      } catch {
        // ignore close failures
      }
      resolve();
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
}

async function run() {
  const cmd = command();

  if (cmd === 'screenshot') {
    const res = await fetch(new URL('/screenshot', baseUrl()));
    if (!res.ok) {
      throw new Error(`screenshot_failed:${res.status}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    await fs.writeFile(outPath(), buf);
    console.log(outPath());
    return;
  }

  const { socket, send } = await connectWebSocket();

  try {
    if (cmd === 'eval') {
      const expression = positional(0);
      if (!expression) throw new Error('missing expression');
      const result = await send('evaluate', { expression });
      console.log(JSON.stringify(result, null, 2));
    } else if (cmd === 'navigate') {
      const url = positional(0);
      if (!url) throw new Error('missing url');
      const result = await send('navigate', {
        url,
        waitUntil: 'load',
        timeoutMs: 15000
      });
      console.log(JSON.stringify(result, null, 2));
    } else if (cmd === 'page-info') {
      const result = await send('page_info', {});
      console.log(JSON.stringify(result, null, 2));
    }

    if (followAfterCommand(cmd)) {
      console.error(`following ${wsUrl()} (Ctrl-C to stop)`);
      await waitUntilInterrupted(socket);
    } else {
      socket.close();
    }
  } finally {
    try {
      socket.close();
    } catch {
      // ignore close failures
    }
  }
}

run().catch((err) => {
  console.error(String(err instanceof Error ? err.message : err));
  exit(1);
});

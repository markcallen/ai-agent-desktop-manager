import test from 'node:test';
import assert from 'node:assert/strict';
import type pino from 'pino';

import {
  createBrowserLogTransport,
  createPinoBrowserLogger
} from '../../web/src/lib/logger.ts';

test('browser transport batches pino log events to /_aadm/logs', async () => {
  const requests: Array<{
    url: string;
    init?: RequestInit;
  }> = [];

  const transport = createBrowserLogTransport({
    token: 'browser-token',
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), init });
      return new Response(null, { status: 202 });
    },
    scheduleFlush: () => 1,
    cancelFlush: () => {},
    now: () => 1234
  });

  const logEvent: pino.LogEvent = {
    ts: 1234,
    level: { label: 'info', value: 30 },
    bindings: [{ desktopId: 'desk-1' }],
    messages: ['hello', { answer: 42 }]
  };

  transport.send('info', logEvent);
  await transport.flush();

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/_aadm/logs');
  assert.equal(
    requests[0].init?.headers &&
      (requests[0].init.headers as Record<string, string>)['x-aadm-logs-token'],
    'browser-token'
  );
  assert.deepEqual(JSON.parse(String(requests[0].init?.body)), {
    logs: [{ level: 'info', logEvent }]
  });
});

test('pino browser logger captures console methods through the transport', async () => {
  const sent: Array<{ level: pino.Level; logEvent: pino.LogEvent }> = [];
  const originalConsole = {
    log: console.log,
    info: console.info,
    debug: console.debug,
    warn: console.warn,
    error: console.error,
    trace: console.trace
  };

  const writes: Array<{ method: string; value: unknown }> = [];

  try {
    const logger = createPinoBrowserLogger({
      transmit: {
        send(level, logEvent) {
          sent.push({ level, logEvent });
        }
      },
      consoleMethods: {
        log: (value: unknown) => writes.push({ method: 'log', value }),
        info: (value: unknown) => writes.push({ method: 'info', value }),
        debug: (value: unknown) => writes.push({ method: 'debug', value }),
        warn: (value: unknown) => writes.push({ method: 'warn', value }),
        error: (value: unknown) => writes.push({ method: 'error', value }),
        trace: (value: unknown) => writes.push({ method: 'trace', value })
      }
    });

    console.log = (...args: unknown[]) => logger.captureConsole('log', args);
    console.warn = (...args: unknown[]) => logger.captureConsole('warn', args);
    console.error = (...args: unknown[]) =>
      logger.captureConsole('error', args);

    console.log('console-message', { ok: true });
    console.warn('warn-message');
    console.error(new Error('boom'));

    assert.equal(sent.length, 3);
    assert.deepEqual(
      sent.map((entry) => entry.level),
      ['info', 'warn', 'error']
    );
    assert.equal(writes.length, 3);
  } finally {
    console.log = originalConsole.log;
    console.info = originalConsole.info;
    console.debug = originalConsole.debug;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
    console.trace = originalConsole.trace;
  }
});

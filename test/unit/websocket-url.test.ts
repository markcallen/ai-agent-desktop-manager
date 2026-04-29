import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveDesktopWebSocketUrl } from '../../web/src/lib/api.ts';

test('resolves relative websocket paths against the public desktop host', () => {
  assert.equal(
    resolveDesktopWebSocketUrl(
      '/desktop/1/terminal/ws',
      'https://desktop.example.com/desktop/1/'
    ),
    'wss://desktop.example.com/desktop/1/terminal/ws'
  );
});

test('rewrites absolute loopback websocket URLs to the public desktop host', () => {
  assert.equal(
    resolveDesktopWebSocketUrl(
      'ws://localhost:8899/desktop/1/terminal/ws',
      'https://desktop.example.com/desktop/1/'
    ),
    'wss://desktop.example.com/desktop/1/terminal/ws'
  );
});

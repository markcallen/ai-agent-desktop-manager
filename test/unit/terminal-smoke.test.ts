import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildTerminalWebsocketUrl,
  parseArgs
} from '../../smoke/terminal-smoke.mjs';

test('terminal smoke parser accepts desktop access bootstrap url and output path', () => {
  const options = parseArgs([
    '--desktop-access-url',
    'https://smoke.markcallen.dev/desktop/2/access?token=abc',
    '--output',
    '/tmp/terminal.json'
  ]);

  assert.deepEqual(options, {
    desktopAccessUrl: 'https://smoke.markcallen.dev/desktop/2/access?token=abc',
    output: '/tmp/terminal.json'
  });
});

test('terminal smoke websocket helper builds the AADM terminal websocket URL', () => {
  assert.equal(
    buildTerminalWebsocketUrl(
      'https://smoke.markcallen.dev/desktop/2/access?token=abc'
    ),
    'wss://smoke.markcallen.dev/_aadm/terminal/desk-2/ws'
  );
});

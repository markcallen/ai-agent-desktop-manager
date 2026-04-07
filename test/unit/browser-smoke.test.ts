import test from 'node:test';
import assert from 'node:assert/strict';
import { buildConnectUrl, parseArgs } from '../../smoke/browser-smoke.mjs';

test('parseArgs accepts access-url flow without VNC password', () => {
  const options = parseArgs([
    '--url',
    'https://smoke.markcallen.dev/desktop/2/access?token=abc',
    '--screenshot',
    '/tmp/shot.png'
  ]);

  assert.deepEqual(options, {
    url: 'https://smoke.markcallen.dev/desktop/2/access?token=abc',
    vncPassword: '',
    screenshot: '/tmp/shot.png',
    ignoreHttpsErrors: 'false'
  });
});

test('parseArgs accepts explicit VNC password', () => {
  const options = parseArgs([
    '--url',
    'https://smoke.markcallen.dev/',
    '--vnc-password',
    'SmokePassw0rd!',
    '--screenshot',
    '/tmp/shot.png',
    '--ignore-https-errors',
    'true'
  ]);

  assert.equal(options.vncPassword, 'SmokePassw0rd!');
  assert.equal(options.ignoreHttpsErrors, 'true');
});

test('buildConnectUrl keeps explicit vnc.html paths untouched', () => {
  const url = buildConnectUrl(
    'https://smoke.markcallen.dev/desktop/2/vnc.html'
  );

  assert.equal(
    url.toString(),
    'https://smoke.markcallen.dev/desktop/2/vnc.html?autoconnect=1&resize=remote'
  );
});

test('buildConnectUrl appends vnc.html for directory paths', () => {
  const url = buildConnectUrl('https://smoke.markcallen.dev/desktop/2/');

  assert.equal(
    url.toString(),
    'https://smoke.markcallen.dev/desktop/2/vnc.html?autoconnect=1&resize=remote'
  );
});

test('buildConnectUrl preserves token access paths', () => {
  const url = buildConnectUrl(
    'https://smoke.markcallen.dev/desktop/2/access?token=abc'
  );

  assert.equal(
    url.toString(),
    'https://smoke.markcallen.dev/desktop/2/access?token=abc'
  );
});

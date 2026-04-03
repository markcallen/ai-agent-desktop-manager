import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeAuthRequestUrl,
  normalizeDesktopRouteAuth,
  parseForwardedHeaderNames
} from '../../src/util/route-auth.ts';

test('parseForwardedHeaderNames keeps only safe header tokens', () => {
  assert.deepEqual(
    parseForwardedHeaderNames('X-Test, bad header, X-Test, x-ok'),
    ['x-test', 'x-ok']
  );
});

test('normalizeAuthRequestUrl accepts only safe http(s) urls', () => {
  assert.equal(
    normalizeAuthRequestUrl('http://127.0.0.1:3001/verify'),
    'http://127.0.0.1:3001/verify'
  );
  assert.equal(normalizeAuthRequestUrl('ftp://127.0.0.1/verify'), undefined);
  assert.equal(
    normalizeAuthRequestUrl('http://127.0.0.1/verify;drop'),
    undefined
  );
});

test('normalizeDesktopRouteAuth rejects unsafe persisted auth config', () => {
  assert.equal(
    normalizeDesktopRouteAuth({
      mode: 'auth_request',
      authRequest: {
        url: 'http://127.0.0.1/verify\nmalicious',
        forwardedHeaders: ['x-smoke-auth']
      }
    }),
    undefined
  );

  assert.deepEqual(
    normalizeDesktopRouteAuth({
      mode: 'auth_request',
      authRequest: {
        url: 'http://127.0.0.1:3001/verify',
        forwardedHeaders: ['X-Smoke-Auth', 'bad header']
      }
    }),
    {
      mode: 'auth_request',
      authRequest: {
        url: 'http://127.0.0.1:3001/verify',
        forwardedHeaders: ['x-smoke-auth']
      }
    }
  );
});

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createDesktopAccessToken,
  defaultDesktopRouteAuth,
  normalizeAuthRequestUrl,
  normalizeDesktopRouteAuth,
  parseForwardedHeaderNames,
  verifyDesktopAccessToken
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

test('defaultDesktopRouteAuth builds token mode from config', () => {
  const routeAuth = defaultDesktopRouteAuth({
    desktopRouteAuthMode: 'token',
    desktopRouteAuthRequestHeaders: [],
    desktopRouteTokenSecret: 'test-secret',
    desktopRouteTokenTtlSeconds: 900
  });

  assert.deepEqual(routeAuth, {
    mode: 'token',
    token: {
      ttlSeconds: 900
    }
  });
});

test('normalizeDesktopRouteAuth accepts token mode persisted state', () => {
  assert.deepEqual(
    normalizeDesktopRouteAuth({
      mode: 'token',
      token: {
        ttlSeconds: 300
      }
    }),
    {
      mode: 'token',
      token: {
        ttlSeconds: 300
      }
    }
  );
});

test('verifyDesktopAccessToken rejects wrong desktop and expired tokens', () => {
  const validAt = Date.UTC(2026, 3, 3, 0, 0, 0);
  const token = createDesktopAccessToken('desk-1', 'test-secret', 300, validAt);

  assert.deepEqual(
    verifyDesktopAccessToken(token, 'desk-1', 'test-secret', validAt),
    {
      desktopId: 'desk-1',
      expiresAt: validAt + 300_000
    }
  );
  assert.equal(
    verifyDesktopAccessToken(token, 'desk-2', 'test-secret', validAt),
    undefined
  );
  assert.equal(
    verifyDesktopAccessToken(token, 'desk-1', 'test-secret', validAt + 301_000),
    undefined
  );
});

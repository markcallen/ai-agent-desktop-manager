import test from 'node:test';
import assert from 'node:assert/strict';
import { toGrpcTarget } from '../../src/util/bridge.ts';

test('toGrpcTarget strips http:// scheme from bridge address', () => {
  assert.equal(toGrpcTarget('http://127.0.0.1:8765'), '127.0.0.1:8765');
});

test('toGrpcTarget strips https:// scheme from bridge address', () => {
  assert.equal(
    toGrpcTarget('https://bridge.internal:50051'),
    'bridge.internal:50051'
  );
});

test('toGrpcTarget passes through bare host:port unchanged', () => {
  assert.equal(toGrpcTarget('127.0.0.1:8765'), '127.0.0.1:8765');
});

test('toGrpcTarget passes through hostname:port unchanged', () => {
  assert.equal(toGrpcTarget('bridge.internal:50051'), 'bridge.internal:50051');
});

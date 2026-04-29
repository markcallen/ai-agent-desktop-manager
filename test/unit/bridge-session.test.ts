import test from 'node:test';
import assert from 'node:assert/strict';
import {
  acknowledgeBridgeSessionStart,
  beginBridgeSessionStart,
  clearBridgeSession,
  setBridgeSessionError,
  type BridgeSessionUiState
} from '../../web/src/lib/bridge-session.ts';

function emptyState(): BridgeSessionUiState {
  return {
    session: null,
    pendingStart: null,
    error: null
  };
}

test('start request does not create an active session before ack', () => {
  const started = beginBridgeSessionStart(
    emptyState(),
    { sessionId: 'sess-1', clientId: 'client-1' },
    true
  );

  assert.equal(started.session, null);
  assert.deepEqual(started.pendingStart, {
    sessionId: 'sess-1',
    clientId: 'client-1'
  });
  assert.equal(started.error, null);
});

test('start request send failure leaves session inactive and surfaces an error', () => {
  const started = beginBridgeSessionStart(
    emptyState(),
    { sessionId: 'sess-1', clientId: 'client-1' },
    false
  );

  assert.equal(started.session, null);
  assert.equal(started.pendingStart, null);
  assert.equal(started.error, 'Bridge connection is not ready');
});

test('session ack promotes the pending session to active', () => {
  const pending = beginBridgeSessionStart(
    emptyState(),
    { sessionId: 'sess-1', clientId: 'client-1' },
    true
  );

  const acknowledged = acknowledgeBridgeSessionStart(pending, 'sess-1');

  assert.deepEqual(acknowledged.session, {
    sessionId: 'sess-1',
    clientId: 'client-1'
  });
  assert.equal(acknowledged.pendingStart, null);
});

test('error and stop clear the pending start state', () => {
  const pending = beginBridgeSessionStart(
    emptyState(),
    { sessionId: 'sess-1', clientId: 'client-1' },
    true
  );

  const failed = setBridgeSessionError(pending, 'bridge failed');
  assert.equal(failed.pendingStart, null);
  assert.equal(failed.error, 'bridge failed');

  const cleared = clearBridgeSession({
    ...failed,
    session: { sessionId: 'sess-1', clientId: 'client-1' }
  });
  assert.equal(cleared.session, null);
  assert.equal(cleared.pendingStart, null);
});

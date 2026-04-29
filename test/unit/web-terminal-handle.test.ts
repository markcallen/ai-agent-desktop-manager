import test from 'node:test';
import assert from 'node:assert/strict';
import { createTerminalHandle } from '../../web/src/components/terminal-handle.ts';

test('createTerminalHandle.clear resets the visible terminal when reset is available', () => {
  let resetCalls = 0;
  let clearCalls = 0;
  const xtermRef = {
    current: {
      write() {},
      clear() {
        clearCalls += 1;
      },
      reset() {
        resetCalls += 1;
      },
      focus() {},
      cols: 80,
      rows: 24
    }
  };
  const fitRef = {
    current: {
      fit() {}
    }
  };

  const handle = createTerminalHandle(xtermRef, fitRef);
  handle.clear();

  assert.equal(resetCalls, 1);
  assert.equal(clearCalls, 0);
});

test('createTerminalHandle.clear falls back to clear when reset is unavailable', () => {
  let clearCalls = 0;
  const xtermRef = {
    current: {
      write() {},
      clear() {
        clearCalls += 1;
      },
      focus() {},
      cols: 80,
      rows: 24
    }
  };
  const fitRef = {
    current: {
      fit() {}
    }
  };

  const handle = createTerminalHandle(xtermRef, fitRef);
  handle.clear();

  assert.equal(clearCalls, 1);
});

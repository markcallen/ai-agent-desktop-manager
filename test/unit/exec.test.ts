import test from 'node:test';
import assert from 'node:assert/strict';
import { execCmd, resetExecRunner } from '../../src/util/exec.ts';

test('execCmd resolves with a non-zero code when spawn emits error', async () => {
  resetExecRunner();
  const res = await execCmd('/definitely/missing-command', []);
  assert.notEqual(res.code, 0);
  assert.match(res.stderr, /(ENOENT|not found|no such file)/i);
});

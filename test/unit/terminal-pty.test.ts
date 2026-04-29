import test from 'node:test';
import assert from 'node:assert/strict';

import { terminalAttachEnv } from '../../src/util/terminal-pty.ts';

test('terminalAttachEnv forces a clear-capable terminal type', () => {
  const env = terminalAttachEnv({
    HOME: '/tmp/custom-home',
    SHELL: '/bin/sh',
    TERM: 'dumb',
    PATH: '/usr/bin'
  });

  assert.equal(env.HOME, '/var/lib/aadm');
  assert.equal(env.SHELL, '/bin/bash');
  assert.equal(env.TERM, 'xterm-256color');
  assert.equal(env.PATH, '/usr/bin');
});

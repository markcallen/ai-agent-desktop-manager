import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import {
  buildTerminalWebsocketPath,
  buildTerminalWebsocketUrl,
  ensureTmuxSession,
  terminalSessionName,
  workspaceDirForDesktop
} from '../../src/util/terminal.ts';
import { resetExecRunner, setExecRunner } from '../../src/util/exec.ts';
import { config } from '../../src/util/config.ts';

test('terminalSessionName derives a stable tmux session name from the desktop id', () => {
  assert.equal(terminalSessionName('desk-7'), 'aadm-desk-7');
});

test('buildTerminalWebsocketPath uses the desktop path prefix', () => {
  assert.equal(
    buildTerminalWebsocketPath('/desktop', 7),
    '/desktop/7/terminal/ws'
  );
});

test('buildTerminalWebsocketUrl upgrades the public base url scheme', () => {
  assert.equal(
    buildTerminalWebsocketUrl('https://host.example.com', '/desktop', 7),
    'wss://host.example.com/desktop/7/terminal/ws'
  );
  assert.equal(
    buildTerminalWebsocketUrl('http://127.0.0.1:8899', '/desk', 2),
    'ws://127.0.0.1:8899/desk/2/terminal/ws'
  );
});

test('workspaceDirForDesktop nests workspaces under the configured root', () => {
  assert.equal(
    workspaceDirForDesktop('/tmp/aadm-workspaces', 'desk-7'),
    path.join('/tmp/aadm-workspaces', 'desk-7')
  );
});

test('ensureTmuxSession runs tmux with a stable HOME and SHELL', async () => {
  const originalTmuxConfPath = config.tmuxConfPath;
  const calls: Array<{
    cmd: string;
    args: string[];
    env?: Record<string, string>;
  }> = [];
  config.tmuxConfPath = '/tmp/aadm-test.tmux.conf';

  setExecRunner(async (cmd, args, opts) => {
    calls.push({ cmd, args, env: opts?.env });
    if (args.includes('has-session')) {
      return { code: 1, stdout: '', stderr: 'no session' };
    }
    return { code: 0, stdout: '', stderr: '' };
  });

  try {
    await ensureTmuxSession('aadm-desk-7', '/tmp/aadm-workspaces/desk-7');
  } finally {
    config.tmuxConfPath = originalTmuxConfPath;
    resetExecRunner();
  }

  assert.equal(calls.length, 5);
  for (const call of calls) {
    assert.equal(call.cmd.endsWith('tmux'), true);
    assert.equal(call.args[0], '-f');
    assert.equal(call.args[1], '/tmp/aadm-test.tmux.conf');
    assert.deepEqual(call.env, {
      HOME: '/var/lib/aadm',
      SHELL: '/bin/bash'
    });
  }
});

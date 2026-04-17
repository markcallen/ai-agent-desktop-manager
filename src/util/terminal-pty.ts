import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { config } from './config.js';
import { TERMINAL_ENV } from './terminal.js';

export type TerminalAttachProcess = ChildProcessWithoutNullStreams;

export type TerminalAttachFactory = (opts: {
  sessionName: string;
  cols: number;
  rows: number;
}) => TerminalAttachProcess;

function shellEscape(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function terminalAttachEnv(baseEnv: NodeJS.ProcessEnv = process.env) {
  return {
    ...baseEnv,
    ...TERMINAL_ENV
  };
}

function defaultTerminalAttachFactory({
  sessionName,
  cols,
  rows
}: {
  sessionName: string;
  cols: number;
  rows: number;
}) {
  const command = [
    `stty cols ${Math.max(1, cols)} rows ${Math.max(1, rows)}`,
    `exec ${shellEscape(config.tmuxBin)} -f ${shellEscape(config.tmuxConfPath)} attach-session -t ${shellEscape(sessionName)}`
  ].join(' && ');

  return spawn(config.scriptBin, ['-qfc', command, '/dev/null'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: terminalAttachEnv()
  });
}

let terminalAttachFactory: TerminalAttachFactory = defaultTerminalAttachFactory;

export function createTerminalAttachProcess(opts: {
  sessionName: string;
  cols: number;
  rows: number;
}) {
  return terminalAttachFactory(opts);
}

export function setTerminalAttachFactory(factory: TerminalAttachFactory) {
  terminalAttachFactory = factory;
}

export function resetTerminalAttachFactory() {
  terminalAttachFactory = defaultTerminalAttachFactory;
}

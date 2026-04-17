import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { execCmd } from './exec.js';

const TERMINAL_WINDOW_NAMES = ['shell', 'editor', 'compose', 'tests'] as const;
const TMUX_WINDOW_COMMAND = '/bin/bash';
export const TERMINAL_ENV = {
  HOME: '/var/lib/aadm',
  SHELL: TMUX_WINDOW_COMMAND,
  TERM: 'xterm-256color'
};
const TMUX_MANAGED_CONFIG = `# Managed by ai-agent-desktop-manager
set-option -g default-shell "${TMUX_WINDOW_COMMAND}"
set-option -g default-command "${TMUX_WINDOW_COMMAND} -l"
set-option -g base-index 1
set-option -g pane-base-index 1
set-option -g history-limit 100000
set-option -g renumber-windows on
set-window-option -g mode-keys vi
set-option -g mouse on
set-option -g allow-rename off
set-option -g set-clipboard off
set-option -g status on
set-option -g status-left-length 24
set-option -g status-right-length 80
set-option -g status-left "#S "
set-option -g status-right "#{pane_current_path}"
`;

function tmuxArgs(args: string[]) {
  return ['-f', config.tmuxConfPath, ...args];
}

async function ensureTmuxConfig() {
  const confPath = config.tmuxConfPath;
  await fs.mkdir(path.dirname(confPath), { recursive: true });

  try {
    const current = await fs.readFile(confPath, 'utf8');
    if (current === TMUX_MANAGED_CONFIG) {
      return confPath;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  await fs.writeFile(confPath, TMUX_MANAGED_CONFIG, {
    encoding: 'utf8',
    mode: 0o644
  });
  return confPath;
}

export function terminalSessionName(desktopId: string) {
  return `aadm-${desktopId}`;
}

export function workspaceDirForDesktop(
  workspaceRootDir: string,
  desktopId: string
) {
  return path.join(workspaceRootDir, desktopId);
}

export function desktopWorkspaceDir(desktopId: string) {
  return workspaceDirForDesktop(config.workspaceRootDir, desktopId);
}

export function managerTerminalWebsocketPath(desktopId: string) {
  return `/_aadm/terminal/${desktopId}/ws`;
}

export function terminalMetadataForDesktop(desktop: {
  id: string;
  display: number;
  workspaceDir?: string;
  terminalSessionName?: string;
}) {
  return {
    sessionName: desktop.terminalSessionName ?? terminalSessionName(desktop.id),
    workspaceDir: desktop.workspaceDir ?? desktopWorkspaceDir(desktop.id),
    websocketPath: managerTerminalWebsocketPath(desktop.id),
    websocketUrl: managerTerminalWebsocketPath(desktop.id)
  };
}

async function tmuxSessionExists(sessionName: string) {
  await ensureTmuxConfig();
  const result = await execCmd(
    config.tmuxBin,
    tmuxArgs(['has-session', '-t', sessionName]),
    {
      env: TERMINAL_ENV
    }
  );
  return result.code === 0;
}

function throwOnTmuxFailure(
  operation: string,
  result: { code: number; stdout: string; stderr: string }
) {
  if (result.code === 0) return;
  throw new Error(
    `${operation}:${(result.stderr || result.stdout || `exit_code_${result.code}`).trim()}`
  );
}

export async function ensureWorkspaceDir(workspaceDir: string) {
  await fs.mkdir(workspaceDir, { recursive: true });
}

export async function ensureTmuxSession(
  sessionName: string,
  workspaceDir: string
) {
  await ensureTmuxConfig();
  if (await tmuxSessionExists(sessionName)) {
    return { created: false };
  }

  throwOnTmuxFailure(
    'tmux_new_session_failed',
    await execCmd(
      config.tmuxBin,
      tmuxArgs([
        'new-session',
        '-d',
        '-s',
        sessionName,
        '-c',
        workspaceDir,
        '-n',
        TERMINAL_WINDOW_NAMES[0],
        TMUX_WINDOW_COMMAND
      ]),
      {
        env: TERMINAL_ENV
      }
    )
  );

  for (const windowName of TERMINAL_WINDOW_NAMES.slice(1)) {
    throwOnTmuxFailure(
      'tmux_new_window_failed',
      await execCmd(
        config.tmuxBin,
        tmuxArgs([
          'new-window',
          '-d',
          '-t',
          sessionName,
          '-c',
          workspaceDir,
          '-n',
          windowName,
          TMUX_WINDOW_COMMAND
        ]),
        {
          env: TERMINAL_ENV
        }
      )
    );
  }

  return { created: true };
}

export async function killTmuxSession(sessionName: string) {
  await ensureTmuxConfig();
  const result = await execCmd(
    config.tmuxBin,
    tmuxArgs(['kill-session', '-t', sessionName]),
    {
      env: TERMINAL_ENV
    }
  );
  if (result.code === 0) {
    return { ok: true };
  }

  if (/can't find session/i.test(result.stderr || result.stdout)) {
    return { ok: true };
  }

  return {
    ok: false,
    error: result.stderr || result.stdout || 'kill_session_failed'
  };
}

export async function isTmuxSessionActive(sessionName: string) {
  return await tmuxSessionExists(sessionName);
}

export async function resizeTmuxSession(
  sessionName: string,
  cols: number,
  rows: number
) {
  await ensureTmuxConfig();
  return await execCmd(
    config.tmuxBin,
    tmuxArgs([
      'resize-window',
      '-t',
      sessionName,
      '-x',
      String(cols),
      '-y',
      String(rows)
    ]),
    {
      env: TERMINAL_ENV
    }
  );
}

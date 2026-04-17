import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import {
  normalizeDesktopRouteAuth,
  type DesktopRouteAuth
} from './route-auth.js';
import {
  managerTerminalWebsocketPath,
  desktopWorkspaceDir,
  terminalSessionName
} from './terminal.js';

export type DesktopRecord = {
  id: string;
  owner?: string;
  label?: string;
  ttlMinutes?: number;
  createdAt: number;
  expiresAt?: number;
  status: 'running' | 'stopped' | 'error';
  display: number;
  vncPort: number;
  wsPort: number;
  cdpPort: number;
  aabPort: number;
  novncUrl: string;
  aabUrl: string;
  workspaceDir: string;
  terminalSessionName: string;
  terminalWebsocketPath: string;
  terminalWebsocketUrl: string;
  startUrl?: string;
  routeAuth: DesktopRouteAuth;
};

export type State = { desktops: DesktopRecord[] };

const stateDir = path.resolve(config.stateDir);
const statePath = path.join(stateDir, 'state.json');

type SaveStateHook = (
  state: State,
  next: (state: State) => Promise<void>
) => Promise<void>;

let saveStateHook: SaveStateHook | undefined;

function normalizedTerminalWebsocketPath(desktopId: string): string {
  return managerTerminalWebsocketPath(desktopId);
}

async function ensure() {
  await fs.mkdir(stateDir, { recursive: true });
}

export async function loadState(): Promise<State> {
  await ensure();
  try {
    const raw = await fs.readFile(statePath, 'utf-8');
    const parsed = JSON.parse(raw);
    const desktops: Array<Record<string, unknown>> = Array.isArray(
      parsed.desktops
    )
      ? parsed.desktops
      : [];
    return {
      desktops: desktops.map(
        (desktop): DesktopRecord =>
          ({
            ...(desktop as DesktopRecord),
            workspaceDir:
              typeof desktop.workspaceDir === 'string' && desktop.workspaceDir
                ? desktop.workspaceDir
                : desktopWorkspaceDir(String(desktop.id ?? '')),
            terminalSessionName:
              typeof desktop.terminalSessionName === 'string' &&
              desktop.terminalSessionName
                ? desktop.terminalSessionName
                : terminalSessionName(String(desktop.id ?? '')),
            terminalWebsocketPath: normalizedTerminalWebsocketPath(
              String(desktop.id ?? '')
            ),
            terminalWebsocketUrl: normalizedTerminalWebsocketPath(
              String(desktop.id ?? '')
            ),
            routeAuth: normalizeDesktopRouteAuth(desktop.routeAuth) ?? {
              mode: 'none'
            }
          }) as DesktopRecord
      )
    };
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code === 'ENOENT')
      return { desktops: [] };
    throw e;
  }
}

async function writeState(state: State) {
  await ensure();
  const tmp = path.join(stateDir, `.state.${process.pid}.${Date.now()}.tmp`);
  await fs.writeFile(tmp, JSON.stringify(state, null, 2), 'utf-8');
  await fs.rename(tmp, statePath);
}

export async function saveState(state: State) {
  if (saveStateHook) {
    return await saveStateHook(state, writeState);
  }
  await writeState(state);
}

export function nowMs() {
  return Date.now();
}

export function getStateDir() {
  return stateDir;
}

export function getStatePath() {
  return statePath;
}

export function setSaveStateHook(hook?: SaveStateHook) {
  saveStateHook = hook;
}

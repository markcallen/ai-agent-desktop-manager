import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';

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
  startUrl?: string;
};

export type State = { desktops: DesktopRecord[] };

const stateDir = path.resolve(config.stateDir);
const statePath = path.join(stateDir, 'state.json');

type SaveStateHook = (
  state: State,
  next: (state: State) => Promise<void>
) => Promise<void>;

let saveStateHook: SaveStateHook | undefined;

async function ensure() {
  await fs.mkdir(stateDir, { recursive: true });
}

export async function loadState(): Promise<State> {
  await ensure();
  try {
    const raw = await fs.readFile(statePath, 'utf-8');
    const parsed = JSON.parse(raw);
    return { desktops: Array.isArray(parsed.desktops) ? parsed.desktops : [] };
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

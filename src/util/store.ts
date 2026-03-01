import fs from "node:fs/promises";
import path from "node:path";

export type DesktopRecord = {
  id: string;
  owner?: string;
  label?: string;
  ttlMinutes?: number;
  createdAt: number;
  expiresAt?: number;
  status: "running" | "stopped" | "error";
  display: number;
  vncPort: number;
  wsPort: number;
  cdpPort: number;
  aabPort: number;
  novncUrl: string;
  aabUrl: string;
  startUrl?: string;
};

type State = { desktops: DesktopRecord[] };

const dataDir = path.resolve("data");
const statePath = path.join(dataDir, "state.json");

async function ensure() {
  await fs.mkdir(dataDir, { recursive: true });
}

export async function loadState(): Promise<State> {
  await ensure();
  try {
    const raw = await fs.readFile(statePath, "utf-8");
    const parsed = JSON.parse(raw);
    return { desktops: Array.isArray(parsed.desktops) ? parsed.desktops : [] };
  } catch (e: any) {
    if (e?.code === "ENOENT") return { desktops: [] };
    throw e;
  }
}

export async function saveState(state: State) {
  await ensure();
  await fs.writeFile(statePath, JSON.stringify(state, null, 2), "utf-8");
}

export function nowMs() {
  return Date.now();
}

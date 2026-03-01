import { config } from "./config.js";
import type { DesktopRecord } from "./store.js";

export type Allocation = {
  display: number;
  vncPort: number;
  wsPort: number;
  cdpPort: number;
  aabPort: number;
};

function range(min: number, max: number) {
  const r: number[] = [];
  for (let i = min; i <= max; i++) r.push(i);
  return r;
}

export function allocate(existing: DesktopRecord[]): Allocation {
  const usedDisplays = new Set(existing.map((d) => d.display));
  const usedWs = new Set(existing.map((d) => d.wsPort));
  const usedCdp = new Set(existing.map((d) => d.cdpPort));
  const usedAab = new Set(existing.map((d) => d.aabPort));

  const display = range(config.displayMin, config.displayMax).find((n) => !usedDisplays.has(n));
  if (!display) throw new Error("no_free_display");

  const vncPort = 5900 + display;

  const wsPort = range(config.wsPortMin, config.wsPortMax).find((p) => !usedWs.has(p));
  if (!wsPort) throw new Error("no_free_websockify_port");

  const cdpPort = range(config.cdpPortMin, config.cdpPortMax).find((p) => !usedCdp.has(p));
  if (!cdpPort) throw new Error("no_free_cdp_port");

  const aabPort = range(config.aabPortMin, config.aabPortMax).find((p) => !usedAab.has(p));
  if (!aabPort) throw new Error("no_free_aab_port");

  return { display, vncPort, wsPort, cdpPort, aabPort };
}

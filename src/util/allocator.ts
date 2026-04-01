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

  const display = range(config.displayMin, config.displayMax).find((n) => !usedDisplays.has(n));
  if (!display) throw new Error("no_free_display");

  const offset = display - config.displayMin;
  const vncPort = 5900 + display;
  const wsPort = config.wsPortMin + offset;
  const cdpPort = config.cdpPortMin + offset;
  const aabPort = config.aabPortMin + offset;

  return { display, vncPort, wsPort, cdpPort, aabPort };
}

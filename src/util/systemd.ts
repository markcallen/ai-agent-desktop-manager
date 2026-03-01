import { config } from "./config.js";
import { execCmd } from "./exec.js";

export async function systemctlStart(unit: string) {
  return await execCmd(config.systemctlBin, ["start", unit], { sudo: true });
}

export async function systemctlStop(unit: string) {
  return await execCmd(config.systemctlBin, ["stop", unit], { sudo: true });
}

export async function systemctlIsActive(unit: string) {
  return await execCmd(config.systemctlBin, ["is-active", unit], { sudo: true });
}

export function unitName(prefix: string, id: number) {
  // prefixes are like "vnc@"; systemd unit becomes "vnc@3"
  return `${prefix}${id}`;
}

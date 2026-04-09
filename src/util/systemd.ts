import { config } from './config.js';
import { execCmd } from './exec.js';

function throwOnFailure(
  op: string,
  unit: string,
  code: number,
  stderr: string,
  stdout: string
) {
  if (code === 0) return;
  const details = (stderr || stdout || '').trim();
  throw new Error(`${op}_failed:${unit}: ${details || `exit_code_${code}`}`);
}

export async function systemctlStart(
  unit: string,
  extraEnv?: Record<string, string>
) {
  const args = ['start', unit];
  const res = await execCmd(config.systemctlBin, args, {
    sudo: true,
    ...(extraEnv && { env: extraEnv })
  });
  throwOnFailure('systemctl_start', unit, res.code, res.stderr, res.stdout);
  return res;
}

export async function systemctlStop(unit: string) {
  const res = await execCmd(config.systemctlBin, ['stop', unit], {
    sudo: true
  });
  throwOnFailure('systemctl_stop', unit, res.code, res.stderr, res.stdout);
  return res;
}

export async function systemctlIsActive(unit: string) {
  return await execCmd(config.systemctlBin, ['is-active', unit], {
    sudo: true
  });
}

export function unitName(prefix: string, id: number) {
  // prefixes are like "vnc@"; systemd unit becomes "vnc@3"
  return `${prefix}${id}`;
}

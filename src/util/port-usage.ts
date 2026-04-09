import { config } from './config.js';
import { execCmd } from './exec.js';

function parsePortFromLocalAddress(value: string) {
  const trimmed = value.trim();
  const match = trimmed.match(/:(\d+)$/);
  if (!match) return undefined;

  const port = Number(match[1]);
  if (!Number.isInteger(port) || port <= 0) return undefined;
  return port;
}

export function parseListeningTcpPorts(output: string) {
  const ports = new Set<number>();

  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const parts = trimmed.split(/\s+/);
    const localAddress = parts[3];
    if (!localAddress) continue;

    const port = parsePortFromLocalAddress(localAddress);
    if (port) ports.add(port);
  }

  return ports;
}

export async function findPortCollisions(ports: number[]) {
  const result = await execCmd('ss', ['-lntH']);
  if (result.code !== 0) {
    throw new Error(`ss_failed:${(result.stderr || result.stdout).trim()}`);
  }

  const listeningPorts = parseListeningTcpPorts(result.stdout);
  return ports.filter((port) => listeningPorts.has(port));
}

export function portsForDesktop(display: number, vncPort: number) {
  const offset = display - config.displayMin;
  return [
    vncPort,
    config.wsPortMin + offset,
    config.cdpPortMin + offset,
    config.aabPortMin + offset
  ];
}

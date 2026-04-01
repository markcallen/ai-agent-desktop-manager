import net from "node:net";

export type PortChecker = (host: string, port: number, timeoutMs?: number) => Promise<boolean>;

async function defaultPortChecker(host: string, port: number, timeoutMs = 250): Promise<boolean> {
  return await new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;

    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(ok);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, host);
  });
}

let portChecker: PortChecker = defaultPortChecker;

export async function isPortOpen(host: string, port: number, timeoutMs = 250): Promise<boolean> {
  return portChecker(host, port, timeoutMs);
}

export function setPortChecker(next: PortChecker) {
  portChecker = next;
}

export function resetPortChecker() {
  portChecker = defaultPortChecker;
}

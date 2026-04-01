import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { execCmd } from "./exec.js";

export function snippetFilename(desktopId: string) {
  return path.join(config.nginxSnippetDir, `${desktopId}.conf`);
}

export function buildSnippet(display: number, wsPort: number) {
  const prefix = config.novncPathPrefix.replace(/\/$/, "");
  const loc = `${prefix}/${display}/`;
  const query = `path=${prefix.replace(/^\//, "")}/${display}/websockify&resize=remote&autoconnect=1`;
  // Redirect the bare desktop path to noVNC's HTML entrypoint.
  // Trailing slash in proxy_pass avoids path issues with noVNC assets.
  return `location = ${loc} {
  return 302 ${loc}vnc.html?${query};
}

location ${loc} {
  proxy_pass http://127.0.0.1:${wsPort}/;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_read_timeout 7d;
  proxy_send_timeout 7d;
}
`;
}

async function atomicWrite(filePath: string, content: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${Date.now()}`;
  await fs.writeFile(tmp, content, { encoding: "utf-8", mode: 0o644 });
  await fs.rename(tmp, filePath);
}

export async function writeSnippet(desktopId: string, content: string) {
  const fp = snippetFilename(desktopId);
  await atomicWrite(fp, content);
  return fp;
}

export async function removeSnippet(desktopId: string) {
  const fp = snippetFilename(desktopId);
  try {
    await fs.unlink(fp);
  } catch (e: any) {
    if (e?.code !== "ENOENT") throw e;
  }
}

export async function nginxTest(): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const r = await execCmd(config.nginxBin, ["-t"], { sudo: true });
  return { ok: r.code === 0, stdout: r.stdout, stderr: r.stderr };
}

export async function nginxReload(): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const r = await execCmd(config.systemctlBin, ["reload", "nginx"], { sudo: true });
  return { ok: r.code === 0, stdout: r.stdout, stderr: r.stderr };
}

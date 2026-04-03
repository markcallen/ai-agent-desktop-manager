import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { execCmd } from './exec.js';
import type { DesktopRouteAuth } from './route-auth.js';

export function snippetFilename(desktopId: string) {
  return path.join(config.nginxSnippetDir, `${desktopId}.conf`);
}

function headerNameToNginxVariable(headerName: string) {
  return `$http_${headerName.toLowerCase().replace(/-/g, '_')}`;
}

function authRequestLocation(desktopId: string) {
  return `/_aadm/auth/${desktopId}`;
}

function buildAuthRequestBlock(
  desktopId: string,
  routeAuth: Extract<DesktopRouteAuth, { mode: 'auth_request' }>
) {
  const forwardedHeaders = routeAuth.authRequest.forwardedHeaders
    .map(
      (headerName) =>
        `  proxy_set_header ${headerName} ${headerNameToNginxVariable(headerName)};`
    )
    .join('\n');

  return `location = ${authRequestLocation(desktopId)} {
  internal;
  proxy_pass ${routeAuth.authRequest.url};
  proxy_pass_request_body off;
  proxy_set_header Content-Length "";
  proxy_set_header X-Original-URI $request_uri;
  proxy_set_header X-Original-Method $request_method;
  proxy_set_header X-Forwarded-Host $host;
  proxy_set_header X-Forwarded-Proto $scheme;
${forwardedHeaders ? `${forwardedHeaders}\n` : ''}}
`;
}

export function buildSnippet(
  desktopId: string,
  display: number,
  wsPort: number,
  routeAuth: DesktopRouteAuth = { mode: 'none' }
) {
  const prefix = config.novncPathPrefix.replace(/\/$/, '');
  const loc = `${prefix}/${display}/`;
  const query = `path=${prefix.replace(/^\//, '')}/${display}/websockify&resize=remote&autoconnect=1`;
  const authLine =
    routeAuth.mode === 'auth_request'
      ? `  auth_request ${authRequestLocation(desktopId)};\n`
      : '';
  // Redirect the bare desktop path to noVNC's HTML entrypoint.
  // Protected routes proxy directly to vnc.html so auth_request runs on the entry request.
  const entryLocation =
    routeAuth.mode === 'auth_request'
      ? `location = ${loc} {
${authLine}  proxy_pass http://127.0.0.1:${wsPort}/vnc.html?${query};
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_read_timeout 7d;
  proxy_send_timeout 7d;
}

`
      : `location = ${loc} {
  return 302 ${loc}vnc.html?${query};
}

`;

  // Trailing slash in proxy_pass avoids path issues with noVNC assets.
  return `${routeAuth.mode === 'auth_request' ? buildAuthRequestBlock(desktopId, routeAuth) : ''}${entryLocation}location ${loc} {
${authLine}  proxy_pass http://127.0.0.1:${wsPort}/;
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
  await fs.writeFile(tmp, content, { encoding: 'utf-8', mode: 0o644 });
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
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code !== 'ENOENT') throw e;
  }
}

export async function nginxTest(): Promise<{
  ok: boolean;
  stdout: string;
  stderr: string;
}> {
  const r = await execCmd(config.nginxBin, ['-t'], { sudo: true });
  return { ok: r.code === 0, stdout: r.stdout, stderr: r.stderr };
}

export async function nginxReload(): Promise<{
  ok: boolean;
  stdout: string;
  stderr: string;
}> {
  const r = await execCmd(config.systemctlBin, ['reload', 'nginx'], {
    sudo: true
  });
  return { ok: r.code === 0, stdout: r.stdout, stderr: r.stderr };
}

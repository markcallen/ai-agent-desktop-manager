import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { execCmd } from './exec.js';
import {
  normalizeAuthRequestUrl,
  normalizeForwardedHeaderName,
  type DesktopRouteAuth
} from './route-auth.js';

export function snippetFilename(desktopId: string) {
  return path.join(config.nginxSnippetDir, `${desktopId}.conf`);
}

function headerNameToNginxVariable(headerName: string) {
  return `$http_${headerName.toLowerCase().replace(/-/g, '_')}`;
}

function authRequestLocation(desktopId: string) {
  return `/_aadm/auth/${desktopId}`;
}

function managerBaseUrl() {
  return `http://127.0.0.1:${config.port}`;
}

function buildAuthRequestBlock(
  desktopId: string,
  routeAuth: Extract<DesktopRouteAuth, { mode: 'auth_request' }>
) {
  const normalizedUrl = normalizeAuthRequestUrl(routeAuth.authRequest.url);
  if (!normalizedUrl) {
    throw new Error('invalid_route_auth:auth_request_url');
  }

  const forwardedHeaders = routeAuth.authRequest.forwardedHeaders
    .map((headerName) => normalizeForwardedHeaderName(headerName))
    .filter((headerName): headerName is string => Boolean(headerName))
    .map(
      (headerName) =>
        `  proxy_set_header ${headerName} ${headerNameToNginxVariable(headerName)};`
    )
    .join('\n');

  return `location = ${authRequestLocation(desktopId)} {
  internal;
  proxy_pass ${normalizedUrl};
  proxy_pass_request_body off;
  proxy_set_header Content-Length "";
  proxy_set_header X-Original-URI $request_uri;
  proxy_set_header X-Original-Method $request_method;
  proxy_set_header X-Forwarded-Host $host;
  proxy_set_header X-Forwarded-Proto $scheme;
${forwardedHeaders ? `${forwardedHeaders}\n` : ''}}
`;
}

function buildTokenAuthBlock(desktopId: string) {
  return `location = ${authRequestLocation(desktopId)} {
  internal;
  proxy_pass ${managerBaseUrl()}/_aadm/verify/${desktopId};
  proxy_pass_request_body off;
  proxy_set_header Content-Length "";
  proxy_set_header Cookie $http_cookie;
  proxy_set_header X-Original-URI $request_uri;
  proxy_set_header X-Original-Method $request_method;
  proxy_set_header X-Forwarded-Host $host;
  proxy_set_header X-Forwarded-Proto $scheme;
}
`;
}

function buildTokenAccessLocation(desktopId: string, display: number) {
  const prefix = config.novncPathPrefix.replace(/\/$/, '');
  const loc = `${prefix}/${display}`;

  return `location = ${loc}/access {
  proxy_pass ${managerBaseUrl()}/_aadm/access/${desktopId}$is_args$args;
  proxy_set_header X-Forwarded-Host $host;
  proxy_set_header X-Forwarded-Proto $scheme;
}

`;
}

function buildDesktopShellLocation(
  desktopId: string,
  display: number,
  routeAuth: DesktopRouteAuth
) {
  const prefix = config.novncPathPrefix.replace(/\/$/, '');
  const loc = `${prefix}/${display}/`;
  const authLine =
    routeAuth.mode === 'auth_request' || routeAuth.mode === 'token'
      ? `  auth_request ${authRequestLocation(desktopId)};\n`
      : '';

  return `location = ${loc} {
${authLine}  proxy_pass ${managerBaseUrl()}/_aadm/desktop/${desktopId};
  proxy_set_header X-Forwarded-Host $host;
  proxy_set_header X-Forwarded-Proto $scheme;
}

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
  const authLine =
    routeAuth.mode === 'auth_request' || routeAuth.mode === 'token'
      ? `  auth_request ${authRequestLocation(desktopId)};\n`
      : '';
  const shellLocation = buildDesktopShellLocation(
    desktopId,
    display,
    routeAuth
  );

  // Trailing slash in proxy_pass avoids path issues with noVNC assets.
  const routePrelude =
    routeAuth.mode === 'auth_request'
      ? buildAuthRequestBlock(desktopId, routeAuth)
      : routeAuth.mode === 'token'
        ? `${buildTokenAuthBlock(desktopId)}${buildTokenAccessLocation(desktopId, display)}`
        : '';

  return `${routePrelude}${shellLocation}location ${loc} {
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

/** Build a one-time global snippet for shared AADM paths (e.g. Vite assets). */
export function buildGlobalSnippet() {
  const base = managerBaseUrl();
  return `# Auto-generated by ai-agent-desktop-manager — do not edit manually.

# Vite SPA assets (longer prefix wins over the /_aadm/ catch-all below).
location ^~ /_aadm/desktop-app/ {
  proxy_pass ${base}/_aadm/desktop-app/;
  proxy_set_header X-Forwarded-Host $host;
  proxy_set_header X-Forwarded-Proto $scheme;
}

# AADM manager API and WebSocket endpoints (desktop HTML, config, terminal WS, bridge WS).
location ^~ /_aadm/ {
  proxy_pass ${base}/_aadm/;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header X-Forwarded-Host $host;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_read_timeout 7d;
  proxy_send_timeout 7d;
}
`;
}

export async function writeGlobalSnippet() {
  const fp = path.join(config.nginxSnippetDir, '_global.conf');
  await atomicWrite(fp, buildGlobalSnippet());
  return fp;
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

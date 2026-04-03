import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'node:path';
import {
  RouteAuthModeSchema,
  parseForwardedHeaderNames
} from './route-auth.js';

dotenv.config();

const intFromEnv = (key: string, fallback: number) => {
  const raw = process.env[key];
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return fallback;
  return n;
};

export const Config = z.object({
  host: z.string().default('127.0.0.1'),
  port: z.number().int().default(8899),

  authToken: z.string().optional(),
  desktopRouteAuthMode: RouteAuthModeSchema.default('none'),
  desktopRouteAuthRequestUrl: z.string().url().optional(),
  desktopRouteAuthRequestHeaders: z.array(z.string()).default([]),

  publicBaseUrl: z.string().url().default('https://host.example.com'),

  nginxSnippetDir: z.string().default('/etc/nginx/conf.d/agent-desktops'),
  nginxBin: z.string().default('/usr/sbin/nginx'),
  systemctlBin: z.string().default('/bin/systemctl'),
  stateDir: z.string().default(path.resolve('data')),

  novncPathPrefix: z.string().default('/desktop'),

  displayMin: z.number().int().default(1),
  displayMax: z.number().int().default(50),

  wsPortMin: z.number().int().default(6081),
  wsPortMax: z.number().int().default(6150),

  cdpPortMin: z.number().int().default(9222),
  cdpPortMax: z.number().int().default(9299),

  aabPortMin: z.number().int().default(8765),
  aabPortMax: z.number().int().default(8849),

  unitVnc: z.string().default('vnc@'),
  unitWebsockify: z.string().default('websockify@'),
  unitChrome: z.string().default('chrome@'),
  unitAab: z.string().default('aab@')
});

export const config = Config.parse({
  host: process.env.AADM_HOST ?? '127.0.0.1',
  port: intFromEnv('AADM_PORT', 8899),

  authToken: process.env.AADM_AUTH_TOKEN || undefined,
  desktopRouteAuthMode: process.env.AADM_DESKTOP_ROUTE_AUTH_MODE ?? 'none',
  desktopRouteAuthRequestUrl:
    process.env.AADM_DESKTOP_ROUTE_AUTH_REQUEST_URL || undefined,
  desktopRouteAuthRequestHeaders: parseForwardedHeaderNames(
    process.env.AADM_DESKTOP_ROUTE_AUTH_REQUEST_HEADERS
  ),

  publicBaseUrl: process.env.AADM_PUBLIC_BASE_URL ?? 'https://host.example.com',

  nginxSnippetDir:
    process.env.AADM_NGINX_SNIPPET_DIR ?? '/etc/nginx/conf.d/agent-desktops',
  nginxBin: process.env.AADM_NGINX_BIN ?? '/usr/sbin/nginx',
  systemctlBin: process.env.AADM_SYSTEMCTL_BIN ?? '/bin/systemctl',
  stateDir: process.env.AADM_STATE_DIR ?? path.resolve('data'),

  novncPathPrefix: process.env.AADM_NOVNC_PATH_PREFIX ?? '/desktop',

  displayMin: intFromEnv('AADM_DISPLAY_MIN', 1),
  displayMax: intFromEnv('AADM_DISPLAY_MAX', 50),

  wsPortMin: intFromEnv('AADM_WEBSOCKIFY_PORT_MIN', 6081),
  wsPortMax: intFromEnv('AADM_WEBSOCKIFY_PORT_MAX', 6150),

  cdpPortMin: intFromEnv('AADM_CDP_PORT_MIN', 9222),
  cdpPortMax: intFromEnv('AADM_CDP_PORT_MAX', 9299),

  aabPortMin: intFromEnv('AADM_AAB_PORT_MIN', 8765),
  aabPortMax: intFromEnv('AADM_AAB_PORT_MAX', 8849),

  unitVnc: process.env.AADM_UNIT_VNC ?? 'vnc@',
  unitWebsockify: process.env.AADM_UNIT_WEBSOCKIFY ?? 'websockify@',
  unitChrome: process.env.AADM_UNIT_CHROME ?? 'chrome@',
  unitAab: process.env.AADM_UNIT_AAB ?? 'aab@'
});

function validateConfig() {
  const checkRange = (name: string, min: number, max: number) => {
    if (min > max) {
      throw new Error(`invalid_config:${name}:min_gt_max (${min} > ${max})`);
    }
  };

  checkRange('display', config.displayMin, config.displayMax);
  checkRange('websockify_port', config.wsPortMin, config.wsPortMax);
  checkRange('cdp_port', config.cdpPortMin, config.cdpPortMax);
  checkRange('aab_port', config.aabPortMin, config.aabPortMax);

  const displaySpan = config.displayMax - config.displayMin;
  const wsNeededMax = config.wsPortMin + displaySpan;
  const cdpNeededMax = config.cdpPortMin + displaySpan;
  const aabNeededMax = config.aabPortMin + displaySpan;

  if (wsNeededMax > config.wsPortMax) {
    throw new Error(
      `invalid_config:websockify_range_too_small (need max >= ${wsNeededMax}, got ${config.wsPortMax})`
    );
  }
  if (cdpNeededMax > config.cdpPortMax) {
    throw new Error(
      `invalid_config:cdp_range_too_small (need max >= ${cdpNeededMax}, got ${config.cdpPortMax})`
    );
  }
  if (aabNeededMax > config.aabPortMax) {
    throw new Error(
      `invalid_config:aab_range_too_small (need max >= ${aabNeededMax}, got ${config.aabPortMax})`
    );
  }

  if (
    config.desktopRouteAuthMode === 'auth_request' &&
    !config.desktopRouteAuthRequestUrl
  ) {
    throw new Error('invalid_config:desktop_route_auth_request_url_required');
  }
}

validateConfig();

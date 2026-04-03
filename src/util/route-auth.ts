import crypto from 'node:crypto';
import { z } from 'zod';

export const RouteAuthModeSchema = z.enum(['none', 'auth_request', 'token']);
export type RouteAuthMode = z.infer<typeof RouteAuthModeSchema>;

export const RouteAuthRequestModeSchema = z.enum([
  'inherit',
  'none',
  'auth_request',
  'token'
]);
export type RouteAuthRequestMode = z.infer<typeof RouteAuthRequestModeSchema>;

export type DesktopRouteAuth =
  | { mode: 'none' }
  | {
      mode: 'auth_request';
      authRequest: {
        url: string;
        forwardedHeaders: string[];
      };
    }
  | {
      mode: 'token';
      token: {
        ttlSeconds: number;
      };
    };

export type RouteAuthConfig = {
  desktopRouteAuthMode: RouteAuthMode;
  desktopRouteAuthRequestUrl?: string;
  desktopRouteAuthRequestHeaders: string[];
  desktopRouteTokenSecret?: string;
  desktopRouteTokenTtlSeconds: number;
};

export const DESKTOP_ACCESS_TOKEN_QUERY_PARAM = 'token';
const SAFE_HEADER_NAME = /^[A-Za-z0-9-]+$/;
const SAFE_COOKIE_NAME = /^[A-Za-z0-9_]+$/;
const MIN_TOKEN_TTL_SECONDS = 1;
const MAX_TOKEN_TTL_SECONDS = 86_400;

type DesktopAccessTokenPayload = {
  d: string;
  e: number;
};

export type VerifiedDesktopAccessToken = {
  desktopId: string;
  expiresAt: number;
};

function hasUnsafeNginxDirectiveChars(value: string) {
  for (const char of value) {
    if (/\s/.test(char) || char === ';' || char === '{' || char === '}') {
      return true;
    }

    const code = char.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }

  return false;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}

function base64UrlEncode(value: string) {
  return Buffer.from(value, 'utf-8').toString('base64url');
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, 'base64url').toString('utf-8');
}

function signDesktopAccessPayload(encodedPayload: string, secret: string) {
  return crypto
    .createHmac('sha256', secret)
    .update(encodedPayload)
    .digest('base64url');
}

function parsePositiveInt(
  value: unknown,
  min = MIN_TOKEN_TTL_SECONDS,
  max = MAX_TOKEN_TTL_SECONDS
) {
  if (typeof value !== 'number' || !Number.isInteger(value)) return undefined;
  if (value < min || value > max) return undefined;
  return value;
}

export function normalizeForwardedHeaderName(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized || !SAFE_HEADER_NAME.test(normalized)) return undefined;
  return normalized;
}

export function sanitizeForwardedHeaderNames(values: string[]) {
  return uniqueStrings(
    values
      .map((value) => normalizeForwardedHeaderName(value))
      .filter((value): value is string => Boolean(value))
  );
}

export function parseForwardedHeaderNames(raw: string | undefined) {
  if (!raw) return [];

  return sanitizeForwardedHeaderNames(raw.split(','));
}

export function normalizeAuthRequestUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed || hasUnsafeNginxDirectiveChars(trimmed)) return undefined;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return undefined;
    }
    return parsed.toString();
  } catch {
    return undefined;
  }
}

export function normalizeDesktopRouteTokenTtlSeconds(value: unknown) {
  return parsePositiveInt(value);
}

export function desktopAccessCookieName(desktopId: string) {
  const normalized = `aadm_desktop_access_${desktopId.replace(/[^A-Za-z0-9_]/g, '_')}`;
  if (!SAFE_COOKIE_NAME.test(normalized)) {
    throw new Error('invalid_route_auth:cookie_name');
  }
  return normalized;
}

export function createDesktopAccessToken(
  desktopId: string,
  secret: string,
  ttlSeconds: number,
  issuedAtMs = Date.now()
) {
  const normalizedTtlSeconds = normalizeDesktopRouteTokenTtlSeconds(ttlSeconds);
  if (!normalizedTtlSeconds) {
    throw new Error('invalid_route_auth:token_ttl_seconds');
  }

  const payload: DesktopAccessTokenPayload = {
    d: desktopId,
    e: issuedAtMs + normalizedTtlSeconds * 1000
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = signDesktopAccessPayload(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

export function verifyDesktopAccessToken(
  token: string,
  desktopId: string,
  secret: string,
  nowMs = Date.now()
): VerifiedDesktopAccessToken | undefined {
  const [encodedPayload, signature] = token.split('.');
  if (!encodedPayload || !signature) return undefined;

  const expectedSignature = signDesktopAccessPayload(encodedPayload, secret);
  const expectedBuffer = Buffer.from(expectedSignature);
  const actualBuffer = Buffer.from(signature);
  if (expectedBuffer.length !== actualBuffer.length) return undefined;
  if (!crypto.timingSafeEqual(expectedBuffer, actualBuffer)) return undefined;

  try {
    const payload = JSON.parse(
      base64UrlDecode(encodedPayload)
    ) as DesktopAccessTokenPayload;
    if (payload.d !== desktopId) return undefined;
    if (!Number.isInteger(payload.e) || payload.e <= nowMs) return undefined;

    return { desktopId: payload.d, expiresAt: payload.e };
  } catch {
    return undefined;
  }
}

export function normalizeDesktopRouteAuth(
  value: unknown
): DesktopRouteAuth | undefined {
  if (!value || typeof value !== 'object') return undefined;

  const candidate = value as {
    mode?: unknown;
    authRequest?: { url?: unknown; forwardedHeaders?: unknown };
    token?: { ttlSeconds?: unknown };
  };

  if (candidate.mode === 'auth_request') {
    const url = candidate.authRequest?.url;
    if (typeof url !== 'string' || !url) return undefined;

    const forwardedHeaders = Array.isArray(
      candidate.authRequest?.forwardedHeaders
    )
      ? candidate.authRequest.forwardedHeaders.filter(
          (header): header is string =>
            typeof header === 'string' && header.length > 0
        )
      : [];
    const normalizedUrl = normalizeAuthRequestUrl(url);
    if (!normalizedUrl) return undefined;

    return {
      mode: 'auth_request',
      authRequest: {
        url: normalizedUrl,
        forwardedHeaders: sanitizeForwardedHeaderNames(forwardedHeaders)
      }
    };
  }

  if (candidate.mode === 'token') {
    const ttlSeconds = normalizeDesktopRouteTokenTtlSeconds(
      candidate.token?.ttlSeconds
    );
    if (!ttlSeconds) return undefined;

    return {
      mode: 'token',
      token: {
        ttlSeconds
      }
    };
  }

  if (candidate.mode === 'none') {
    return { mode: 'none' };
  }

  return undefined;
}

export function defaultDesktopRouteAuth(
  routeAuthConfig: RouteAuthConfig
): DesktopRouteAuth {
  if (routeAuthConfig.desktopRouteAuthMode === 'auth_request') {
    const normalizedUrl = routeAuthConfig.desktopRouteAuthRequestUrl
      ? normalizeAuthRequestUrl(routeAuthConfig.desktopRouteAuthRequestUrl)
      : undefined;
    if (!normalizedUrl) {
      throw new Error('invalid_config:desktop_route_auth_request_url_required');
    }

    return {
      mode: 'auth_request',
      authRequest: {
        url: normalizedUrl,
        forwardedHeaders: sanitizeForwardedHeaderNames(
          routeAuthConfig.desktopRouteAuthRequestHeaders
        )
      }
    };
  }

  if (routeAuthConfig.desktopRouteAuthMode === 'token') {
    if (!routeAuthConfig.desktopRouteTokenSecret) {
      throw new Error('invalid_config:desktop_route_token_secret_required');
    }

    const ttlSeconds = normalizeDesktopRouteTokenTtlSeconds(
      routeAuthConfig.desktopRouteTokenTtlSeconds
    );
    if (!ttlSeconds) {
      throw new Error('invalid_config:desktop_route_token_ttl_seconds');
    }

    return {
      mode: 'token',
      token: {
        ttlSeconds
      }
    };
  }

  return { mode: 'none' };
}

export function resolveDesktopRouteAuth(
  routeAuthConfig: RouteAuthConfig,
  requestedMode?: RouteAuthRequestMode
): DesktopRouteAuth {
  if (!requestedMode || requestedMode === 'inherit') {
    return defaultDesktopRouteAuth(routeAuthConfig);
  }

  if (requestedMode === 'none') {
    return { mode: 'none' };
  }

  if (requestedMode === 'auth_request') {
    const normalizedUrl = routeAuthConfig.desktopRouteAuthRequestUrl
      ? normalizeAuthRequestUrl(routeAuthConfig.desktopRouteAuthRequestUrl)
      : undefined;
    if (!normalizedUrl) {
      throw new Error('invalid_config:desktop_route_auth_request_url_required');
    }

    return {
      mode: 'auth_request',
      authRequest: {
        url: normalizedUrl,
        forwardedHeaders: sanitizeForwardedHeaderNames(
          routeAuthConfig.desktopRouteAuthRequestHeaders
        )
      }
    };
  }

  if (!routeAuthConfig.desktopRouteTokenSecret) {
    throw new Error('invalid_config:desktop_route_token_secret_required');
  }

  const ttlSeconds = normalizeDesktopRouteTokenTtlSeconds(
    routeAuthConfig.desktopRouteTokenTtlSeconds
  );
  if (!ttlSeconds) {
    throw new Error('invalid_config:desktop_route_token_ttl_seconds');
  }

  return {
    mode: 'token',
    token: {
      ttlSeconds
    }
  };
}

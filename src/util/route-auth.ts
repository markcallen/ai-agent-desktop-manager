import { z } from 'zod';

export const RouteAuthModeSchema = z.enum(['none', 'auth_request']);
export type RouteAuthMode = z.infer<typeof RouteAuthModeSchema>;

export const RouteAuthRequestModeSchema = z.enum([
  'inherit',
  'none',
  'auth_request'
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
    };

export type RouteAuthConfig = {
  desktopRouteAuthMode: RouteAuthMode;
  desktopRouteAuthRequestUrl?: string;
  desktopRouteAuthRequestHeaders: string[];
};

const SAFE_HEADER_NAME = /^[A-Za-z0-9-]+$/;

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

export function normalizeDesktopRouteAuth(
  value: unknown
): DesktopRouteAuth | undefined {
  if (!value || typeof value !== 'object') return undefined;

  const candidate = value as {
    mode?: unknown;
    authRequest?: { url?: unknown; forwardedHeaders?: unknown };
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

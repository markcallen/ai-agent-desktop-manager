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

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}

export function parseForwardedHeaderNames(raw: string | undefined) {
  if (!raw) return [];

  return uniqueStrings(
    raw
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => value.toLowerCase())
  );
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

    return {
      mode: 'auth_request',
      authRequest: {
        url,
        forwardedHeaders: uniqueStrings(forwardedHeaders)
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
    if (!routeAuthConfig.desktopRouteAuthRequestUrl) {
      throw new Error('invalid_config:desktop_route_auth_request_url_required');
    }

    return {
      mode: 'auth_request',
      authRequest: {
        url: routeAuthConfig.desktopRouteAuthRequestUrl,
        forwardedHeaders: routeAuthConfig.desktopRouteAuthRequestHeaders
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

  if (!routeAuthConfig.desktopRouteAuthRequestUrl) {
    throw new Error('invalid_config:desktop_route_auth_request_url_required');
  }

  return {
    mode: 'auth_request',
    authRequest: {
      url: routeAuthConfig.desktopRouteAuthRequestUrl,
      forwardedHeaders: routeAuthConfig.desktopRouteAuthRequestHeaders
    }
  };
}

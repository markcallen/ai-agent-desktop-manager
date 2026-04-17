export interface DesktopConfig {
  desktop: {
    id: string;
    display: number;
    label: string;
    novncUrl: string;
  };
  terminal: {
    websocketUrl: string;
    websocketPath: string;
    sessionName: string;
    workspaceDir: string;
  };
  bridge: {
    enabled: boolean;
    websocketUrl: string;
    websocketPath: string;
    workspaceDir: string;
    defaultProvider: string;
    projectId: string;
  };
  browserLogsToken: string;
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized === '[::1]'
  );
}

function toWebSocketProtocol(protocol: string): string {
  return protocol === 'https:' ? 'wss:' : 'ws:';
}

export function resolveDesktopWebSocketUrl(
  websocketUrl: string,
  publicBaseUrl: string
): string {
  const publicUrl = new URL(publicBaseUrl);
  const publicWebSocketProtocol = toWebSocketProtocol(publicUrl.protocol);

  try {
    const absoluteUrl = new URL(websocketUrl);

    if (
      absoluteUrl.protocol === 'http:' ||
      absoluteUrl.protocol === 'https:'
    ) {
      absoluteUrl.protocol = toWebSocketProtocol(absoluteUrl.protocol);
    }

    if (
      (absoluteUrl.protocol === 'ws:' || absoluteUrl.protocol === 'wss:') &&
      isLoopbackHostname(absoluteUrl.hostname) &&
      !isLoopbackHostname(publicUrl.hostname)
    ) {
      absoluteUrl.protocol = publicWebSocketProtocol;
      absoluteUrl.hostname = publicUrl.hostname;
      absoluteUrl.port = publicUrl.port;
    }

    return absoluteUrl.toString();
  } catch {
    const resolvedUrl = new URL(websocketUrl, publicUrl);
    resolvedUrl.protocol = publicWebSocketProtocol;
    return resolvedUrl.toString();
  }
}

declare global {
  interface Window {
    __AADM_DESKTOP_ID__?: string;
  }
}

/** Extract the desktop ID from the current page URL.
 *  Priority:
 *  1. window.__AADM_DESKTOP_ID__ — injected by the server when served through
 *     nginx-proxied paths where the browser URL doesn't contain the desktop ID.
 *  2. _aadm_id query param — legacy fallback.
 *  3. /_aadm/desktop/<id> in the pathname — direct manager access.
 */
export function getDesktopIdFromUrl(): string | null {
  if (typeof window.__AADM_DESKTOP_ID__ === 'string') {
    return window.__AADM_DESKTOP_ID__;
  }
  const params = new URLSearchParams(window.location.search);
  const qp = params.get('_aadm_id');
  if (qp) return qp;

  const match = window.location.pathname.match(/\/_aadm\/desktop\/([^/]+)/);
  return match?.[1] ?? null;
}

export async function fetchDesktopConfig(
  desktopId: string
): Promise<DesktopConfig> {
  const resp = await fetch(`/_aadm/desktop/${desktopId}/config`, {
    headers: { Accept: 'application/json' }
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Config fetch failed: ${resp.status} ${text}`);
  }
  return resp.json() as Promise<DesktopConfig>;
}

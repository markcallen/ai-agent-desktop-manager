import { useCallback, useEffect, useRef, useState } from 'react';

export type SocketStatus =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error';

interface Options {
  websocketUrl: string;
  onOutput: (data: Uint8Array) => void;
  onStatus: (msg: string, isError?: boolean) => void;
  /** Do not open a connection while disabled. */
  disabled?: boolean;
}

interface Result {
  status: SocketStatus;
  sendInput: (data: string) => void;
  sendResize: (cols: number, rows: number) => void;
}

export function useTerminalSocket({
  websocketUrl,
  onOutput,
  onStatus,
  disabled = false
}: Options): Result {
  const [status, setStatus] = useState<SocketStatus>('connecting');
  const wsRef = useRef<WebSocket | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closedByCleanupRef = useRef(false);
  const onOutputRef = useRef(onOutput);
  const onStatusRef = useRef(onStatus);
  onOutputRef.current = onOutput;
  onStatusRef.current = onStatus;

  useEffect(() => {
    if (disabled) return;

    let active = true;
    closedByCleanupRef.current = false;

    function toAbsoluteWsUrl(url: string): string {
      if (url.startsWith('ws://') || url.startsWith('wss://')) return url;
      const base = new URL(url, window.location.origin + '/_aadm/');
      base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
      return base.toString();
    }

    function connect() {
      if (!active) return;
      const ws = new WebSocket(toAbsoluteWsUrl(websocketUrl));
      wsRef.current = ws;
      setStatus('connecting');

      ws.addEventListener('open', () => {
        if (!active) return;
        setStatus('connected');
        onStatusRef.current('Connected');
      });

      ws.addEventListener('message', (ev: MessageEvent<string>) => {
        if (!active) return;
        try {
          const msg = JSON.parse(ev.data) as Record<string, unknown>;
          if (msg.type === 'ready' && typeof msg.terminal === 'object') {
            const t = msg.terminal as Record<string, unknown>;
            onStatusRef.current(
              `Attached to tmux session ${String(t.sessionName ?? '')}`
            );
          } else if (msg.type === 'output' && typeof msg.data === 'string') {
            const bytes = Uint8Array.from(atob(msg.data), (c) =>
              c.charCodeAt(0)
            );
            onOutputRef.current(bytes);
          } else if (msg.type === 'exit') {
            onStatusRef.current('Session closed', true);
          } else if (msg.type === 'error') {
            onStatusRef.current(String(msg.error ?? 'Terminal error'), true);
          }
        } catch {
          // non-JSON message — ignore
        }
      });

      ws.addEventListener('close', () => {
        wsRef.current = null;
        if (!active) return;
        setStatus('disconnected');
        onStatusRef.current('Disconnected — reconnecting…', true);
        if (!closedByCleanupRef.current) {
          timerRef.current = setTimeout(connect, 2000);
        }
      });

      ws.addEventListener('error', () => {
        setStatus('error');
        onStatusRef.current('Connection error', true);
      });
    }

    connect();

    return () => {
      active = false;
      closedByCleanupRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [websocketUrl, disabled]);

  const sendInput = useCallback((data: string) => {
    wsRef.current?.readyState === WebSocket.OPEN &&
      wsRef.current.send(JSON.stringify({ type: 'input', data }));
  }, []);

  const sendResize = useCallback((cols: number, rows: number) => {
    wsRef.current?.readyState === WebSocket.OPEN &&
      wsRef.current.send(JSON.stringify({ type: 'resize', cols, rows }));
  }, []);

  return { status, sendInput, sendResize };
}

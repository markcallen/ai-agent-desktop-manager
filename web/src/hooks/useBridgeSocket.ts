import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ConnectionStatus,
  HealthResponseMsg,
  ProviderInfo
} from '../types/bridge';
import {
  acknowledgeBridgeSessionStart,
  beginBridgeSessionStart,
  clearBridgeSession,
  setBridgeSessionError,
  type BridgeSession
} from '../lib/bridge-session';

interface Options {
  websocketUrl: string;
  enabled: boolean;
  defaultProvider: string;
  projectId: string;
  onOutput: (data: Uint8Array) => void;
}

interface Result {
  connectionStatus: ConnectionStatus;
  session: BridgeSession | null;
  health: HealthResponseMsg | null;
  providers: ProviderInfo[];
  error: string | null;
  startSession: (
    provider: string,
    repoPath: string,
    cols: number,
    rows: number
  ) => void;
  stopSession: () => void;
  sendInput: (data: string) => void;
  sendResize: (cols: number, rows: number) => void;
}

export function useBridgeSocket({
  websocketUrl,
  enabled,
  defaultProvider,
  projectId,
  onOutput
}: Options): Result {
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>('connecting');
  const [session, setSession] = useState<BridgeSession | null>(null);
  const [health, setHealth] = useState<HealthResponseMsg | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionRef = useRef<BridgeSession | null>(null);
  const pendingStartRef = useRef<BridgeSession | null>(null);
  const closedByCleanupRef = useRef(false);
  const onOutputRef = useRef(onOutput);
  onOutputRef.current = onOutput;

  const send = useCallback((payload: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload));
      return true;
    }
    return false;
  }, []);

  const attach = useCallback(
    (s: BridgeSession) => {
      send({
        type: 'attach_session',
        sessionId: s.sessionId,
        clientId: s.clientId,
        afterSeq: 0
      });
    },
    [send]
  );

  useEffect(() => {
    if (!enabled) {
      setConnectionStatus('disconnected');
      return;
    }

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
      setConnectionStatus('connecting');
      setError(null);

      ws.addEventListener('open', () => {
        if (!active) return;
        setConnectionStatus('connected');
        setError(null);
        send({ type: 'health' });
        send({ type: 'list_providers' });
        if (sessionRef.current) {
          attach(sessionRef.current);
        }
      });

      ws.addEventListener('message', (ev: MessageEvent<string>) => {
        if (!active) return;
        try {
          const msg = JSON.parse(ev.data) as Record<string, unknown>;

          if (msg.type === 'health_response') {
            setHealth(msg as unknown as HealthResponseMsg);
            return;
          }

          if (msg.type === 'providers_list' && Array.isArray(msg.providers)) {
            const list = msg.providers as ProviderInfo[];
            setProviders(
              list.length
                ? list
                : [
                    {
                      provider: defaultProvider,
                      available: false,
                      binary: '',
                      version: ''
                    }
                  ]
            );
            return;
          }

          if (
            msg.type === 'session_started' &&
            typeof msg.sessionId === 'string'
          ) {
            const nextState = acknowledgeBridgeSessionStart(
              {
                session: sessionRef.current,
                pendingStart: pendingStartRef.current,
                error: null
              },
              msg.sessionId
            );
            const s = nextState.session;
            pendingStartRef.current = nextState.pendingStart;
            if (!s) return;
            sessionRef.current = s;
            setSession(s);
            attach(s);
            return;
          }

          if (msg.type === 'attach_event') {
            if (
              msg.eventType === 'output' &&
              typeof msg.payloadB64 === 'string'
            ) {
              const bytes = Uint8Array.from(atob(msg.payloadB64), (c) =>
                c.charCodeAt(0)
              );
              onOutputRef.current(bytes);
            }
            if (msg.eventType === 'error') {
              const nextState = setBridgeSessionError(
                {
                  session: sessionRef.current,
                  pendingStart: pendingStartRef.current,
                  error: error
                },
                String(msg.error ?? 'Stream error')
              );
              pendingStartRef.current = nextState.pendingStart;
              setError(nextState.error);
            }
            return;
          }

          if (msg.type === 'session_stopped') {
            const nextState = clearBridgeSession({
              session: sessionRef.current,
              pendingStart: pendingStartRef.current,
              error
            });
            sessionRef.current = nextState.session;
            pendingStartRef.current = nextState.pendingStart;
            setSession(nextState.session);
            return;
          }

          if (msg.type === 'error') {
            const nextState = setBridgeSessionError(
              {
                session: sessionRef.current,
                pendingStart: pendingStartRef.current,
                error
              },
              String(msg.message ?? 'Bridge error')
            );
            pendingStartRef.current = nextState.pendingStart;
            setError(nextState.error);
          }
        } catch {
          // non-JSON — ignore
        }
      });

      ws.addEventListener('close', () => {
        wsRef.current = null;
        if (!active) return;
        setConnectionStatus('disconnected');
        pendingStartRef.current = null;
        if (!closedByCleanupRef.current) {
          timerRef.current = setTimeout(connect, 2000);
        }
      });

      ws.addEventListener('error', () => {
        setConnectionStatus('error');
        setError('WebSocket connection failed');
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
  }, [websocketUrl, enabled, defaultProvider, attach, send]);

  const startSession = useCallback(
    (provider: string, repoPath: string, cols: number, rows: number) => {
      const sessionId = crypto.randomUUID();
      const clientId = crypto.randomUUID();
      const pendingStart = { sessionId, clientId };
      const sent = send({
        type: 'start_session',
        projectId,
        sessionId,
        repoPath,
        provider,
        initialCols: cols,
        initialRows: rows
      });
      const nextState = beginBridgeSessionStart(
        {
          session: sessionRef.current,
          pendingStart: pendingStartRef.current,
          error
        },
        pendingStart,
        sent
      );
      pendingStartRef.current = nextState.pendingStart;
      setError(nextState.error);
    },
    [send, projectId, error]
  );

  const stopSession = useCallback(() => {
    if (!sessionRef.current) return;
    send({
      type: 'stop_session',
      sessionId: sessionRef.current.sessionId,
      force: true
    });
  }, [send]);

  const sendInput = useCallback(
    (data: string) => {
      if (!sessionRef.current) return;
      send({
        type: 'send_input',
        sessionId: sessionRef.current.sessionId,
        clientId: sessionRef.current.clientId,
        text: data
      });
    },
    [send]
  );

  const sendResize = useCallback(
    (cols: number, rows: number) => {
      if (!sessionRef.current) return;
      send({
        type: 'resize_session',
        sessionId: sessionRef.current.sessionId,
        clientId: sessionRef.current.clientId,
        cols,
        rows
      });
    },
    [send]
  );

  return {
    connectionStatus,
    session,
    health,
    providers,
    error,
    startSession,
    stopSession,
    sendInput,
    sendResize
  };
}

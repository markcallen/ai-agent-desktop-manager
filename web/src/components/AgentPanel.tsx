import { useCallback, useRef, useState } from 'react';
import {
  resolveDesktopWebSocketUrl,
  type DesktopConfig
} from '../lib/api';
import { useBridgeSocket } from '../hooks/useBridgeSocket';
import { ErrorSummary } from './ErrorSummary';
import { HealthStatus } from './HealthStatus';
import { SessionControls } from './SessionControls';
import { Terminal, type TerminalHandle } from './Terminal';

interface Props {
  config: DesktopConfig;
}

export function AgentPanel({ config }: Props) {
  const { bridge } = config;
  const bridgeWebsocketUrl = resolveDesktopWebSocketUrl(
    bridge.websocketUrl,
    config.desktop.novncUrl
  );
  const termRef = useRef<TerminalHandle>(null);
  const [provider, setProvider] = useState(bridge.defaultProvider);
  const [repoPath, setRepoPath] = useState(bridge.workspaceDir);

  const handleOutput = useCallback((data: Uint8Array) => {
    termRef.current?.write(data);
  }, []);

  const bridgeSocket = useBridgeSocket({
    websocketUrl: bridgeWebsocketUrl,
    enabled: bridge.enabled,
    defaultProvider: bridge.defaultProvider,
    projectId: bridge.projectId,
    onOutput: handleOutput
  });

  function handleStart() {
    if (!repoPath) return;
    termRef.current?.clear();
    bridgeSocket.startSession(
      provider,
      repoPath,
      termRef.current?.cols ?? 120,
      termRef.current?.rows ?? 40
    );
  }

  function handleStop() {
    bridgeSocket.stopSession();
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <HealthStatus
        connectionStatus={bridgeSocket.connectionStatus}
        health={bridgeSocket.health}
        providers={bridgeSocket.providers}
      />
      <ErrorSummary
        bridgeError={bridgeSocket.error}
        health={bridgeSocket.health}
      />
      <SessionControls
        provider={provider}
        repoPath={repoPath}
        sessionId={bridgeSocket.session?.sessionId ?? null}
        connectionStatus={bridgeSocket.connectionStatus}
        availableProviders={bridgeSocket.providers}
        onProviderChange={setProvider}
        onRepoPathChange={setRepoPath}
        onStart={handleStart}
        onStop={handleStop}
      />
      <div
        id="agent-terminal-mount"
        className="flex-1 min-h-0 p-2"
        style={{ background: '#0d1117' }}
      >
        <Terminal
          ref={termRef}
          onData={bridgeSocket.sendInput}
          onResize={(cols, rows) => {
            if (bridgeSocket.session) bridgeSocket.sendResize(cols, rows);
          }}
        />
      </div>
    </div>
  );
}

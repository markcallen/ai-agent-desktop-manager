import { useCallback, useRef, useState } from 'react';
import {
  resolveDesktopWebSocketUrl,
  type DesktopConfig
} from '../lib/api';
import { useTerminalSocket } from '../hooks/useTerminalSocket';
import { Terminal, type TerminalHandle } from './Terminal';

interface Props {
  config: DesktopConfig;
}

export function TerminalPanel({ config }: Props) {
  const { terminal } = config;
  const terminalWebsocketUrl = resolveDesktopWebSocketUrl(
    terminal.websocketUrl,
    config.desktop.novncUrl
  );
  const termRef = useRef<TerminalHandle>(null);
  const [statusMsg, setStatusMsg] = useState('Connecting to tmux session…');
  const [isError, setIsError] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleOutput = useCallback((data: Uint8Array) => {
    termRef.current?.write(data);
  }, []);

  const handleStatus = useCallback((msg: string, err = false) => {
    setStatusMsg(msg);
    setIsError(err);
  }, []);

  const { sendInput, sendResize } = useTerminalSocket({
    websocketUrl: terminalWebsocketUrl,
    onOutput: handleOutput,
    onStatus: handleStatus
  });

  const copyUrl = async () => {
    await navigator.clipboard
      .writeText(terminalWebsocketUrl)
      .catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // When this tab becomes visible, refit the terminal
  const containerRef = useRef<HTMLDivElement>(null);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div
        className="flex items-center justify-between gap-3 px-4 py-2.5 shrink-0 border-b"
        style={{ borderColor: 'var(--border)', background: 'var(--surface-2)' }}
      >
        <span
          className="text-[11px] uppercase tracking-widest"
          style={{ fontFamily: 'var(--font-mono)', color: 'var(--ink-muted)' }}
        >
          Terminal
        </span>
        <span
          className="text-[11px]"
          style={{ fontFamily: 'var(--font-mono)', color: 'var(--ink-dim)' }}
        >
          {terminal.sessionName}
        </span>
      </div>

      {/* Status bar */}
      <div
        id="terminal-status"
        className="px-4 py-2 text-xs border-b shrink-0"
        style={{
          fontFamily: 'var(--font-mono)',
          color: isError ? '#f87171' : 'var(--ink-muted)',
          borderColor: 'var(--border)',
          background: 'var(--surface-2)',
          minHeight: '2rem'
        }}
      >
        <span
          className="inline-block w-1.5 h-1.5 rounded-full mr-2 align-middle"
          style={{
            background: isError ? '#f87171' : 'var(--accent)',
            verticalAlign: 'middle'
          }}
        />
        {statusMsg}
      </div>

      {/* WebSocket URL row */}
      <div
        className="flex items-center gap-2 px-3 py-1.5 shrink-0 border-b"
        style={{ borderColor: 'var(--border)', background: 'var(--surface-2)' }}
      >
        <span
          className="text-[10px] uppercase shrink-0"
          style={{ fontFamily: 'var(--font-mono)', color: 'var(--ink-dim)' }}
        >
          ws
        </span>
        <input
          readOnly
          value={terminalWebsocketUrl}
          className="flex-1 min-w-0 bg-transparent text-[11px] outline-none truncate"
          style={{ fontFamily: 'var(--font-mono)', color: 'var(--ink-muted)' }}
          aria-label="Terminal websocket url"
        />
        <button
          type="button"
          onClick={copyUrl}
          className="text-[10px] px-2 py-0.5 border shrink-0 transition-colors"
          style={{
            fontFamily: 'var(--font-mono)',
            color: copied ? 'var(--accent)' : 'var(--ink-muted)',
            borderColor: 'var(--border)',
            background: 'transparent',
            cursor: 'pointer'
          }}
        >
          {copied ? 'copied' : 'copy'}
        </button>
      </div>

      {/* Terminal */}
      <div
        id="terminal-mount"
        ref={containerRef}
        className="flex-1 min-h-0 p-3"
        style={{ background: '#020812' }}
      >
        <Terminal ref={termRef} onData={sendInput} onResize={sendResize} />
      </div>
    </div>
  );
}

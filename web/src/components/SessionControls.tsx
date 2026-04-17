import type { ProviderInfo } from '../types/bridge';
import type { ConnectionStatus } from '../types/bridge';

interface Props {
  provider: string;
  repoPath: string;
  sessionId: string | null;
  connectionStatus: ConnectionStatus;
  availableProviders: ProviderInfo[];
  onProviderChange: (p: string) => void;
  onRepoPathChange: (p: string) => void;
  onStart: () => void;
  onStop: () => void;
}

export function SessionControls({
  provider,
  repoPath,
  sessionId,
  connectionStatus,
  availableProviders,
  onProviderChange,
  onRepoPathChange,
  onStart,
  onStop
}: Props) {
  const hasSession = sessionId !== null;
  const canStart = !hasSession && !!repoPath && connectionStatus === 'connected';
  const startTitle = !repoPath
    ? 'Enter a repository path'
    : connectionStatus !== 'connected'
      ? `Bridge is ${connectionStatus}`
      : 'Start agent session';

  return (
    <div
      className="flex items-center gap-3 px-4 py-2 border-b flex-wrap shrink-0"
      style={{ background: 'var(--surface-2)', borderColor: 'var(--border)' }}
    >
      {/* Provider selector */}
      <select
        value={provider}
        onChange={(e) => onProviderChange(e.target.value)}
        disabled={hasSession}
        className="text-sm rounded px-2 py-1.5 border focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
        style={{
          background: 'var(--surface)',
          color: 'var(--ink)',
          borderColor: 'var(--border)',
          fontFamily: 'var(--font-mono)'
        }}
      >
        {availableProviders.length > 0 ? (
          availableProviders.map((p) => (
            <option key={p.provider} value={p.provider}>
              {p.provider}
            </option>
          ))
        ) : (
          <option value={provider}>{provider}</option>
        )}
      </select>

      {/* Repo path */}
      <input
        type="text"
        value={repoPath}
        onChange={(e) => onRepoPathChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && canStart) onStart();
        }}
        disabled={hasSession}
        placeholder="/path/to/repo"
        className="flex-1 min-w-48 text-sm rounded px-3 py-1.5 border focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
        style={{
          background: 'var(--surface)',
          color: 'var(--ink)',
          borderColor: 'var(--border)',
          fontFamily: 'var(--font-mono)'
        }}
        aria-label="Repository path"
      />

      {/* Session ID badge */}
      {sessionId && (
        <span
          className="text-xs font-mono truncate max-w-40"
          style={{ color: 'var(--ink-dim)' }}
          title={sessionId}
        >
          {sessionId.slice(0, 8)}…
        </span>
      )}

      {/* Start / Stop */}
      {!hasSession ? (
        <button
          id="agent-start"
          type="button"
          onClick={onStart}
          disabled={!canStart}
          title={startTitle}
          className="px-4 py-1.5 text-sm font-medium rounded transition-colors disabled:cursor-not-allowed"
          style={{
            background: canStart ? 'var(--accent-dim)' : 'transparent',
            color: canStart ? 'var(--accent)' : 'var(--ink-dim)',
            border: `1px solid ${canStart ? 'var(--border-md, var(--border))' : 'var(--border)'}`,
            fontFamily: 'var(--font-mono)'
          }}
        >
          {connectionStatus === 'connected' ? 'start' : 'waiting for bridge'}
        </button>
      ) : (
        <button
          id="agent-stop"
          type="button"
          onClick={onStop}
          className="px-4 py-1.5 text-sm font-medium rounded transition-colors"
          style={{
            background: 'rgba(248,113,113,0.08)',
            color: '#f87171',
            border: '1px solid rgba(248,113,113,0.3)',
            fontFamily: 'var(--font-mono)'
          }}
        >
          stop
        </button>
      )}
    </div>
  );
}

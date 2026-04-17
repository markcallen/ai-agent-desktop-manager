import type {
  ConnectionStatus,
  HealthResponseMsg,
  ProviderInfo
} from '../types/bridge';

interface Props {
  connectionStatus: ConnectionStatus;
  health: HealthResponseMsg | null;
  providers: ProviderInfo[];
}

const CONNECTION_COLORS: Record<ConnectionStatus, string> = {
  connected: 'bg-green-500',
  connecting: 'bg-yellow-500 animate-pulse',
  disconnected: 'bg-gray-500',
  error: 'bg-red-500'
};

export function HealthStatus({ connectionStatus, health, providers }: Props) {
  return (
    <div className="flex items-center gap-3 px-4 py-2 border-b text-sm flex-wrap shrink-0"
      style={{ background: 'var(--surface-2)', borderColor: 'var(--border)' }}
    >
      {/* WebSocket connection */}
      <div className="flex items-center gap-1.5">
        <span
          className={`w-2 h-2 rounded-full ${CONNECTION_COLORS[connectionStatus]}`}
        />
        <span className="capitalize" style={{ color: 'var(--ink-muted)', fontFamily: 'var(--font-mono)', fontSize: '11px' }}>
          {connectionStatus}
        </span>
      </div>

      {/* Bridge health */}
      {health && (
        <div className="flex items-center gap-1.5">
          <span style={{ color: 'var(--border)' }}>|</span>
          <span style={{ color: 'var(--ink-muted)', fontFamily: 'var(--font-mono)', fontSize: '11px' }}>bridge</span>
          <span
            className={`text-xs font-medium px-1.5 py-0.5 rounded ${
              health.status === 'ok'
                ? 'bg-green-900 text-green-300'
                : 'bg-red-900 text-red-300'
            }`}
          >
            {health.status}
          </span>
        </div>
      )}

      {/* Provider availability */}
      {providers.length > 0 && (
        <>
          <span style={{ color: 'var(--border)' }}>|</span>
          {providers.map((p) => (
            <div key={p.provider} className="flex items-center gap-1">
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  p.available ? 'bg-green-400' : 'bg-red-400'
                }`}
              />
              <span
                style={{
                  color: p.available ? 'var(--ink-muted)' : 'var(--ink-dim)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '11px'
                }}
              >
                {p.provider}
              </span>
              {p.version && (
                <span style={{ color: 'var(--ink-dim)', fontFamily: 'var(--font-mono)', fontSize: '10px' }}>
                  {p.version}
                </span>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

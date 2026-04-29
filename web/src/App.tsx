import { useEffect, useState } from 'react';
import {
  fetchDesktopConfig,
  getDesktopIdFromUrl,
  type DesktopConfig
} from './lib/api';
import { DesktopShell } from './components/DesktopShell';
import { initBrowserLogger } from './lib/logger';

function LoadingScreen() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center space-y-3">
        <div className="flex items-center gap-2 justify-center">
          <span
            className="inline-block w-2 h-2 rounded-full pulse"
            style={{ background: 'var(--accent)' }}
          />
          <span
            className="text-sm uppercase tracking-widest"
            style={{
              color: 'var(--ink-muted)',
              fontFamily: 'var(--font-mono)'
            }}
          >
            initialising desktop
          </span>
        </div>
      </div>
    </div>
  );
}

function ErrorScreen({ message }: { message: string }) {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div
        className="max-w-md w-full border p-6 space-y-3"
        style={{
          borderColor: 'rgba(239,68,68,0.3)',
          background: 'rgba(239,68,68,0.06)'
        }}
      >
        <p
          className="text-xs uppercase tracking-widest"
          style={{ color: '#f87171', fontFamily: 'var(--font-mono)' }}
        >
          ✗ desktop error
        </p>
        <p
          className="text-sm"
          style={{ color: 'var(--ink-muted)', fontFamily: 'var(--font-mono)' }}
        >
          {message}
        </p>
      </div>
    </div>
  );
}

export function App() {
  const [config, setConfig] = useState<DesktopConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const id = getDesktopIdFromUrl();
    if (!id) {
      setError('Desktop ID not found in URL. Expected /_aadm/desktop/<id>.');
      return;
    }
    fetchDesktopConfig(id)
      .then((cfg) => {
        initBrowserLogger(cfg.browserLogsToken);
        setConfig(cfg);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      });
  }, []);

  if (error) return <ErrorScreen message={error} />;
  if (!config) return <LoadingScreen />;
  return <DesktopShell config={config} />;
}

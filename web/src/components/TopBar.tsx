import type { MouseEvent, ReactNode } from 'react';
import type { DesktopConfig } from '../lib/api';

interface Props {
  config: DesktopConfig;
}

function Badge({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className="px-2 py-0.5 text-xs border"
      style={{
        fontFamily: 'var(--font-mono)',
        color: 'var(--ink-muted)',
        borderColor: 'var(--border)',
        background: 'rgba(20,184,166,0.05)'
      }}
    >
      {children}
    </span>
  );
}

export function TopBar({ config }: Props) {
  const { desktop, terminal } = config;
  const label = desktop.label || desktop.id;

  return (
    <header
      className="flex items-center justify-between gap-4 px-5 py-3 shrink-0 border-b"
      style={{
        background: 'var(--surface-2)',
        borderColor: 'var(--border)'
      }}
    >
      {/* Left: title + badges */}
      <div className="flex items-center gap-4 min-w-0">
        {/* Indicator dot */}
        <span
          className="shrink-0 w-1.5 h-1.5 rounded-full"
          style={{ background: 'var(--accent)' }}
        />
        <h1
          className="text-sm font-medium truncate"
          style={{
            fontFamily: 'var(--font-ui)',
            color: 'var(--ink)',
            letterSpacing: '0.03em'
          }}
        >
          {label}
        </h1>
        <div className="hidden sm:flex items-center gap-1.5 flex-wrap">
          <Badge>display:{desktop.display}</Badge>
          <Badge>tmux:{terminal.sessionName}</Badge>
          <Badge title={terminal.workspaceDir}>
            {terminal.workspaceDir.length > 32
              ? `…${terminal.workspaceDir.slice(-28)}`
              : terminal.workspaceDir}
          </Badge>
        </div>
      </div>

      {/* Right: actions */}
      <div className="flex items-center gap-2 shrink-0">
        <a
          href={desktop.novncUrl}
          target="_blank"
          rel="noreferrer"
          className="px-3 py-1 text-xs border transition-colors duration-150"
          style={{
            fontFamily: 'var(--font-mono)',
            color: 'var(--accent)',
            borderColor: 'var(--border-md)',
            background: 'var(--accent-dim)',
            textDecoration: 'none'
          }}
          onMouseEnter={(e: MouseEvent<HTMLAnchorElement>) => {
            e.currentTarget.style.background = 'rgba(20,184,166,0.28)';
          }}
          onMouseLeave={(e: MouseEvent<HTMLAnchorElement>) => {
            e.currentTarget.style.background = 'var(--accent-dim)';
          }}
        >
          open novnc ↗
        </a>
      </div>
    </header>
  );
}

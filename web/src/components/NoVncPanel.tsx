import type { DesktopConfig } from '../lib/api';

interface Props {
  config: DesktopConfig;
}

export function NoVncPanel({ config }: Props) {
  const { desktop } = config;

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
          Desktop
        </span>
        <span
          className="text-[11px]"
          style={{ fontFamily: 'var(--font-mono)', color: 'var(--ink-dim)' }}
        >
          {desktop.id}
        </span>
      </div>

      {/* noVNC iframe */}
      <iframe
        data-aadm-desktop-frame
        className="flex-1 min-h-0 w-full border-0"
        title="Desktop"
        loading="eager"
        src={desktop.novncUrl}
        style={{ background: '#020812' }}
      />
    </div>
  );
}

export type TabId = 'agent' | 'terminal' | 'novnc';

interface Props {
  active: TabId;
  onSelect: (tab: TabId) => void;
  bridgeEnabled: boolean;
}

const TABS: { id: TabId; label: string }[] = [
  { id: 'agent', label: 'AI Agent' },
  { id: 'terminal', label: 'Terminal' },
  { id: 'novnc', label: 'Desktop' }
];

export function TabBar({ active, onSelect, bridgeEnabled }: Props) {
  return (
    <nav
      id="aadm-tab-bar"
      className="flex shrink-0 border-b"
      style={{ borderColor: 'var(--border)', background: 'var(--surface-2)' }}
      aria-label="Desktop panels"
    >
      {TABS.map((tab) => {
        const isActive = tab.id === active;
        const isDisabled = tab.id === 'agent' && !bridgeEnabled;

        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            data-tab-btn={tab.id}
            aria-selected={isActive}
            disabled={isDisabled}
            onClick={() => !isDisabled && onSelect(tab.id)}
            className="relative px-5 py-2.5 text-xs uppercase tracking-widest transition-colors duration-150 focus-visible:outline-none"
            style={{
              fontFamily: 'var(--font-mono)',
              color: isDisabled
                ? 'var(--ink-dim)'
                : isActive
                  ? 'var(--ink)'
                  : 'var(--ink-muted)',
              cursor: isDisabled ? 'not-allowed' : 'pointer',
              background: 'transparent',
              border: 'none'
            }}
            onMouseEnter={(e) => {
              if (!isActive && !isDisabled) {
                (e.currentTarget as HTMLElement).style.color = 'var(--ink)';
              }
            }}
            onMouseLeave={(e) => {
              if (!isActive && !isDisabled) {
                (e.currentTarget as HTMLElement).style.color =
                  'var(--ink-muted)';
              }
            }}
          >
            {tab.label}
            {isActive && (
              <span
                className="absolute bottom-0 left-0 right-0 h-px"
                style={{
                  background:
                    'linear-gradient(90deg, transparent, var(--accent), transparent)'
                }}
              />
            )}
            {tab.id === 'agent' && !bridgeEnabled && (
              <span
                className="ml-1.5 text-[10px] align-middle"
                style={{ color: 'var(--ink-dim)' }}
              >
                off
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}

import { useState } from 'react';
import type { DesktopConfig } from '../lib/api';
import { TopBar } from './TopBar';
import { TabBar, type TabId } from './TabBar';
import { AgentPanel } from './AgentPanel';
import { TerminalPanel } from './TerminalPanel';
import { NoVncPanel } from './NoVncPanel';

interface Props {
  config: DesktopConfig;
}

export function DesktopShell({ config }: Props) {
  const initialTab: TabId = (() => {
    const hash = window.location.hash.replace('#', '') as TabId;
    if (['agent', 'terminal', 'novnc'].includes(hash)) return hash;
    return config.bridge.enabled ? 'agent' : 'terminal';
  })();

  const [activeTab, setActiveTab] = useState<TabId>(initialTab);

  const handleSelect = (tab: TabId) => {
    setActiveTab(tab);
    try {
      history.replaceState(null, '', `#${tab}`);
    } catch {
      // ignore
    }
  };

  return (
    <div
      className="flex flex-col h-full min-h-0"
      style={{ background: 'transparent' }}
    >
      <TopBar config={config} />
      <TabBar
        active={activeTab}
        onSelect={handleSelect}
        bridgeEnabled={config.bridge.enabled}
      />

      {/* Tab panels — all mounted, visibility controlled via display */}
      <div className="flex-1 min-h-0 relative">
        <div
          className="absolute inset-0 flex flex-col"
          style={{ display: activeTab === 'agent' ? 'flex' : 'none' }}
        >
          <AgentPanel config={config} />
        </div>
        <div
          className="absolute inset-0 flex flex-col"
          style={{ display: activeTab === 'terminal' ? 'flex' : 'none' }}
        >
          <TerminalPanel config={config} />
        </div>
        <div
          className="absolute inset-0 flex flex-col"
          style={{ display: activeTab === 'novnc' ? 'flex' : 'none' }}
        >
          <NoVncPanel config={config} />
        </div>
      </div>
    </div>
  );
}

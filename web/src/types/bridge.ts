/**
 * Minimal bridge protocol types used by the web UI components.
 * Mirrored from @ai-agent-bridge/client-node/src/types.ts
 */

export interface ProviderInfo {
  provider: string;
  available: boolean;
  binary: string;
  version: string;
}

export interface ProviderHealth {
  provider: string;
  available: boolean;
  error?: string;
}

export interface HealthResponseMsg {
  type: 'health_response';
  status: string;
  providers: ProviderHealth[];
}

export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected' | 'error';

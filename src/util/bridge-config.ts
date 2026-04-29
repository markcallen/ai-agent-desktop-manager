import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

export interface BridgeProviderConfig {
  providers: string[];
  defaultProvider: string;
  configPath: string | null;
}

const FALLBACK_PROVIDER = 'claude';
const DEFAULT_CONFIG_PATHS = [
  path.resolve('local/bridge-local.yaml'),
  '/opt/ai-agent-bridge/config/bridge.yaml'
];

function parseProviderNames(rawConfig: string): string[] {
  const lines = rawConfig.split(/\r?\n/);
  const providers: string[] = [];
  let inProvidersBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (!inProvidersBlock) {
      if (trimmed === 'providers:') {
        inProvidersBlock = true;
      }
      continue;
    }

    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    if (!line.startsWith('  ')) {
      break;
    }

    const providerMatch = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (providerMatch) {
      providers.push(providerMatch[1]);
    }
  }

  return providers;
}

function candidateConfigPaths() {
  return [config.bridgeConfigPath, ...DEFAULT_CONFIG_PATHS].filter(
    (value): value is string => Boolean(value)
  );
}

export function readBridgeProviderConfig(): BridgeProviderConfig {
  for (const candidatePath of candidateConfigPaths()) {
    try {
      const rawConfig = fs.readFileSync(candidatePath, 'utf8');
      const providers = parseProviderNames(rawConfig);
      if (providers.length > 0) {
        return {
          providers,
          defaultProvider: providers[0],
          configPath: candidatePath
        };
      }
    } catch {
      // Fall through to the next candidate path.
    }
  }

  return {
    providers: [FALLBACK_PROVIDER],
    defaultProvider: FALLBACK_PROVIDER,
    configPath: null
  };
}

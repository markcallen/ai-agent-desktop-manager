import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('readBridgeProviderConfig returns providers in bridge config order', async () => {
  const tmpRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'aadm-bridge-config-')
  );
  const configPath = path.join(tmpRoot, 'bridge.yaml');
  const configMod = await import('../../src/util/config.ts');
  const previousPath = configMod.config.bridgeConfigPath;

  await fs.writeFile(
    configPath,
    `providers:
  codex:
    binary: node
  gemini:
    binary: node
  claude:
    binary: node
`
  );

  configMod.config.bridgeConfigPath = configPath;

  try {
    const bridgeConfigMod = await import('../../src/util/bridge-config.ts');
    const result = bridgeConfigMod.readBridgeProviderConfig();

    assert.equal(result.defaultProvider, 'codex');
    assert.deepEqual(result.providers, ['codex', 'gemini', 'claude']);
    assert.equal(result.configPath, configPath);
  } finally {
    configMod.config.bridgeConfigPath = previousPath;
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});

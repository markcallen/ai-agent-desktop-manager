import test from 'node:test';
import assert from 'node:assert/strict';

import { appVersion } from '../../src/util/app-version.ts';
import packageJson from '../../package.json' with { type: 'json' };

test('appVersion matches package.json version', () => {
  assert.equal(appVersion, packageJson.version);
});

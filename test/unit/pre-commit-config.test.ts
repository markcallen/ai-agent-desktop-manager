import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const preCommitConfigPath = path.resolve('.pre-commit-config.yaml');

test('pre-push hook runs the build and unit test suite only', () => {
  const config = fs.readFileSync(preCommitConfigPath, 'utf8');

  assert.match(
    config,
    /- id: build-and-test[\s\S]*entry: bash -c 'npm run build && npm run test:unit'/
  );
  assert.doesNotMatch(config, /entry:.*smoke/);
  assert.doesNotMatch(config, /entry:.*npm test/);
});

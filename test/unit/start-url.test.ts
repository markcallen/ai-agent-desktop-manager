import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isStartUrlAllowed,
  parseStartUrlDomainAllowlist
} from '../../src/util/start-url.ts';

test('parseStartUrlDomainAllowlist normalizes and deduplicates domains', () => {
  assert.deepEqual(
    parseStartUrlDomainAllowlist('Example.com, *.example.com, github.com'),
    ['example.com', 'github.com']
  );
});

test('isStartUrlAllowed supports exact hosts and subdomains', () => {
  const allowlist = ['example.com', 'github.com'];

  assert.equal(isStartUrlAllowed('https://example.com', allowlist), true);
  assert.equal(
    isStartUrlAllowed('https://www.example.com/path', allowlist),
    true
  );
  assert.equal(isStartUrlAllowed('https://gist.github.com', allowlist), true);
  assert.equal(isStartUrlAllowed('https://evil-example.com', allowlist), false);
});

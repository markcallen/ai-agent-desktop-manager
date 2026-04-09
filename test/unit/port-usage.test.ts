import test from 'node:test';
import assert from 'node:assert/strict';

import { parseListeningTcpPorts } from '../../src/util/port-usage.ts';

test('parseListeningTcpPorts extracts IPv4 and IPv6 listener ports', () => {
  const ports = parseListeningTcpPorts(`
LISTEN 0 128 127.0.0.1:6081 0.0.0.0:*
LISTEN 0 128 *:9222 *:*
LISTEN 0 128 [::]:8765 [::]:*
`);

  assert.deepEqual(
    [...ports].sort((a, b) => a - b),
    [6081, 8765, 9222]
  );
});

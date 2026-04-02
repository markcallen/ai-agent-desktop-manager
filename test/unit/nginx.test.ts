import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSnippet } from '../../src/util/nginx.ts';

test('buildSnippet generates redirect and websocket-safe location blocks', () => {
  const snippet = buildSnippet(3, 6083);
  assert.match(snippet, /location = \/desktop\/3\//);
  assert.match(
    snippet,
    /return 302 \/desktop\/3\/vnc\.html\?path=desktop\/3\/websockify&resize=remote&autoconnect=1;/
  );
  assert.match(snippet, /location \/desktop\/3\//);
  assert.match(snippet, /proxy_pass http:\/\/127\.0\.0\.1:6083\//);
  assert.match(snippet, /proxy_set_header Upgrade \$http_upgrade;/);
  assert.match(snippet, /proxy_set_header Connection "upgrade";/);
  assert.match(snippet, /proxy_read_timeout 7d;/);
  assert.match(snippet, /proxy_send_timeout 7d;/);
});

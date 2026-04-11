import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSnippet } from '../../src/util/nginx.ts';

test('buildSnippet generates redirect and websocket-safe location blocks', () => {
  const snippet = buildSnippet('desk-3', 3, 6083);
  assert.match(snippet, /location = \/desktop\/3\//);
  assert.match(
    snippet,
    /proxy_pass http:\/\/127\.0\.0\.1:8899\/_aadm\/desktop\/desk-3;/
  );
  assert.match(snippet, /location \/desktop\/3\//);
  assert.match(snippet, /proxy_pass http:\/\/127\.0\.0\.1:6083\//);
  assert.match(snippet, /proxy_set_header Upgrade \$http_upgrade;/);
  assert.match(snippet, /proxy_set_header Connection "upgrade";/);
  assert.match(snippet, /proxy_read_timeout 7d;/);
  assert.match(snippet, /proxy_send_timeout 7d;/);
  assert.match(
    snippet,
    /location = \/desktop\/3\/terminal\/ws \{\n {2}proxy_pass http:\/\/127\.0\.0\.1:8899\/_aadm\/terminal\/desk-3\/ws;/
  );
  assert.match(
    snippet,
    /location = \/desktop\/3\/bridge\/ws \{\n {2}proxy_pass http:\/\/127\.0\.0\.1:8899\/_aadm\/bridge\/desk-3\/ws;/
  );
  assert.doesNotMatch(snippet, /auth_request/);
});

test('buildSnippet can protect a route with auth_request', () => {
  const snippet = buildSnippet('desk-3', 3, 6083, {
    mode: 'auth_request',
    authRequest: {
      url: 'http://127.0.0.1:3001/verify',
      forwardedHeaders: ['x-auth-request-user', 'x-orchestrator-token']
    }
  });

  assert.match(snippet, /location = \/_aadm\/auth\/desk-3/);
  assert.match(snippet, /internal;/);
  assert.match(snippet, /proxy_pass http:\/\/127\.0\.0\.1:3001\/verify;/);
  assert.match(snippet, /proxy_set_header X-Original-URI \$request_uri;/);
  assert.match(
    snippet,
    /proxy_set_header x-auth-request-user \$http_x_auth_request_user;/
  );
  assert.match(
    snippet,
    /proxy_set_header x-orchestrator-token \$http_x_orchestrator_token;/
  );
  assert.match(snippet, /auth_request \/_aadm\/auth\/desk-3;/);
  assert.match(
    snippet,
    /location = \/desktop\/3\/ \{\n {2}auth_request \/_aadm\/auth\/desk-3;\n {2}proxy_pass http:\/\/127\.0\.0\.1:8899\/_aadm\/desktop\/desk-3;/
  );
  assert.match(
    snippet,
    /location = \/desktop\/3\/terminal\/ws \{\n {2}auth_request \/_aadm\/auth\/desk-3;\n {2}proxy_pass http:\/\/127\.0\.0\.1:8899\/_aadm\/terminal\/desk-3\/ws;/
  );
  assert.match(
    snippet,
    /location = \/desktop\/3\/bridge\/ws \{\n {2}auth_request \/_aadm\/auth\/desk-3;\n {2}proxy_pass http:\/\/127\.0\.0\.1:8899\/_aadm\/bridge\/desk-3\/ws;/
  );
});

test('buildSnippet can protect a route with manager token verification', () => {
  const snippet = buildSnippet('desk-4', 4, 6084, {
    mode: 'token',
    token: {
      ttlSeconds: 900
    }
  });

  assert.match(snippet, /location = \/_aadm\/auth\/desk-4/);
  assert.match(
    snippet,
    /proxy_pass http:\/\/127\.0\.0\.1:8899\/_aadm\/verify\/desk-4;/
  );
  assert.match(snippet, /proxy_set_header Cookie \$http_cookie;/);
  assert.match(
    snippet,
    /location = \/desktop\/4\/access \{\n {2}proxy_pass http:\/\/127\.0\.0\.1:8899\/_aadm\/access\/desk-4\$is_args\$args;/
  );
  assert.match(snippet, /auth_request \/_aadm\/auth\/desk-4;/);
  assert.match(
    snippet,
    /location = \/desktop\/4\/ \{\n {2}auth_request \/_aadm\/auth\/desk-4;\n {2}proxy_pass http:\/\/127\.0\.0\.1:8899\/_aadm\/desktop\/desk-4;/
  );
  assert.match(
    snippet,
    /location = \/desktop\/4\/terminal\/ws \{\n {2}auth_request \/_aadm\/auth\/desk-4;\n {2}proxy_pass http:\/\/127\.0\.0\.1:8899\/_aadm\/terminal\/desk-4\/ws;/
  );
  assert.match(
    snippet,
    /location = \/desktop\/4\/bridge\/ws \{\n {2}auth_request \/_aadm\/auth\/desk-4;\n {2}proxy_pass http:\/\/127\.0\.0\.1:8899\/_aadm\/bridge\/desk-4\/ws;/
  );
});

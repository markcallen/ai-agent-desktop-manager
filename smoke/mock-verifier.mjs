#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Mock HTTP verifier for smoke-testing auth_request desktop routes.
 *
 * Nginx proxies auth_request calls to this server at GET /verify.
 * The smoke test controls allow/deny state via POST /allow and POST /deny.
 * GET /health is a readiness probe for the smoke script.
 */

import http from 'node:http';

let allow = true;

export function buildServer() {
  return http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/allow') {
      allow = true;
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok\n');
      return;
    }

    if (req.method === 'POST' && req.url === '/deny') {
      allow = false;
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok\n');
      return;
    }

    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok\n');
      return;
    }

    // Auth verification endpoint — nginx calls GET /verify
    res.writeHead(allow ? 200 : 401);
    res.end();
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = parseInt(process.env.MOCK_VERIFIER_PORT ?? '9999', 10);

  const server = buildServer();
  server.listen(port, '127.0.0.1', () => {
    console.error(`[mock-verifier] listening on 127.0.0.1:${port}`);
  });

  process.on('SIGTERM', () => server.close(() => process.exit(0)));
  process.on('SIGINT', () => server.close(() => process.exit(0)));
}

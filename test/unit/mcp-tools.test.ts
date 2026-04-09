import test from 'node:test';
import assert from 'node:assert/strict';

import { invokeDesktopTool } from '../../src/mcp/tools.ts';

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

test('desktop.list returns structured MCP content', async () => {
  const result = await invokeDesktopTool(
    'desktop.list',
    {},
    {
      fetchImpl: async () => jsonResponse(200, { desktops: [{ id: 'desk-1' }] })
    }
  );

  assert.equal(result.isError, undefined);
  assert.deepEqual(result.structuredContent, {
    desktops: [{ id: 'desk-1' }]
  });
  assert.match(result.content[0].text, /desk-1/);
});

test('desktop.get reports manager errors without throwing', async () => {
  const result = await invokeDesktopTool(
    'desktop.get',
    { id: 'missing' },
    {
      fetchImpl: async () =>
        jsonResponse(404, { ok: false, error: 'not_found' })
    }
  );

  assert.equal(result.isError, true);
  assert.deepEqual(result.structuredContent, {
    ok: false,
    status: 404,
    data: { ok: false, error: 'not_found' }
  });
});

test('desktop.get rejects missing ids before calling the manager API', async () => {
  let called = false;

  const result = await invokeDesktopTool(
    'desktop.get',
    {},
    {
      fetchImpl: async () => {
        called = true;
        return jsonResponse(200, {});
      }
    }
  );

  assert.equal(called, false);
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /invalid_arguments/i);
});

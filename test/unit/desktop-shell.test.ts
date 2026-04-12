import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDesktopShellHtml } from '../../src/util/desktop-shell.ts';

test('desktop shell runtime resolves terminal globals from globalThis', () => {
  const html = buildDesktopShellHtml({
    id: 'desk-2',
    owner: 'smoke-test',
    label: 'shell',
    createdAt: Date.now(),
    status: 'running',
    display: 2,
    vncPort: 5902,
    wsPort: 6081,
    cdpPort: 9222,
    aabPort: 8765,
    novncUrl: 'https://host.example.com/desktop/2/vnc.html',
    aabUrl: 'http://127.0.0.1:8765',
    workspaceDir: '/tmp/workspaces/desk-2',
    terminalSessionName: 'aadm-desk-2',
    terminalWebsocketPath: '/desktop/2/terminal/ws',
    terminalWebsocketUrl: 'wss://host.example.com/desktop/2/terminal/ws',
    routeAuth: { mode: 'none' }
  });

  assert.match(
    html,
    /const TerminalCtor = globalThis\.Terminal \|\| window\.Terminal;/
  );
  assert.match(
    html,
    /const FitAddonCtor = globalThis\.FitAddon \|\| window\.FitAddon;/
  );
  assert.doesNotMatch(html, /!window\.Terminal \|\|[\s\S]*!window\.FitAddon/);
  assert.match(html, /href="\/desktop\/2\/assets\/xterm\.css"/);
  assert.match(html, /src="\/desktop\/2\/assets\/xterm\.js"/);
  assert.match(html, /src="\/desktop\/2\/assets\/addon-fit\.js"/);
  assert.doesNotMatch(html, /\/_aadm\/assets\//);
});

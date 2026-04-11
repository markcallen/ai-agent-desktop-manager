import type { DesktopRecord } from './store.js';
import { config } from './config.js';
import { buildBridgeWebsocketPath, buildBridgeWebsocketUrl } from './bridge.js';
import { terminalMetadataForDesktop } from './terminal.js';

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeJson(value: unknown) {
  return JSON.stringify(value)
    .replaceAll('&', '\\u0026')
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e');
}

function desktopShellBasePath(display: number) {
  const prefix = config.novncPathPrefix.replace(/\/$/, '');
  return `${prefix}/${display}`;
}

function desktopIframeUrl(display: number) {
  const basePath = desktopShellBasePath(display);
  return `${basePath}/vnc.html?path=${basePath.replace(/^\//, '')}/websockify&resize=remote&autoconnect=1`;
}

export function buildDesktopShellHtml(desktop: DesktopRecord) {
  const terminal = terminalMetadataForDesktop(desktop);
  const iframeUrl = desktopIframeUrl(desktop.display);
  const shellTitle = desktop.label?.trim() || desktop.id;
  const bridgeEnabled = Boolean(config.bridgeAddr);
  const bootstrap = {
    desktop: {
      id: desktop.id,
      display: desktop.display,
      label: desktop.label ?? desktop.id,
      novncUrl: iframeUrl
    },
    terminal: {
      websocketUrl: terminal.websocketUrl,
      websocketPath: terminal.websocketPath,
      sessionName: terminal.sessionName,
      workspaceDir: terminal.workspaceDir
    },
    bridge: {
      enabled: bridgeEnabled,
      websocketPath: buildBridgeWebsocketPath(
        config.novncPathPrefix,
        desktop.display
      ),
      websocketUrl: buildBridgeWebsocketUrl(
        config.publicBaseUrl,
        config.novncPathPrefix,
        desktop.display
      ),
      workspaceDir: terminal.workspaceDir,
      defaultProvider: 'claude',
      projectId: desktop.id
    }
  };

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(shellTitle)} | ai-agent desktop</title>
  <link rel="stylesheet" href="/_aadm/assets/xterm.css">
  <style>
    :root {
      --bg: #0b1020;
      --panel: rgba(7, 12, 24, 0.88);
      --panel-border: rgba(148, 163, 184, 0.18);
      --ink: #e2e8f0;
      --muted: #94a3b8;
      --accent: #5eead4;
      --warning: #fbbf24;
      --shadow: 0 20px 50px rgba(2, 8, 23, 0.45);
    }

    * { box-sizing: border-box; }
    html, body { height: 100%; }
    body {
      margin: 0;
      color: var(--ink);
      font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
      background:
        radial-gradient(circle at top left, rgba(94, 234, 212, 0.18), transparent 28%),
        radial-gradient(circle at bottom right, rgba(59, 130, 246, 0.22), transparent 30%),
        linear-gradient(140deg, #050916, #0b1020 35%, #101933);
    }

    .shell {
      min-height: 100%;
      display: grid;
      grid-template-rows: auto 1fr;
      padding: 20px;
      gap: 16px;
    }

    .topbar {
      display: flex;
      gap: 12px;
      align-items: center;
      justify-content: space-between;
      padding: 16px 18px;
      border: 1px solid var(--panel-border);
      border-radius: 18px;
      background: linear-gradient(180deg, rgba(15, 23, 42, 0.94), rgba(9, 14, 28, 0.92));
      box-shadow: var(--shadow);
      backdrop-filter: blur(14px);
    }

    .topbar h1 {
      margin: 0;
      font-size: 1.2rem;
      letter-spacing: -0.03em;
    }

    .meta {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      color: var(--muted);
      font-size: 0.92rem;
    }

    .pill {
      border: 1px solid rgba(94, 234, 212, 0.25);
      border-radius: 999px;
      padding: 6px 10px;
      background: rgba(15, 118, 110, 0.12);
    }

    .content {
      min-height: 0;
      display: grid;
      grid-template-columns: minmax(0, 1.8fr) minmax(360px, 0.9fr);
      gap: 16px;
    }

    .sidecar {
      min-height: 0;
      display: grid;
      grid-template-rows: minmax(320px, 1fr) minmax(280px, 1fr);
      gap: 16px;
    }

    .panel {
      min-height: 0;
      border: 1px solid var(--panel-border);
      border-radius: 22px;
      overflow: hidden;
      background: var(--panel);
      box-shadow: var(--shadow);
      backdrop-filter: blur(12px);
    }

    .panel-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      padding: 14px 16px;
      border-bottom: 1px solid var(--panel-border);
      background: rgba(15, 23, 42, 0.76);
    }

    .panel-title {
      margin: 0;
      font-size: 0.96rem;
      font-weight: 700;
      letter-spacing: 0.02em;
      text-transform: uppercase;
      color: var(--muted);
    }

    .desktop-frame {
      width: 100%;
      height: calc(100% - 58px);
      border: 0;
      background: #020617;
    }

    .terminal-wrap {
      display: grid;
      grid-template-rows: auto auto 1fr;
      min-height: 0;
      height: 100%;
    }

    .terminal-status {
      padding: 12px 16px;
      color: var(--muted);
      border-bottom: 1px solid var(--panel-border);
      font-size: 0.92rem;
    }

    .terminal-status strong {
      color: var(--accent);
    }

    .websocket-row {
      display: flex;
      gap: 8px;
      align-items: center;
      padding: 12px 16px;
      border-bottom: 1px solid var(--panel-border);
    }

    .websocket-row input {
      flex: 1;
      min-width: 0;
      border-radius: 10px;
      border: 1px solid rgba(148, 163, 184, 0.24);
      background: rgba(2, 6, 23, 0.9);
      color: var(--ink);
      padding: 10px 12px;
      font: inherit;
    }

    .websocket-row button {
      border: 1px solid rgba(94, 234, 212, 0.35);
      border-radius: 10px;
      padding: 10px 12px;
      color: var(--ink);
      background: rgba(15, 118, 110, 0.18);
      cursor: pointer;
    }

    #terminal-mount {
      min-height: 0;
      height: 100%;
      padding: 12px 16px;
      background: rgba(2, 6, 23, 0.92);
    }

    .xterm {
      height: 100%;
    }

    .xterm-viewport {
      overflow-y: auto !important;
    }

    .actions {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }

    .actions a {
      color: var(--ink);
      text-decoration: none;
      padding: 9px 12px;
      border-radius: 12px;
      border: 1px solid rgba(255, 255, 255, 0.08);
      background: rgba(148, 163, 184, 0.12);
    }

    .bridge-wrap {
      display: grid;
      grid-template-rows: auto auto auto auto 1fr;
      min-height: 0;
      height: 100%;
    }

    .bridge-controls {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto auto;
      gap: 8px;
      padding: 12px 16px;
      border-bottom: 1px solid var(--panel-border);
    }

    .bridge-controls label {
      display: grid;
      gap: 6px;
      color: var(--muted);
      font-size: 0.82rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .bridge-controls select,
    .bridge-controls input,
    .bridge-controls button {
      border-radius: 10px;
      border: 1px solid rgba(148, 163, 184, 0.24);
      background: rgba(2, 6, 23, 0.9);
      color: var(--ink);
      padding: 10px 12px;
      font: inherit;
    }

    .bridge-controls button {
      align-self: end;
      cursor: pointer;
      border-color: rgba(94, 234, 212, 0.35);
      background: rgba(15, 118, 110, 0.18);
    }

    .bridge-controls button[disabled] {
      cursor: not-allowed;
      opacity: 0.5;
    }

    .bridge-path {
      padding: 12px 16px;
      border-bottom: 1px solid var(--panel-border);
      color: var(--muted);
      font-size: 0.9rem;
    }

    #agent-terminal-mount {
      min-height: 0;
      height: 100%;
      padding: 12px 16px;
      background: rgba(2, 6, 23, 0.92);
    }

    .actions a.primary {
      background: linear-gradient(135deg, rgba(94, 234, 212, 0.24), rgba(14, 165, 233, 0.18));
      border-color: rgba(94, 234, 212, 0.35);
    }

    .warning {
      color: var(--warning);
    }

    @media (max-width: 1100px) {
      .content {
        grid-template-columns: 1fr;
      }

      .panel {
        min-height: 420px;
      }
    }
  </style>
</head>
<body>
  <main class="shell">
    <section class="topbar">
      <div>
        <h1>${escapeHtml(shellTitle)}</h1>
        <div class="meta">
          <span class="pill">Desktop ${desktop.display}</span>
          <span class="pill">tmux ${escapeHtml(terminal.sessionName)}</span>
          <span class="pill">${escapeHtml(terminal.workspaceDir)}</span>
        </div>
      </div>
      <div class="actions">
        <a class="primary" href="${escapeHtml(iframeUrl)}" target="_blank" rel="noreferrer">Open noVNC Only</a>
      </div>
    </section>

    <section class="content">
      <article class="panel">
        <header class="panel-header">
          <h2 class="panel-title">Desktop</h2>
          <span>${escapeHtml(desktop.id)}</span>
        </header>
        <iframe
          class="desktop-frame"
          data-aadm-desktop-frame
          title="Desktop"
          loading="eager"
          src="${escapeHtml(iframeUrl)}"></iframe>
      </article>

      <section class="sidecar">
        <article class="panel terminal-wrap">
          <header class="panel-header">
            <h2 class="panel-title">Terminal</h2>
            <span>${escapeHtml(terminal.sessionName)}</span>
          </header>
          <div class="terminal-status" id="terminal-status">Connecting to <strong>tmux</strong>…</div>
          <div class="websocket-row">
            <input
              id="terminal-websocket-url"
              readonly
              value="${escapeHtml(terminal.websocketUrl)}"
              aria-label="Terminal websocket url">
            <button type="button" id="copy-terminal-websocket-url">Copy URL</button>
          </div>
          <div id="terminal-mount" aria-label="Terminal output"></div>
        </article>

        <article class="panel bridge-wrap">
          <header class="panel-header">
            <h2 class="panel-title">AI Agent</h2>
            <span>ai-agent-bridge</span>
          </header>
          <div class="terminal-status" id="agent-status">${
            bridgeEnabled
              ? 'Bridge available. Start a session to attach the agent terminal.'
              : 'Bridge not configured on this host.'
          }</div>
          <div class="bridge-controls">
            <label>
              Provider
              <select id="agent-provider" ${
                bridgeEnabled ? '' : 'disabled'
              } aria-label="AI agent provider">
                <option value="claude">claude</option>
              </select>
            </label>
            <button type="button" id="agent-start" ${
              bridgeEnabled ? '' : 'disabled'
            }>Start</button>
            <button type="button" id="agent-stop" disabled>Stop</button>
          </div>
          <div class="bridge-path" id="agent-workspace">${escapeHtml(
            terminal.workspaceDir
          )}</div>
          <div class="websocket-row">
            <input
              id="agent-websocket-url"
              readonly
              value="${escapeHtml(
                buildBridgeWebsocketUrl(
                  config.publicBaseUrl,
                  config.novncPathPrefix,
                  desktop.display
                )
              )}"
              aria-label="AI agent websocket url">
            <button type="button" id="copy-agent-websocket-url">Copy URL</button>
          </div>
          <div id="agent-terminal-mount" aria-label="AI agent terminal output"></div>
        </article>
      </section>
    </section>
  </main>

  <script id="aadm-shell-bootstrap" type="application/json">${escapeJson(bootstrap)}</script>
  <script src="/_aadm/assets/xterm.js"></script>
  <script src="/_aadm/assets/addon-fit.js"></script>
  <script>
    (() => {
      const bootstrap = JSON.parse(document.getElementById('aadm-shell-bootstrap').textContent || '{}');
      const statusNode = document.getElementById('terminal-status');
      const mountNode = document.getElementById('terminal-mount');
      const websocketUrlNode = document.getElementById('terminal-websocket-url');
      const copyButton = document.getElementById('copy-terminal-websocket-url');
      const agentStatusNode = document.getElementById('agent-status');
      const agentMountNode = document.getElementById('agent-terminal-mount');
      const agentWebsocketUrlNode = document.getElementById('agent-websocket-url');
      const agentCopyButton = document.getElementById('copy-agent-websocket-url');
      const agentProviderNode = document.getElementById('agent-provider');
      const agentStartButton = document.getElementById('agent-start');
      const agentStopButton = document.getElementById('agent-stop');

      if (
        !statusNode ||
        !mountNode ||
        !websocketUrlNode ||
        !copyButton ||
        !agentStatusNode ||
        !agentMountNode ||
        !agentWebsocketUrlNode ||
        !agentCopyButton ||
        !agentProviderNode ||
        !agentStartButton ||
        !agentStopButton ||
        !window.Terminal ||
        !window.FitAddon
      ) {
        if (statusNode) {
          statusNode.textContent = 'Terminal runtime failed to load.';
          statusNode.classList.add('warning');
        }
        return;
      }

      const updateStatus = (node, message, isWarning = false) => {
        node.textContent = message;
        node.classList.toggle('warning', isWarning);
      };

      const terminalTheme = {
        background: '#0d1117',
        foreground: '#c9d1d9',
        cursor: '#58a6ff',
        black: '#484f58',
        brightBlack: '#6e7681',
        red: '#ff7b72',
        brightRed: '#ffa198',
        green: '#3fb950',
        brightGreen: '#56d364',
        yellow: '#d29922',
        brightYellow: '#e3b341',
        blue: '#58a6ff',
        brightBlue: '#79c0ff',
        magenta: '#bc8cff',
        brightMagenta: '#d2a8ff',
        cyan: '#39c5cf',
        brightCyan: '#56d4dd',
        white: '#b1bac4',
        brightWhite: '#f0f6fc'
      };

      const createTerminalView = (container) => {
        const term = new window.Terminal({
          theme: terminalTheme,
          fontFamily: '"Cascadia Code", "Fira Code", Menlo, monospace',
          fontSize: 14,
          lineHeight: 1.2,
          cursorBlink: true,
          scrollback: 5000,
          allowProposedApi: true
        });
        const fitAddon = new window.FitAddon.FitAddon();
        term.loadAddon(fitAddon);
        term.open(container);
        fitAddon.fit();

        const observer = new ResizeObserver(() => {
          fitAddon.fit();
        });
        observer.observe(container);

        return {
          term,
          fit: () => fitAddon.fit(),
          cols: () => term.cols || 120,
          rows: () => term.rows || 40,
          clear: () => term.clear(),
          write: (data) => term.write(data),
          focus: () => term.focus(),
          dispose: () => {
            observer.disconnect();
            term.dispose();
          }
        };
      };

      const tmuxView = createTerminalView(mountNode);
      const agentView = createTerminalView(agentMountNode);

      const socketUrl = new URL(bootstrap.terminal.websocketUrl);
      let socket = null;
      let reconnectTimer = null;
      let closedByPage = false;

      const reportResize = () => {
        tmuxView.fit();
        const cols = tmuxView.cols();
        const rows = tmuxView.rows();
        if (!socket || socket.readyState !== WebSocket.OPEN) return;
        socket.send(JSON.stringify({
          type: 'resize',
          cols,
          rows
        }));
      };

      const connect = () => {
        closedByPage = false;
        tmuxView.fit();
        socketUrl.searchParams.set('cols', String(tmuxView.cols()));
        socketUrl.searchParams.set('rows', String(tmuxView.rows()));
        socket = new WebSocket(socketUrl.toString());

        socket.addEventListener('open', () => {
          updateStatus(
            statusNode,
            'Connected to tmux session ' + bootstrap.terminal.sessionName
          );
          reportResize();
        });

        socket.addEventListener('message', (event) => {
          const payload = JSON.parse(event.data);
          if (payload.type === 'ready') {
            updateStatus(
              statusNode,
              'Attached to tmux session ' + payload.terminal.sessionName
            );
            return;
          }
          if (payload.type === 'output' && typeof payload.data === 'string') {
            const bytes = Uint8Array.from(atob(payload.data), (c) => c.charCodeAt(0));
            tmuxView.write(bytes);
            return;
          }
          if (payload.type === 'exit') {
            updateStatus(statusNode, 'tmux session closed.', true);
            return;
          }
          if (payload.type === 'error') {
            updateStatus(statusNode, payload.error || 'Terminal error.', true);
          }
        });

        socket.addEventListener('close', () => {
          updateStatus(statusNode, 'Terminal connection closed.', true);
          if (!closedByPage && !reconnectTimer) {
            reconnectTimer = setTimeout(() => {
              reconnectTimer = null;
              connect();
            }, 2000);
          }
        });

        socket.addEventListener('error', () => {
          updateStatus(statusNode, 'Terminal connection failed.', true);
        });
      };

      const installCopyButton = (button, input) => {
        button.addEventListener('click', async () => {
          const value = input.value;
          try {
            await navigator.clipboard.writeText(value);
            button.textContent = 'Copied';
            setTimeout(() => {
              button.textContent = 'Copy URL';
            }, 1200);
          } catch {
            input.select();
            document.execCommand('copy');
          }
        });
      };

      installCopyButton(copyButton, websocketUrlNode);
      installCopyButton(agentCopyButton, agentWebsocketUrlNode);

      tmuxView.term.onData((value) => {
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'input', data: value }));
        }
      });
      tmuxView.term.onResize(({ cols, rows }) => {
        if (!socket || socket.readyState !== WebSocket.OPEN) return;
        socket.send(JSON.stringify({ type: 'resize', cols, rows }));
      });

      let bridgeSocket = null;
      let bridgeReconnectTimer = null;
      let bridgeClosedByPage = false;
      let bridgeClientId = null;
      let bridgeSessionId = null;
      const bridgeUrl = new URL(bootstrap.bridge.websocketUrl);

      const setBridgeButtons = () => {
        agentStartButton.disabled =
          !bootstrap.bridge.enabled || Boolean(bridgeSessionId);
        agentStopButton.disabled = !bridgeSessionId;
      };

      const sendBridge = (payload) => {
        if (!bridgeSocket || bridgeSocket.readyState !== WebSocket.OPEN) return false;
        bridgeSocket.send(JSON.stringify(payload));
        return true;
      };

      const attachBridgeSession = () => {
        if (!bridgeSessionId || !bridgeClientId) return;
        sendBridge({
          type: 'attach_session',
          sessionId: bridgeSessionId,
          clientId: bridgeClientId,
          afterSeq: 0
        });
        sendBridge({
          type: 'resize_session',
          sessionId: bridgeSessionId,
          clientId: bridgeClientId,
          cols: agentView.cols(),
          rows: agentView.rows()
        });
      };

      const connectBridge = () => {
        if (!bootstrap.bridge.enabled) {
          setBridgeButtons();
          return;
        }

        bridgeClosedByPage = false;
        bridgeSocket = new WebSocket(bridgeUrl.toString());

        bridgeSocket.addEventListener('open', () => {
          updateStatus(
            agentStatusNode,
            bridgeSessionId
              ? 'Bridge connected. Reattaching AI agent session.'
              : 'Bridge connected. Start a session to attach the agent terminal.'
          );
          sendBridge({ type: 'health' });
          sendBridge({ type: 'list_providers' });
          if (bridgeSessionId) attachBridgeSession();
        });

        bridgeSocket.addEventListener('message', (event) => {
          const payload = JSON.parse(event.data);

          if (payload.type === 'providers_list' && Array.isArray(payload.providers)) {
            agentProviderNode.innerHTML = '';
            for (const provider of payload.providers) {
              if (!provider || typeof provider.provider !== 'string') continue;
              const option = document.createElement('option');
              option.value = provider.provider;
              option.textContent = provider.provider;
              if (payload.providers.length === 1 || provider.provider === bootstrap.bridge.defaultProvider) {
                option.selected = true;
              }
              agentProviderNode.appendChild(option);
            }
            return;
          }

          if (payload.type === 'session_started' && typeof payload.sessionId === 'string') {
            bridgeSessionId = payload.sessionId;
            bridgeClientId = crypto.randomUUID();
            agentView.clear();
            updateStatus(agentStatusNode, 'AI agent session started. Attaching terminal…');
            attachBridgeSession();
            setBridgeButtons();
            return;
          }

          if (payload.type === 'attach_event') {
            if (payload.eventType === 'output' && typeof payload.payloadB64 === 'string') {
              const bytes = Uint8Array.from(atob(payload.payloadB64), (c) => c.charCodeAt(0));
              agentView.write(bytes);
            }
            if (payload.eventType === 'attached') {
              updateStatus(agentStatusNode, 'AI agent attached to session ' + payload.sessionId);
            }
            if (payload.eventType === 'session_exit') {
              updateStatus(agentStatusNode, 'AI agent session exited.', true);
            }
            if (payload.eventType === 'error') {
              updateStatus(agentStatusNode, payload.error || 'AI agent stream error.', true);
            }
            return;
          }

          if (payload.type === 'session_stopped') {
            bridgeSessionId = null;
            bridgeClientId = null;
            setBridgeButtons();
            updateStatus(agentStatusNode, 'AI agent session stopped.');
            return;
          }

          if (payload.type === 'error') {
            updateStatus(agentStatusNode, payload.message || 'Bridge error.', true);
          }
        });

        bridgeSocket.addEventListener('close', () => {
          updateStatus(agentStatusNode, 'Bridge connection closed.', true);
          if (!bridgeClosedByPage && !bridgeReconnectTimer && bootstrap.bridge.enabled) {
            bridgeReconnectTimer = setTimeout(() => {
              bridgeReconnectTimer = null;
              connectBridge();
            }, 2000);
          }
        });

        bridgeSocket.addEventListener('error', () => {
          updateStatus(agentStatusNode, 'Bridge connection failed.', true);
        });
      };

      agentStartButton.addEventListener('click', () => {
        if (!bootstrap.bridge.enabled) return;
        if (!bridgeSocket || bridgeSocket.readyState !== WebSocket.OPEN) {
          updateStatus(agentStatusNode, 'Bridge is not connected yet.', true);
          return;
        }
        const sessionId = crypto.randomUUID();
        bridgeClientId = crypto.randomUUID();
        bridgeSessionId = sessionId;
        setBridgeButtons();
        const provider = agentProviderNode.value || bootstrap.bridge.defaultProvider;
        const started = sendBridge({
          type: 'start_session',
          projectId: bootstrap.bridge.projectId,
          sessionId,
          repoPath: bootstrap.bridge.workspaceDir,
          provider,
          initialCols: agentView.cols(),
          initialRows: agentView.rows()
        });
        if (!started) {
          bridgeSessionId = null;
          bridgeClientId = null;
          setBridgeButtons();
          updateStatus(agentStatusNode, 'Bridge is not connected yet.', true);
          return;
        }
        updateStatus(agentStatusNode, 'Starting AI agent session…');
      });

      agentStopButton.addEventListener('click', () => {
        if (!bridgeSessionId) return;
        sendBridge({
          type: 'stop_session',
          sessionId: bridgeSessionId,
          force: true
        });
      });

      agentView.term.onData((value) => {
        if (!bridgeSessionId || !bridgeClientId) return;
        sendBridge({
          type: 'send_input',
          sessionId: bridgeSessionId,
          clientId: bridgeClientId,
          text: value
        });
      });

      agentView.term.onResize(({ cols, rows }) => {
        if (!bridgeSessionId || !bridgeClientId) return;
        sendBridge({
          type: 'resize_session',
          sessionId: bridgeSessionId,
          clientId: bridgeClientId,
          cols,
          rows
        });
      });

      window.addEventListener('resize', () => {
        reportResize();
        if (bridgeSessionId && bridgeClientId) {
          sendBridge({
            type: 'resize_session',
            sessionId: bridgeSessionId,
            clientId: bridgeClientId,
            cols: agentView.cols(),
            rows: agentView.rows()
          });
        }
      }, { passive: true });
      window.addEventListener('beforeunload', () => {
        closedByPage = true;
        if (socket) socket.close();
        if (reconnectTimer) clearTimeout(reconnectTimer);
        bridgeClosedByPage = true;
        if (bridgeSocket) bridgeSocket.close();
        if (bridgeReconnectTimer) clearTimeout(bridgeReconnectTimer);
        tmuxView.dispose();
        agentView.dispose();
      });

      connect();
      connectBridge();
      setBridgeButtons();
      tmuxView.focus();
    })();
  </script>
</body>
</html>`;
}

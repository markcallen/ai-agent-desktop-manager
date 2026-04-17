#!/usr/bin/env node
/* global document, HTMLElement, HTMLSelectElement, HTMLInputElement */
/**
 * Tab smoke test — verifies all three desktop shell tabs load correctly:
 *
 *   Tab 1 (AI Agent) — provider select has "claude" option, bridge controls
 *                      visible, agent terminal mount renders xterm
 *   Tab 2 (Terminal) — tmux session attaches (status shows "Attached to tmux
 *                      session"), xterm renders in #terminal-mount
 *   Tab 3 (noVNC)   — iframe canvas renders with non-zero dimensions
 *
 * Usage:
 *   node smoke/tab-smoke.mjs \
 *     --url <desktop-shell-url> \
 *     --vnc-password <password> \
 *     --screenshot-dir <dir> \
 *     [--ignore-https-errors true]
 */

import process from 'node:process';
import path from 'node:path';
import fs from 'node:fs/promises';

function die(message) {
  console.error(`[tab-smoke] ERROR: ${message}`);
  process.exit(1);
}

export function parseArgs(argv) {
  const options = {
    url: '',
    vncPassword: '',
    screenshotDir: '',
    ignoreHttpsErrors: 'false'
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    switch (arg) {
      case '--url':
        options.url = argv[index + 1] ?? '';
        index += 1;
        break;
      case '--vnc-password':
        options.vncPassword = argv[index + 1] ?? '';
        index += 1;
        break;
      case '--screenshot-dir':
        options.screenshotDir = argv[index + 1] ?? '';
        index += 1;
        break;
      case '--ignore-https-errors':
        options.ignoreHttpsErrors = argv[index + 1] ?? 'false';
        index += 1;
        break;
      default:
        die(`Unknown argument: ${arg}`);
    }
  }

  if (!options.url) {
    die('--url is required');
  }
  if (!options.screenshotDir) {
    die('--screenshot-dir is required');
  }

  return options;
}

/** Wait for the agent tab to be ready: xterm rendered, provider has claude. */
async function checkAgentTab(page, screenshotDir) {
  console.log('[tab-smoke] Checking AI Agent tab…');

  // Agent tab is active by default — wait for agent-terminal-mount to contain xterm
  await page.waitForSelector('#agent-terminal-mount', { timeout: 15000 });
  await page.waitForSelector('#agent-status', { timeout: 15000 });

  // Verify provider select has the "claude" option
  const hasClaudeOption = await page.evaluate(() => {
    const select = document.querySelector('#agent-provider');
    if (!(select instanceof HTMLSelectElement)) return false;
    return Array.from(select.options).some((o) => o.value === 'claude');
  });

  if (!hasClaudeOption) {
    throw new Error(
      'AI Agent tab: #agent-provider does not have a "claude" option'
    );
  }

  // Verify start/stop controls are present
  const hasControls = await page.evaluate(() => {
    return (
      Boolean(document.querySelector('#agent-start')) &&
      Boolean(document.querySelector('#agent-stop'))
    );
  });

  if (!hasControls) {
    throw new Error('AI Agent tab: start/stop buttons missing');
  }

  await page.screenshot({
    path: path.join(screenshotDir, 'tab-agent.png'),
    fullPage: true
  });
  console.log('[tab-smoke] AI Agent tab OK');
}

/** Click the Terminal tab and wait for tmux to attach. */
async function checkTerminalTab(page, screenshotDir) {
  console.log('[tab-smoke] Checking Terminal tab…');

  await page.click('[data-tab-btn="terminal"]');

  // Wait for xterm to be visible in the terminal mount
  await page.waitForSelector('#terminal-mount', { timeout: 15000 });

  // Wait for tmux to attach (status message changes from "Connecting…")
  await page.waitForFunction(
    () => {
      const status = document.querySelector('#terminal-status');
      if (!(status instanceof HTMLElement)) return false;
      const text = status.textContent ?? '';
      return /attached to tmux session/i.test(text);
    },
    undefined,
    { timeout: 60000 }
  );

  // Confirm at least one xterm canvas is rendered inside terminal-mount
  await page.waitForSelector('#terminal-mount .xterm', { timeout: 15000 });

  // Verify the session name appears somewhere on the terminal panel
  const sessionOk = await page.evaluate(() => {
    const status = document.querySelector('#terminal-status');
    return status ? /aadm-desk/i.test(status.textContent ?? '') : false;
  });

  if (!sessionOk) {
    const statusText = await page.evaluate(() => {
      const status = document.querySelector('#terminal-status');
      return status?.textContent ?? '(missing)';
    });
    throw new Error(
      `Terminal tab: status does not mention tmux session name. Got: "${statusText}"`
    );
  }

  await page.screenshot({
    path: path.join(screenshotDir, 'tab-terminal.png'),
    fullPage: true
  });
  console.log('[tab-smoke] Terminal tab OK');
}

/** Click the noVNC tab and wait for the iframe canvas to render. */
async function checkNovncTab(page, vncPassword, screenshotDir) {
  console.log('[tab-smoke] Checking noVNC tab…');

  await page.click('[data-tab-btn="novnc"]');

  // Wait for the iframe to be in the DOM
  const frameHandle = await page.waitForSelector(
    'iframe[data-aadm-desktop-frame]',
    { state: 'attached', timeout: 15000 }
  );

  const frame = await frameHandle.contentFrame();
  if (!frame) {
    throw new Error(
      'noVNC tab: could not get contentFrame from desktop iframe'
    );
  }

  // Handle VNC password prompt if needed
  if (vncPassword) {
    await frame.waitForTimeout(5000);

    // Either the canvas is ready or a password prompt appeared
    await frame.waitForFunction(
      () => {
        const canvas = document.querySelector('canvas');
        if (canvas && canvas.width > 0 && canvas.height > 0) return true;
        return Boolean(
          document.querySelector('#noVNC_password') ||
          document.querySelector('#noVNC_password_input') ||
          document.querySelector('input[type="password"]')
        );
      },
      undefined,
      { timeout: 120000 }
    );

    const alreadyConnected = await frame.evaluate(() => {
      const canvas = document.querySelector('canvas');
      return Boolean(canvas && canvas.width > 0 && canvas.height > 0);
    });

    if (!alreadyConnected) {
      await frame.evaluate((password) => {
        const passwordInput =
          document.querySelector('#noVNC_password') ||
          document.querySelector('#noVNC_password_input') ||
          document.querySelector('input[type="password"]');

        if (!(passwordInput instanceof HTMLInputElement)) return;

        passwordInput.focus();
        passwordInput.value = password;
        passwordInput.dispatchEvent(new Event('input', { bubbles: true }));
        passwordInput.dispatchEvent(new Event('change', { bubbles: true }));

        const connectButton =
          document.querySelector('#noVNC_credentials_button') ||
          document.querySelector('#noVNC_connect_button') ||
          Array.from(
            document.querySelectorAll(
              "button, input[type='button'], input[type='submit']"
            )
          ).find((el) =>
            /connect|send credentials/i.test(el.textContent || el.value || '')
          );

        if (connectButton instanceof HTMLElement) {
          connectButton.click();
        } else {
          passwordInput.form?.requestSubmit();
        }
      }, vncPassword);

      await frame.waitForTimeout(5000);
    }
  }

  // Wait for a canvas with non-zero dimensions
  await frame.waitForFunction(
    () => {
      const canvas = document.querySelector('canvas');
      return Boolean(canvas && canvas.width > 0 && canvas.height > 0);
    },
    undefined,
    { timeout: 120000 }
  );

  const dims = await frame.evaluate(() => {
    const canvas = document.querySelector('canvas');
    return canvas ? { w: canvas.width, h: canvas.height } : null;
  });

  if (!dims || dims.w === 0 || dims.h === 0) {
    throw new Error(
      `noVNC tab: canvas has zero dimensions: ${JSON.stringify(dims)}`
    );
  }

  console.log(`[tab-smoke] noVNC canvas: ${dims.w}x${dims.h}`);

  await page.screenshot({
    path: path.join(screenshotDir, 'tab-novnc.png'),
    fullPage: true
  });
  console.log('[tab-smoke] noVNC tab OK');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  await fs.mkdir(options.screenshotDir, { recursive: true });

  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ignoreHTTPSErrors: options.ignoreHttpsErrors === 'true',
    viewport: { width: 1440, height: 900 }
  });
  const page = await context.newPage();

  try {
    console.log(`[tab-smoke] Navigating to ${options.url}`);
    await page.goto(options.url, {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });

    // Verify 3-tab bar is present
    await page.waitForSelector('#aadm-tab-bar', { timeout: 10000 });
    const tabCount = await page.evaluate(
      () => document.querySelectorAll('[data-tab-btn]').length
    );
    if (tabCount !== 3) {
      throw new Error(`Expected 3 tab buttons, found ${tabCount}`);
    }

    await checkAgentTab(page, options.screenshotDir);
    await checkTerminalTab(page, options.screenshotDir);
    await checkNovncTab(page, options.vncPassword, options.screenshotDir);
  } finally {
    await context.close();
    await browser.close();
  }

  console.log('TAB SMOKE PASSED');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    die(error instanceof Error ? error.message : String(error));
  });
}

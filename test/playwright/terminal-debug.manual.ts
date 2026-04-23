/**
 * Focused diagnostic test for the terminal tab.
 * Run via:  ./scripts/debug-terminal.sh
 *
 * Navigates to desk-2, switches to the Terminal tab, and dumps:
 *   - What selectors exist inside #terminal-mount
 *   - The full textContent of .xterm-rows before and after typing ls -al
 *   - Whether the xterm-helper-textarea was found and focused
 *   - Any WebSocket messages seen on the page
 *
 * The goal is to understand WHY the main smoke test's waitForFunction for
 * /total\s+\d+/ in .xterm-rows times out.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const ACCESS_URL = process.env.SMOKE_ACCESS_URL ?? '';

if (!process.env.SMOKE_PLAYWRIGHT) {
  console.error('Run via ./scripts/debug-terminal.sh');
  process.exit(1);
}

test(
  'terminal debug: diagnose xterm DOM and input delivery',
  { timeout: 120_000 },
  async () => {
    assert.ok(ACCESS_URL, 'SMOKE_ACCESS_URL must be set');

    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const ctx = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: 1440, height: 900 }
    });

    // Capture all console messages from the page for diagnostics
    const consoleLogs: string[] = [];
    const wsMessages: string[] = [];

    try {
      const page = await ctx.newPage();

      page.on('console', (msg) => {
        consoleLogs.push(`[${msg.type()}] ${msg.text()}`);
      });

      // Intercept WebSocket traffic to verify terminal input is being sent
      await page.route('**', (route) => route.continue());
      page.on('websocket', (ws) => {
        ws.on('framesent', (frame) => {
          wsMessages.push(`SENT: ${frame.payload?.toString().slice(0, 200)}`);
        });
        ws.on('framereceived', (frame) => {
          const text = frame.payload?.toString().slice(0, 200) ?? '';
          // Only log terminal-related messages to avoid noise
          if (
            text.includes('terminal') ||
            text.includes('output') ||
            text.includes('ready')
          ) {
            wsMessages.push(`RECV: ${text}`);
          }
        });
      });

      console.log('\n=== Navigating to desk-2 access URL ===');
      await page.goto(ACCESS_URL, {
        waitUntil: 'domcontentloaded',
        timeout: 30_000
      });
      console.log('Current URL:', page.url());

      // Wait for tab bar
      await page.waitForSelector('#aadm-tab-bar', { timeout: 15_000 });
      console.log('Tab bar found.');

      // Switch to Terminal tab
      console.log('\n=== Clicking Terminal tab ===');
      await page.click('[data-tab-btn="terminal"]', { force: true });

      // Wait for terminal mount
      await page.waitForSelector('#terminal-mount', {
        state: 'attached',
        timeout: 15_000
      });
      console.log('#terminal-mount found.');

      // Wait for "attached to tmux session" in status
      console.log('\n=== Waiting for tmux session attach (60s) ===');
      await page.waitForFunction(
        () => {
          const status = document.querySelector('#terminal-status');
          if (!(status instanceof HTMLElement)) return false;
          return /attached to tmux session/i.test(status.textContent ?? '');
        },
        undefined,
        { timeout: 60_000 }
      );
      const statusText = await page.$eval('#terminal-status', (el) =>
        el.textContent?.trim()
      );
      console.log('Terminal status:', statusText);

      // Wait for .xterm element
      await page.waitForSelector('#terminal-mount .xterm', { timeout: 15_000 });
      console.log('.xterm element found inside #terminal-mount.');

      // --- Dump the full DOM structure inside #terminal-mount ---
      console.log('\n=== DOM structure inside #terminal-mount ===');
      const domInfo = await page.evaluate(() => {
        const mount = document.querySelector('#terminal-mount');
        if (!mount) return 'NOT FOUND';
        // Walk via a stack to avoid named recursive functions (which tsx mangles)
        const lines: string[] = [];
        const stack: Array<{ el: Element; depth: number }> = [
          { el: mount, depth: 0 }
        ];
        while (stack.length) {
          const item = stack.shift()!;
          const indent = '  '.repeat(item.depth);
          const id = item.el.id ? `#${item.el.id}` : '';
          const cls =
            item.el.className && typeof item.el.className === 'string'
              ? `.${Array.from(item.el.classList).join('.')}`
              : '';
          const tag = item.el.tagName.toLowerCase();
          const leafText =
            item.el.childElementCount === 0
              ? ` text="${(item.el.textContent ?? '').slice(0, 80).replace(/\s+/g, ' ').trim()}"`
              : '';
          lines.push(`${indent}<${tag}${id}${cls}${leafText}>`);
          const children = Array.from(item.el.children).slice(0, 10);
          for (let i = children.length - 1; i >= 0; i--) {
            stack.unshift({ el: children[i], depth: item.depth + 1 });
          }
        }
        return lines.join('\n');
      });
      console.log(domInfo);

      // --- Check for specific xterm selectors ---
      console.log('\n=== Checking xterm selectors ===');
      const selectorChecks = await page.evaluate(() => {
        const selectors = [
          '#terminal-mount .xterm',
          '#terminal-mount .xterm-screen',
          '#terminal-mount .xterm-rows',
          '#terminal-mount .xterm-helper-textarea',
          '#terminal-mount .xterm-accessibility',
          '#terminal-mount canvas',
          '#terminal-mount .xterm-viewport'
        ];
        return selectors.map((sel) => {
          const el = document.querySelector(sel);
          return {
            selector: sel,
            found: !!el,
            textContentLength: el?.textContent?.length ?? 0,
            textContentPreview:
              el?.textContent?.slice(0, 100).replace(/\s+/g, ' ').trim() ?? ''
          };
        });
      });
      for (const {
        selector,
        found,
        textContentLength,
        textContentPreview
      } of selectorChecks) {
        console.log(`  ${found ? '✓' : '✗'} ${selector}`);
        if (found && textContentLength > 0) {
          console.log(
            `      length=${textContentLength} preview="${textContentPreview}"`
          );
        }
      }

      // --- Get full xterm-rows textContent before typing ---
      const beforeText = await page.evaluate(() => {
        const rows = document.querySelector('#terminal-mount .xterm-rows');
        return rows?.textContent ?? 'NOT FOUND';
      });
      console.log('\n=== .xterm-rows textContent BEFORE typing ===');
      console.log(JSON.stringify(beforeText.slice(0, 500)));
      console.log('  matches /[$#]/:', /[$#]/.test(beforeText));
      console.log(
        '  matches /[$#]\\s*$/ (end-anchored):',
        /[$#]\s*$/.test(beforeText)
      );

      // --- Focus and type ---
      console.log('\n=== Clicking .xterm-screen and focusing textarea ===');
      await page.click('#terminal-mount .xterm-screen', { force: true });
      const textareaFound = await page.evaluate(() => {
        const ta = document.querySelector<HTMLTextAreaElement>(
          '#terminal-mount .xterm-helper-textarea'
        );
        if (!ta) return false;
        ta.focus();
        return true;
      });
      console.log('.xterm-helper-textarea found and focused:', textareaFound);

      // Type 'ls -al' and Enter
      console.log('\n=== Typing "ls -al" + Enter ===');
      await page.keyboard.type('ls -al');
      await page.keyboard.press('Enter');

      console.log('WebSocket messages so far:');
      for (const msg of wsMessages.slice(0, 20)) {
        console.log(' ', msg);
      }

      // Poll .xterm-rows for 30s, printing content every 3s
      console.log('\n=== Polling .xterm-rows for "total \\d+" (30s) ===');
      let found = false;
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const text = await page.evaluate(() => {
          const rows = document.querySelector('#terminal-mount .xterm-rows');
          return rows?.textContent ?? 'NOT FOUND';
        });
        const matched = /\btotal\s+\d+/.test(text);
        console.log(
          `  [${(i + 1) * 3}s] textContent length=${text.length} matched=${matched}`
        );
        console.log(
          `       preview: ${JSON.stringify(text.slice(0, 200).replace(/\s+/g, ' ').trim())}`
        );
        if (matched) {
          found = true;
          console.log('  MATCH FOUND!');
          break;
        }
      }

      // --- Also check accessibility rows specifically ---
      console.log('\n=== Checking .xterm-accessibility ===');
      const accessibilityInfo = await page.evaluate(() => {
        const acc = document.querySelector(
          '#terminal-mount .xterm-accessibility'
        );
        if (!acc) return { found: false, html: '' };
        return {
          found: true,
          textContent: acc.textContent?.slice(0, 300) ?? '',
          childCount: acc.children.length,
          html: acc.innerHTML?.slice(0, 500) ?? ''
        };
      });
      console.log(JSON.stringify(accessibilityInfo, null, 2));

      // --- Final WebSocket messages ---
      console.log('\n=== WebSocket messages (all) ===');
      for (const msg of wsMessages) {
        console.log(' ', msg);
      }

      // --- Console logs from page ---
      if (consoleLogs.length > 0) {
        console.log('\n=== Page console logs ===');
        for (const log of consoleLogs.slice(0, 30)) {
          console.log(' ', log);
        }
      }

      console.log(
        `\n=== Result: total\\d+ found in .xterm-rows = ${found} ===`
      );

      // Don't fail — this is a diagnostic test. Just assert we can navigate.
      assert.ok(true, 'diagnostic complete');
    } finally {
      await ctx.close();
      await browser.close();
    }
  }
);

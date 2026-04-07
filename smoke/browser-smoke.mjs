#!/usr/bin/env node
/* global document, HTMLInputElement, HTMLElement */

import process from 'node:process';

function die(message) {
  console.error(`[smoke] ERROR: ${message}`);
  process.exit(1);
}

export function parseArgs(argv) {
  const options = {
    url: '',
    vncPassword: '',
    screenshot: '',
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
      case '--screenshot':
        options.screenshot = argv[index + 1] ?? '';
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
  if (!options.screenshot) {
    die('--screenshot is required');
  }

  return options;
}

export function buildConnectUrl(rawUrl) {
  const url = new URL(rawUrl);
  if (url.pathname.endsWith('/access')) {
    return url;
  }
  if (!url.pathname.endsWith('/vnc.html')) {
    const nextPath = url.pathname.endsWith('/')
      ? `${url.pathname}vnc.html`
      : `${url.pathname}/vnc.html`;
    url.pathname = nextPath;
  }
  url.searchParams.set('autoconnect', '1');
  url.searchParams.set('resize', 'remote');
  return url;
}

export async function waitForCanvas(page) {
  await page.waitForFunction(
    () => {
      const canvas = document.querySelector('canvas');
      return Boolean(canvas && canvas.width > 0 && canvas.height > 0);
    },
    undefined,
    { timeout: 120000 }
  );
}

export async function maybeEnterPassword(page, vncPassword) {
  if (!vncPassword) {
    await waitForCanvas(page);
    return;
  }

  await page.waitForTimeout(5000);

  await page.waitForFunction(
    () => {
      const canvas = document.querySelector('canvas');
      if (canvas && canvas.width > 0 && canvas.height > 0) {
        return true;
      }

      return Boolean(
        document.querySelector('#noVNC_password') ||
        document.querySelector('#noVNC_password_input') ||
        document.querySelector('input[type="password"]')
      );
    },
    undefined,
    { timeout: 120000 }
  );

  const connected = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    return Boolean(canvas && canvas.width > 0 && canvas.height > 0);
  });

  if (connected) {
    return;
  }

  const submitCredentials = async () =>
    page.evaluate((password) => {
      const passwordInput =
        document.querySelector('#noVNC_password') ||
        document.querySelector('#noVNC_password_input') ||
        document.querySelector('input[type="password"]');

      if (!(passwordInput instanceof HTMLInputElement)) {
        return false;
      }

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
        ).find((element) =>
          /connect|send credentials/i.test(
            element.textContent || element.value || ''
          )
        );

      if (connectButton instanceof HTMLElement) {
        connectButton.click();
        return true;
      }

      passwordInput.form?.requestSubmit();
      return true;
    }, vncPassword);

  await submitCredentials();
  await page.waitForTimeout(5000);
  await waitForCanvas(page);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ignoreHTTPSErrors: options.ignoreHttpsErrors === 'true',
    viewport: { width: 1440, height: 900 }
  });
  const page = await context.newPage();

  try {
    await page.goto(buildConnectUrl(options.url).toString(), {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });
    await maybeEnterPassword(page, options.vncPassword);
    await page.waitForTimeout(5000);
    await page.screenshot({ path: options.screenshot, fullPage: true });
  } finally {
    await context.close();
    await browser.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    die(error instanceof Error ? error.message : String(error));
  });
}

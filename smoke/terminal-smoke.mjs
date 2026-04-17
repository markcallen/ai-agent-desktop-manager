#!/usr/bin/env node
import fs from 'node:fs/promises';
import process from 'node:process';

function die(message) {
  console.error(`[terminal-smoke] ERROR: ${message}`);
  process.exit(1);
}

export function parseArgs(argv) {
  const options = {
    desktopAccessUrl: '',
    output: ''
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    switch (arg) {
      case '--desktop-access-url':
        options.desktopAccessUrl = argv[index + 1] ?? '';
        index += 1;
        break;
      case '--output':
        options.output = argv[index + 1] ?? '';
        index += 1;
        break;
      default:
        die(`Unknown argument: ${arg}`);
    }
  }

  if (!options.desktopAccessUrl) {
    die('--desktop-access-url is required');
  }
  if (!options.output) {
    die('--output is required');
  }

  return options;
}

export function buildTerminalWebsocketUrl(desktopAccessUrl) {
  const url = new URL(desktopAccessUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  // Extract display from URL path: /desktop/<display>/...
  const pathParts = url.pathname.split('/').filter(Boolean);
  const displayIndex = pathParts.indexOf('desktop');
  if (displayIndex === -1 || displayIndex + 1 >= pathParts.length) {
    throw new Error('Invalid desktop access URL');
  }
  const display = pathParts[displayIndex + 1];
  const desktopId = `desk-${display}`;
  url.pathname = `/_aadm/terminal/${desktopId}/ws`;
  url.search = '';
  return url.toString();
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const output = {
    desktopAccessUrl: options.desktopAccessUrl,
    terminalWebsocketUrl: buildTerminalWebsocketUrl(options.desktopAccessUrl)
  };
  await fs.writeFile(options.output, JSON.stringify(output, null, 2), 'utf8');
  console.log('TERMINAL SMOKE PASSED');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    die(error instanceof Error ? error.message : String(error));
  });
}

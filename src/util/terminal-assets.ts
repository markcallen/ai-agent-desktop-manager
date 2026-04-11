import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

type TerminalAsset = {
  path: string;
  contentType: string;
};

const assets: Record<string, TerminalAsset> = {
  'xterm.css': {
    path: path.join(
      path.dirname(require.resolve('@xterm/xterm/package.json')),
      'css',
      'xterm.css'
    ),
    contentType: 'text/css; charset=utf-8'
  },
  'xterm.js': {
    path: path.join(
      path.dirname(require.resolve('@xterm/xterm/package.json')),
      'lib',
      'xterm.js'
    ),
    contentType: 'application/javascript; charset=utf-8'
  },
  'addon-fit.js': {
    path: path.join(
      path.dirname(require.resolve('@xterm/addon-fit/package.json')),
      'lib',
      'addon-fit.js'
    ),
    contentType: 'application/javascript; charset=utf-8'
  }
};

const cache = new Map<string, Buffer>();

export async function loadTerminalAsset(name: string) {
  const asset = assets[name];
  if (!asset) return undefined;

  let body = cache.get(name);
  if (!body) {
    body = await fs.readFile(asset.path);
    cache.set(name, body);
  }

  return {
    contentType: asset.contentType,
    body
  };
}

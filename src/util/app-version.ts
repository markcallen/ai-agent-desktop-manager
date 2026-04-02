import fs from 'node:fs';

type PackageJson = {
  version?: string;
};

function loadAppVersion() {
  try {
    const packageJsonUrl = new URL('../../package.json', import.meta.url);
    const raw = fs.readFileSync(packageJsonUrl, 'utf8');
    const parsed = JSON.parse(raw) as PackageJson;
    return parsed.version ?? '0.0.0-dev';
  } catch {
    return '0.0.0-dev';
  }
}

export const appVersion = loadAppVersion();

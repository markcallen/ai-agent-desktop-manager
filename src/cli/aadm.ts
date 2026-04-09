#!/usr/bin/env node
import { argv, exit } from 'node:process';
import { requestJson, AadmRequestError } from '../util/aadm-client.js';

type Cmd = 'create' | 'list' | 'get' | 'destroy' | 'doctor' | 'access-url';

function arg(name: string) {
  const idx = argv.indexOf(name);
  if (idx === -1) return undefined;
  return argv[idx + 1];
}

async function main() {
  const cmd = (argv[2] as Cmd) || 'list';

  if (cmd === 'list') {
    console.log(JSON.stringify(await requestJson('/v1/desktops'), null, 2));
    return;
  }

  if (cmd === 'create') {
    const owner = arg('--owner');
    const label = arg('--label');
    const ttl = arg('--ttl');
    const startUrl = arg('--start-url');
    const routeAuthMode = arg('--route-auth-mode');
    const body: Record<string, unknown> = {};
    if (owner) body.owner = owner;
    if (label) body.label = label;
    if (ttl) body.ttlMinutes = Number(ttl);
    if (startUrl) body.startUrl = startUrl;
    if (routeAuthMode) body.routeAuthMode = routeAuthMode;

    console.log(
      JSON.stringify(
        await requestJson('/v1/desktops', {
          method: 'POST',
          body
        }),
        null,
        2
      )
    );
    return;
  }

  if (cmd === 'access-url') {
    const id = arg('--id');
    const ttlSeconds = arg('--ttl-seconds');
    if (!id) throw new Error('missing --id');

    const body: Record<string, unknown> = {};
    if (ttlSeconds) body.ttlSeconds = Number(ttlSeconds);

    console.log(
      JSON.stringify(
        await requestJson(`/v1/desktops/${id}/access-url`, {
          method: 'POST',
          body
        }),
        null,
        2
      )
    );
    return;
  }

  if (cmd === 'get') {
    const id = arg('--id');
    if (!id) throw new Error('missing --id');
    console.log(
      JSON.stringify(await requestJson(`/v1/desktops/${id}`), null, 2)
    );
    return;
  }

  if (cmd === 'doctor') {
    const id = arg('--id');
    if (!id) throw new Error('missing --id');
    console.log(
      JSON.stringify(await requestJson(`/v1/desktops/${id}/doctor`), null, 2)
    );
    return;
  }

  if (cmd === 'destroy') {
    const id = arg('--id');
    if (!id) throw new Error('missing --id');
    console.log(
      JSON.stringify(
        await requestJson(`/v1/desktops/${id}`, { method: 'DELETE' }),
        null,
        2
      )
    );
    return;
  }

  console.error(
    'Unknown command. Use: create|list|get|doctor|destroy|access-url'
  );
  exit(2);
}

main().catch((e) => {
  if (e instanceof AadmRequestError) {
    console.error(
      JSON.stringify({ ok: false, status: e.status, data: e.data }, null, 2)
    );
    exit(1);
  }
  console.error(String(e?.message ?? e));
  exit(1);
});

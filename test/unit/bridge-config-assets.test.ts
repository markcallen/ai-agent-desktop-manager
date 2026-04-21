import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const repoRoot = new URL('../../', import.meta.url);

async function readRepoFile(relativePath: string) {
  return await fs.readFile(new URL(relativePath, repoRoot), 'utf8');
}

test('local bridge config allows the production workspace root', async () => {
  const config = await readRepoFile('local/bridge-local.yaml');

  assert.match(
    config,
    /allowed_paths:\s*\n(?:.*\n)*\s*-\s*'\/opt\/ai-agent-desktop-manager\/data\/workspaces'/
  );
});

test('bridge service mounts the production workspace root at the same path', async () => {
  const unit = await readRepoFile('systemd/bridge.service');

  assert.match(
    unit,
    /-v \/opt\/ai-agent-desktop-manager\/data\/workspaces:\/opt\/ai-agent-desktop-manager\/data\/workspaces \\/
  );
});

test('smoke playbook renders the production workspace root into bridge allowed paths', async () => {
  const playbook = await readRepoFile('infra/ansible/playbooks/aadm_smoke.yml');

  assert.match(
    playbook,
    /allowed_paths:\s*\n\s*-\s*\/app\/data\/workspaces\s*\n\s*-\s*\/opt\/ai-agent-desktop-manager\/data\/workspaces/
  );
});

test('smoke playbook restarts bridge after unit or config changes before readiness checks', async () => {
  const playbook = await readRepoFile('infra/ansible/playbooks/aadm_smoke.yml');

  assert.match(
    playbook,
    /Render bridge configuration[\s\S]*notify: Restart bridge service/
  );
  assert.match(
    playbook,
    /Render bridge environment file[\s\S]*notify: Restart bridge service/
  );
  assert.match(
    playbook,
    /Install bridge systemd service[\s\S]*notify: Reload and restart bridge service/
  );
  assert.match(
    playbook,
    /Apply pending bridge service changes before readiness checks[\s\S]*meta: flush_handlers/
  );
});

test('smoke playbook ensures Docker is started before bridge startup', async () => {
  const playbook = await readRepoFile('infra/ansible/playbooks/aadm_smoke.yml');

  assert.match(
    playbook,
    /Ensure Docker service is enabled and started[\s\S]*name: docker[\s\S]*state: started/
  );
});

test('smoke playbook performs a final active-service verification for docker, aadm, nginx, and bridge', async () => {
  const playbook = await readRepoFile('infra/ansible/playbooks/aadm_smoke.yml');

  assert.match(
    playbook,
    /Verify required services are active after smoke provisioning[\s\S]*loop:\s*\n\s*-\s*docker\s*\n\s*-\s*aadm\.service\s*\n\s*-\s*nginx/
  );
  assert.match(
    playbook,
    /Assert required services are active after smoke provisioning[\s\S]*Required service \{\{ item\.item \}\} is not active after smoke provisioning/
  );
  assert.match(
    playbook,
    /Verify bridge service is active after smoke provisioning[\s\S]*cmd: systemctl is-active bridge\.service/
  );
  assert.match(
    playbook,
    /Assert bridge service is active after smoke provisioning[\s\S]*bridge\.service is not active after smoke provisioning/
  );
});

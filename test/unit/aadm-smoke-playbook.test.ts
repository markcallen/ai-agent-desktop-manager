import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const playbookPath = path.resolve('infra/ansible/playbooks/aadm_smoke.yml');

test('smoke playbook configures a desktop route token secret', () => {
  const playbook = fs.readFileSync(playbookPath, 'utf8');

  assert.match(
    playbook,
    /AADM_DESKTOP_ROUTE_TOKEN_SECRET=\{\{ aadm_desktop_route_token_secret \}\}/
  );
});

test('smoke playbook restarts aadm when the manager env changes', () => {
  const playbook = fs.readFileSync(playbookPath, 'utf8');

  assert.match(
    playbook,
    /- name: Render manager environment[\s\S]*notify:\s*\n\s*- Restart aadm/
  );
  assert.match(
    playbook,
    /- name: Restart aadm[\s\S]*name: aadm\.service[\s\S]*state: restarted/
  );
});

test('smoke playbook waits for desktop ports using display-min offset math', () => {
  const playbook = fs.readFileSync(playbookPath, 'utf8');

  assert.match(
    playbook,
    /port: '\{\{ \(6081 - 2\) \+ \(aadm_create\.json\.display \| int\) \}\}'/
  );
  assert.match(
    playbook,
    /port: '\{\{ \(9222 - 2\) \+ \(aadm_create\.json\.display \| int\) \}\}'/
  );
  assert.match(
    playbook,
    /port: '\{\{ \(8765 - 2\) \+ \(aadm_create\.json\.display \| int\) \}\}'/
  );
});

test('smoke playbook uses accessUrl from the manager response', () => {
  const playbook = fs.readFileSync(playbookPath, 'utf8');

  assert.match(playbook, /aadm_access_url\.json\.accessUrl/);
  assert.match(playbook, /follow_redirects:\s+none/);
  assert.match(playbook, /status_code:\s+302/);
});

test('smoke playbook rewrites novnc nginx cert paths to letsencrypt', () => {
  const playbook = fs.readFileSync(playbookPath, 'utf8');

  assert.match(playbook, /ssl_certificate\s+\{\{ aadm_tls_cert_path \}\};/);
  assert.match(playbook, /ssl_certificate_key\s+\{\{ aadm_tls_key_path \}\};/);
});

test('smoke playbook overrides the noVNC root landing page', () => {
  const playbook = fs.readFileSync(playbookPath, 'utf8');

  assert.match(
    playbook,
    /Replace noVNC root landing page with aadm smoke page[\s\S]*dest:\s+\/usr\/share\/novnc\/index\.html/
  );
  assert.match(
    playbook,
    /src:\s+'\{\{ playbook_dir \}\}\/\.\.\/templates\/aadm-smoke-landing\.html\.j2'/
  );
});

test('smoke playbook coerces desktop lifecycle flags to booleans', () => {
  const playbook = fs.readFileSync(playbookPath, 'utf8');

  assert.match(playbook, /when: aadm_smoke_create_desktop \| bool/);
  assert.match(playbook, /- aadm_smoke_destroy_desktop \| bool/);
});

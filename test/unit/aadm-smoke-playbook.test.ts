import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const playbookPath = path.resolve('infra/ansible/playbooks/aadm_smoke.yml');
const ansibleCfgPath = path.resolve('infra/ansible/ansible.cfg');
const requirementsPath = path.resolve('infra/ansible/requirements.yml');

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
    /port: '\{\{ \(6081 - aadm_manager_display_min\) \+ \(aadm_create\.json\.display \| int\) \}\}'/
  );
  assert.match(
    playbook,
    /port: '\{\{ \(9222 - aadm_manager_display_min\) \+ \(aadm_create\.json\.display \| int\) \}\}'/
  );
  assert.match(
    playbook,
    /port: '\{\{ \(8765 - aadm_manager_display_min\) \+ \(aadm_create\.json\.display \| int\) \}\}'/
  );
  assert.match(
    playbook,
    /port: '\{\{ \(6081 - aadm_manager_display_min\) \+ \(aadm_default_desktop\.json\.display \| int\) \}\}'/
  );
});

test('smoke playbook reserves :1 for role noVNC and starts managed desktops at :2', () => {
  const playbook = fs.readFileSync(playbookPath, 'utf8');

  assert.match(playbook, /vnc_display:\s*1/);
  assert.match(playbook, /aadm_manager_display_min:\s*2/);
  assert.match(playbook, /AADM_DISPLAY_MIN=\{\{ aadm_manager_display_min \}\}/);
});

test('smoke playbook derives a valid public base URL for the manager env', () => {
  const playbook = fs.readFileSync(playbookPath, 'utf8');

  assert.match(
    playbook,
    /Derive manager public base URL for smoke host[\s\S]*aadm_manager_public_base_url:/
  );
  assert.match(
    playbook,
    /AADM_PUBLIC_BASE_URL=\{\{ aadm_manager_public_base_url \}\}/
  );
  assert.match(playbook, /AADM_DESKTOP_ROUTE_AUTH_MODE=token/);
  assert.match(playbook, /novnc_base_url:\s+>-/);
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
    /Install novnc-desktop v0\.1\.3 from GitHub[\s\S]*include_role:[\s\S]*name:\s+markcallen\.novnc_desktop[\s\S]*vnc_display:\s+1/
  );
  assert.match(
    playbook,
    /Detect installed noVNC web root[\s\S]*loop:\s+'\{\{ aadm_novnc_web_root_candidates \}\}'/
  );
  assert.match(
    playbook,
    /Assert installed noVNC web root was detected[\s\S]*Could not locate the installed noVNC web root/
  );
  assert.match(
    playbook,
    /Replace noVNC root landing page with aadm smoke page[\s\S]*dest:\s+'\{\{ aadm_novnc_web_root \}\}\/index\.html'/
  );
  assert.match(
    playbook,
    /src:\s+'\{\{ playbook_dir \}\}\/\.\.\/templates\/aadm-smoke-landing\.html\.j2'/
  );
});

test('ansible config and requirements install novnc-desktop from GitHub instead of a local sibling checkout', () => {
  const ansibleCfg = fs.readFileSync(ansibleCfgPath, 'utf8');
  const requirements = fs.readFileSync(requirementsPath, 'utf8');

  assert.doesNotMatch(ansibleCfg, /\.\.\/\.\.\/\.\.\/novnc-desktop\/roles/);
  assert.match(
    requirements,
    /name:\s+markcallen\.novnc_desktop[\s\S]*src:\s+https:\/\/github\.com\/markcallen\/novnc-desktop[\s\S]*version:\s+v0\.1\.3/
  );
});

test('smoke playbook coerces desktop lifecycle flags to booleans', () => {
  const playbook = fs.readFileSync(playbookPath, 'utf8');

  assert.match(playbook, /when: aadm_smoke_create_desktop \| bool/);
  assert.match(playbook, /- aadm_smoke_destroy_desktop \| bool/);
});

test('smoke playbook installs tmux for the terminal workspace', () => {
  const playbook = fs.readFileSync(playbookPath, 'utf8');

  assert.match(playbook, /- tmux/);
});

test('smoke playbook clears previous smoke-test desktops before creating a new one', () => {
  const playbook = fs.readFileSync(playbookPath, 'utf8');

  assert.match(
    playbook,
    /- name: List existing desktops[\s\S]*url: http:\/\/127\.0\.0\.1:8899\/v1\/desktops[\s\S]*method: GET/
  );
  assert.match(
    playbook,
    /- name: Destroy previous smoke-test desktops[\s\S]*url: 'http:\/\/127\.0\.0\.1:8899\/v1\/desktops\/\{\{ item\.id \}\}'[\s\S]*method: DELETE/
  );
  assert.match(playbook, /selectattr\('owner', 'equalto', 'smoke-test'\)/);
  assert.match(
    playbook,
    /- name: Create smoke desktop[\s\S]*owner: smoke-test[\s\S]*label: ubuntu-24-spot/
  );
});

test('smoke playbook verifies bridge container API keys are not left as literal placeholders', () => {
  const playbook = fs.readFileSync(playbookPath, 'utf8');

  assert.match(
    playbook,
    /- name: Inspect bridge container API key environment after smoke provisioning[\s\S]*docker exec ai-agent-bridge \/usr\/bin\/env/
  );
  assert.match(
    playbook,
    /- name: Assert bridge container received expanded API key values[\s\S]*'ANTHROPIC_API_KEY=\$ANTHROPIC_API_KEY' not in aadm_bridge_container_env\.stdout/
  );
  assert.match(
    playbook,
    /'OPENAI_API_KEY=\$OPENAI_API_KEY' not in aadm_bridge_container_env\.stdout/
  );
  assert.match(
    playbook,
    /'GEMINI_API_KEY=\$GEMINI_API_KEY' not in aadm_bridge_container_env\.stdout/
  );
});

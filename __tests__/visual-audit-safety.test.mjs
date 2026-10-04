// The visual audit must never reach a real service: these tests pin the egress guard, the browser policy and the
// environment it builds.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { classify, BLOCKED_MESSAGE } from '../scripts/visual-audit/api-policy.mjs';
import { buildEnv, productionFlags } from '../scripts/visual-audit/env.mjs';
import { routeList, planVisits } from '../scripts/visual-audit/routes.mjs';
import { AUDIT_INVITE_TOKEN } from '../scripts/visual-audit/fixtures/people.mjs';

const GUARD = path.resolve('scripts/visual-audit/egress-guard.cjs');
const request = (method, url) => ({ method: () => method, url: () => url });
const origins = { appOrigin: 'http://localhost:9005', supabaseOrigin: 'http://127.0.0.1:54321' };

test('the browser policy aborts other hosts, blocks app writes and lets reads through', () => {
  assert.deepEqual(classify(request('GET', 'https://api.openai.com/v1/models'), origins), { action: 'abort', record: 'external' });
  assert.deepEqual(classify(request('GET', 'http://127.0.0.1:9005/'), origins), { action: 'abort', record: 'external' });
  assert.deepEqual(classify(request('POST', 'http://localhost:9005/api/providers/send'), origins), { action: 'block', record: 'app-write' });
  assert.deepEqual(classify(request('DELETE', 'http://localhost:9005/api/contacted/1'), origins), { action: 'block', record: 'app-write' });
  assert.deepEqual(classify(request('GET', 'http://localhost:9005/api/home/today'), origins), { action: 'continue' });
  assert.deepEqual(classify(request('POST', 'http://localhost:9005/api/team-locks'), origins), { action: 'continue' });
  assert.deepEqual(classify(request('PUT', 'http://localhost:9005/api/leads/search/checkpoint'), origins), { action: 'continue', record: 'app-write' });
  // Renaming or hiding a Cowork conversation only writes the stand-in database; starting a run stays blocked.
  assert.deepEqual(classify(request('PATCH', 'http://localhost:9005/api/cowork/threads/00000000-0000-4000-8000-000000009001'), origins), { action: 'continue', record: 'app-write' });
  assert.deepEqual(classify(request('DELETE', 'http://localhost:9005/api/cowork/threads/00000000-0000-4000-8000-000000009001'), origins), { action: 'continue', record: 'app-write' });
  assert.deepEqual(classify(request('POST', 'http://localhost:9005/api/cowork/runs'), origins), { action: 'block', record: 'app-write' });
  assert.deepEqual(classify(request('POST', 'http://localhost:9005/search'), origins), { action: 'continue', record: 'server-action' });
  assert.deepEqual(classify(request('PATCH', 'http://127.0.0.1:54321/rest/v1/leads?id=eq.1'), origins), { action: 'continue', record: 'supabase-write' });
  assert.deepEqual(classify(request('GET', 'http://127.0.0.1:54321/rest/v1/leads'), origins), { action: 'continue', record: null });
  assert.match(BLOCKED_MESSAGE, /auditoría/);
});

test('the egress guard refuses any non-loopback connection and lets loopback through', async () => {
  const blocked = spawnSync(process.execPath, ['--require', GUARD, '-e', `
    const net = require('node:net');
    net.connect(80, '203.0.113.10').on('error', error => console.log('net', error.code));
    fetch('http://203.0.113.10/').catch(error => console.log('fetch', error.cause?.code || error.code));
  `], { encoding: 'utf8', timeout: 10000 });
  assert.match(blocked.stdout, /net ECONNREFUSED/);
  assert.match(blocked.stdout, /fetch ECONNREFUSED/);
  assert.match(blocked.stderr, /\[audit-egress\] blocked 203\.0\.113\.10:80/);

  const server = http.createServer((_req, res) => res.end('ok'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const child = await new Promise(resolve => {
    const proc = spawn(process.execPath, ['--require', GUARD, '-e', `fetch('http://127.0.0.1:${port}/').then(r => r.text()).then(t => console.log('loopback', t))`], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    proc.stdout.on('data', chunk => { out += chunk; });
    proc.on('exit', () => resolve(out));
  });
  server.close();
  assert.match(child, /loopback ok/);
});

test('the audited environment only points at loopback and never inherits real credentials', () => {
  const saved = { ...process.env };
  process.env.OPENAI_API_KEY = 'sk-real-should-not-leak';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'real-service-role';
  process.env.RANDOM_PROVIDER_TOKEN = 'real-token';
  try {
    const env = buildEnv({ ownerId: 'owner-id', ownerEmail: 'owner@example.test' });
    assert.equal(env.OPENAI_API_KEY, 'audit-unused');
    assert.equal(env.SUPABASE_SERVICE_ROLE_KEY, 'audit-service');
    assert.equal(env.RANDOM_PROVIDER_TOKEN, undefined);
    for (const [name, value] of Object.entries(env)) {
      if (/^https?:\/\//.test(value)) assert.match(value, /^http:\/\/(127\.0\.0\.1|localhost):\d+/, `${name} apunta fuera de la máquina`);
      assert.doesNotMatch(String(value), /real/, `${name} heredó un valor real`);
    }
    for (const name of Object.keys(productionFlags())) assert.doesNotMatch(name, /(KEY|SECRET|TOKEN|PASSWORD)/);
  } finally {
    process.env = saved;
  }
});

test('every page is visited by the owner, gated pages by the member, and private pages once anonymously', () => {
  const routes = routeList({ MEMBER: 'member-id' });
  const visits = planVisits(routes, { personas: ['owner', 'member', 'anon'], datasets: ['full', 'empty'] });
  const owner = visits.filter(visit => visit.persona === 'owner' && visit.dataset === 'full').map(visit => visit.route.path);
  assert.ok(owner.includes('/') && owner.includes('/cowork') && owner.includes(`/invite/${AUDIT_INVITE_TOKEN}`));
  assert.ok(AUDIT_INVITE_TOKEN.length >= 20, 'the invitation APIs ignore tokens under 20 characters');
  assert.ok(!owner.includes('/login'));
  assert.ok(visits.filter(visit => visit.persona === 'member').every(visit => visit.dataset === 'full'));
  assert.deepEqual(visits.filter(visit => visit.persona === 'anon' && visit.route.area === 'app').map(visit => visit.route.path).sort(), ['/', '/cowork']);
  assert.ok(visits.filter(visit => visit.dataset === 'empty').every(visit => visit.persona === 'owner' && !visit.route.legacy && visit.route.area === 'app'));
  assert.equal(new Set(routes.map(route => route.path)).size, routes.length);
  const redirects = visits.filter(visit => visit.route.redirectsTo);
  assert.ok(redirects.length >= 8 && redirects.every(visit => visit.persona === 'owner' && visit.dataset === 'full'), 'each retired address is checked once, as the owner');
});

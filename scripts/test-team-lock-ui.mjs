// Team notices (Plan 5, PR-9b): the screens ask once for the people they show and say «En conversación con Ana» only on
// contacts someone else holds; without collaboration nothing appears. Isolated DOM test, not visual certification.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const bundle = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
  import {TeamLockBadge} from './src/components/collaboration/TeamLockBadge';
  import {useTeamLocks} from './src/hooks/use-team-locks';
  function Probe({ emails }) {
    const locks = useTeamLocks({ emails });
    return <ul>{emails.map(email => <li key={email} data-email={email}>{email}<TeamLockBadge lock={locks?.byEmail[email]} /></li>)}</ul>;
  }
  const root = createRoot(document.getElementById('root'));
  window.__render = emails => root.render(<Probe emails={emails} />);`,
resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"test"' } });
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/saved/leads/enriched', runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;
const requests = [];
let reply = { enabled: true, byEmail: {}, byProviderId: {}, byLinkedin: {} };
window.fetch = async (url, init) => { requests.push({ url: String(url), body: JSON.parse(init.body) }); return { ok: true, json: async () => reply }; };
window.eval(bundle.outputFiles[0].text);
const settle = async (ms = 150) => { for (let i = 0; i < ms / 10; i++) await new Promise(resolve => setTimeout(resolve, 10)); };
const row = email => window.document.querySelector(`li[data-email="${email}"]`);
try {
  reply.byEmail = {
    'marcela@sodexo.cl': { status: 'active', ownerName: 'Ana Pérez', mine: false, replied: true, lastContactedAt: '2026-09-20T00:00:00Z' },
    'mine@lead.cl': { status: 'active', ownerName: 'Beto Soto', mine: true, replied: false, lastContactedAt: '2026-09-20T00:00:00Z' },
    'susana@andes.cl': { status: 'saved', ownerName: 'Ana Pérez', mine: false, replied: false, lastContactedAt: null },
  };
  window.__render(['rafael@otra.cl', 'marcela@sodexo.cl', 'mine@lead.cl', 'susana@andes.cl']);
  await settle();
  assert.equal(requests.length, 1, 'one read for the people on screen');
  assert.equal(requests[0].url, '/api/team-locks');
  assert.deepEqual(requests[0].body.emails, ['marcela@sodexo.cl', 'mine@lead.cl', 'rafael@otra.cl', 'susana@andes.cl']);
  assert.match(row('marcela@sodexo.cl').textContent, /En conversación con Ana Pérez/);
  assert.ok(row('marcela@sodexo.cl').querySelector('svg[aria-hidden="true"]'), 'the icon is decorative');
  assert.equal(row('mine@lead.cl').textContent, 'mine@lead.cl', 'your own contact says nothing');
  assert.equal(row('rafael@otra.cl').textContent, 'rafael@otra.cl', 'a free contact says nothing');
  // Plan 6, PR-E: saved first by someone else is a notice in the quiet tone, not the warning of a lock.
  const saved = row('susana@andes.cl').querySelector('span');
  assert.match(saved.textContent, /^Guardado por Ana Pérez$/);
  assert.ok(saved.className.includes('text-muted-foreground') && !saved.className.includes('amber'), saved.className);
  assert.ok(row('marcela@sodexo.cl').querySelector('span').className.includes('text-amber-700'), 'a lock keeps its warning tone');

  // The same people in another order do not read again; without collaboration nothing appears.
  window.__render(['mine@lead.cl', 'susana@andes.cl', 'rafael@otra.cl', 'marcela@sodexo.cl']);
  await settle();
  assert.equal(requests.length, 1);
  reply = { enabled: false, byEmail: {}, byProviderId: {}, byLinkedin: {} };
  window.__render(['marcela@sodexo.cl']);
  await settle();
  assert.equal(requests.length, 2);
  assert.equal(row('marcela@sodexo.cl').textContent, 'marcela@sodexo.cl');
  console.log('PASS: team notices read once per set of people, show only someone else\'s contacts («Guardado por» in the quiet tone) and nothing without collaboration.');
} finally { window.close(); }

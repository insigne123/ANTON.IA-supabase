import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const bundle = await build({
  stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {CoworkWorkspace} from './src/components/cowork/CoworkWorkspace'; createRoot(document.getElementById('root')).render(<CoworkWorkspace/>);`, resolveDir: process.cwd(), loader: 'tsx' },
  bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"test"' },
});
const id = '00000000-0000-4000-8000-000000000001';
const dom = new JSDOM('<div id="root"></div>', { url: `http://localhost/cowork?work=${id}`, runScripts: 'outside-only', pretendToBeVisual: true });
let approved = false;
let failed = false;
let writes = 0;
const { window } = dom;
window.fetch = async (url, options = {}) => {
  if (options.method === 'POST') {
    assert.ok(url.endsWith('/search-approval'));
    assert.deepEqual(JSON.parse(options.body), { approve: true });
    writes++; approved = true;
    return { ok: true, status: 200, json: async () => ({ resolved: true }) };
  }
  const run = { id, message: 'Busca gerentes en Chile', mode: 'approval', status: failed ? 'failed' : 'waiting_approval', created_at: '2026-09-15T00:00:00Z' };
  const event = (kind, payload) => ({ kind, payload, sequence: kind === 'approval.requested' ? 1 : kind === 'search.approved' ? 2 : 3, created_at: run.created_at });
  const events = [event('approval.requested', { action: 'prospecting.search', criteria: { titles: ['Gerente'], industries: [], locations: ['Chile'], limit: 5 } })];
  if (approved) events.push(event('search.approved', {}));
  if (failed) events.push(event('run.failed', { message: 'Resultado incierto. No se repetirá automáticamente.', reason: 'search_outcome_unknown' }));
  return { ok: true, status: 200, json: async () => url.endsWith('/runs') ? { runs: [run], canSubmit: true } : { run, events } };
};
window.eval(bundle.outputFiles[0].text);
const waitFor = async predicate => {
  for (let i = 0; i < 400; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
  throw new Error('Workspace update timed out');
};
const button = text => [...window.document.querySelectorAll('button')].find(node => node.textContent.trim() === text);
try {
  await waitFor(() => button('Buscar contactos'));
  assert.match(window.document.body.textContent, /Hasta 5 contactos/);
  button('Buscar contactos').click();
  await waitFor(() => window.document.body.textContent.includes('espera su turno'));
  assert.equal(button('Buscar contactos'), undefined);
  assert.equal(writes, 1);
  failed = true;
  await waitFor(() => window.document.body.textContent.includes('Resultado incierto'));
  assert.equal(writes, 1);
  assert.equal(button('Buscar contactos'), undefined);
  console.log('PASS: restored pending search, exact approval request, durable queued state, hidden repeat action and uncertain outcome without auto-retry.');
} finally { window.close(); }

// Isolated DOM test of the conversational flow: continuations, queued messages,
// writing instead of approving, and waking the worker. No environment or providers.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const bundle = await build({
  stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {CoworkWorkspace} from './src/components/cowork/CoworkWorkspace'; createRoot(document.getElementById('root')).render(<CoworkWorkspace/>);`, resolveDir: process.cwd(), loader: 'tsx' },
  bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"test"' },
});
const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const C = '00000000-0000-4000-8000-00000000000c';
const D = '00000000-0000-4000-8000-00000000000d';
const at = '2026-09-24T12:00:00Z';
const dom = new JSDOM('<div id="root"></div>', { url: `http://localhost/cowork?work=${A}`, runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;

const world = {
  runs: {
    [A]: { id: A, message: 'Guarda a Paula Herrera', mode: 'approval', status: 'completed', created_at: at, parent_run_id: null, automatic: false },
    [B]: { id: B, message: 'Continúa a partir del efecto recién ejecutado…', mode: 'approval', status: 'running', created_at: at, parent_run_id: A, automatic: true },
  },
  events: {
    [A]: [
      { sequence: 1, kind: 'approval.requested', payload: { action: 'cowork.effect', kind: 'save_contact', targetId: 'apollo:x', label: 'Guardar contacto Paula Herrera (LogiSur)' }, created_at: at },
      { sequence: 2, kind: 'effect.approved', payload: {}, created_at: at },
      { sequence: 3, kind: 'effect.started', payload: {}, created_at: at },
      { sequence: 4, kind: 'effect.completed', payload: { kind: 'save_contact' }, created_at: at },
      { sequence: 5, kind: 'run.completed', payload: { reply: 'Paula Herrera quedó guardado en tus contactos.', document: null, action: 'cowork.effect', applied: true }, created_at: at },
    ],
    [B]: [{ sequence: 1, kind: 'run.started', payload: {}, created_at: at }],
  },
};
const posts = [];
let wakes = 0;
const json = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
window.fetch = async (url, options = {}) => {
  if (url === '/api/cowork/wake') { wakes++; return json({ woken: true }, 202); }
  if (url === '/api/cowork/runs' && options.method === 'POST') {
    const body = JSON.parse(options.body);
    posts.push(body);
    const id = posts.length === 1 ? C : D;
    world.runs[id] = { id, message: body.message, mode: 'approval', status: 'queued', created_at: at, parent_run_id: body.parentRunId, automatic: false };
    world.events[id] = [];
    return json({ id }, 202);
  }
  if (url === '/api/cowork/runs') return json({ runs: Object.values(world.runs), canSubmit: true });
  const approval = /\/runs\/([^/]+)\/effect-approval$/.exec(url);
  if (approval) {
    posts.push({ approval: approval[1], ...JSON.parse(options.body) });
    world.runs[approval[1]].status = 'completed';
    world.events[approval[1]].push({ sequence: 9, kind: 'run.completed', payload: { reply: 'Propuesta descartada. No se ejecutó ningún cambio.', document: null, applied: false }, created_at: at });
    return json({ resolved: true });
  }
  const match = /\/runs\/([^/?]+)$/.exec(url);
  if (match && world.runs[match[1]]) {
    const id = match[1];
    const chain = [];
    let cursor = world.runs[id].parent_run_id;
    while (cursor) { chain.unshift({ run: world.runs[cursor], events: world.events[cursor] }); cursor = world.runs[cursor].parent_run_id; }
    const child = Object.values(world.runs).find(run => run.parent_run_id === id && run.automatic);
    return json({ run: world.runs[id], events: world.events[id], ancestors: chain, budget: { depth: 1, maxDepth: 5, exhausted: false },
      continuation: child && !['queued', 'running', 'waiting_approval', 'waiting_workers'].includes(world.runs[id].status) ? { id: child.id, status: child.status } : null });
  }
  return json({ error: 'No encontrado' }, 404);
};
window.eval(bundle.outputFiles[0].text);
const waitFor = async (predicate, label) => {
  for (let i = 0; i < 400; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
  throw new Error(`Timed out: ${label}`);
};
const text = () => window.document.body.textContent;
const type = value => {
  const box = window.document.getElementById('cowork-followup');
  Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(box, value);
  box.dispatchEvent(new window.Event('input', { bubbles: true }));
};
const send = () => window.document.querySelector('[aria-label="Enviar mensaje"]').click();
try {
  // 1. A finished turn with a continuation is followed automatically.
  await waitFor(() => new URL(window.location.href).searchParams.get('work') === B, 'follow continuation');
  await waitFor(() => text().includes('Continuó automáticamente con el resultado'), 'automatic turn note');
  assert.equal(text().includes('Continúa a partir del efecto'), false, 'synthetic prompt never shows as a user message');
  assert.match(text(), /Paula Herrera quedó guardado/);
  assert.match(text(), /Aprobaste: Guardar contacto/);
  assert.ok(window.document.querySelector('[aria-label="Detener trabajo"]'), 'stop button while working');

  // 2. Writing while it works queues the message instead of forking the thread.
  type('Ahora enriquécela');
  await waitFor(() => window.document.querySelector('[aria-label="Enviar mensaje"]') && !window.document.querySelector('[aria-label="Enviar mensaje"]').disabled, 'send enabled');
  send();
  await waitFor(() => text().includes('Se enviará cuando termine este paso'), 'queued chip');
  assert.equal(posts.length, 0);

  // 3. When the step finishes, the queued message goes out as a follow-up of that turn.
  world.runs[B].status = 'completed';
  world.events[B].push({ sequence: 2, kind: 'run.completed', payload: { reply: 'Listo. ¿La enriquezco?', document: null }, created_at: at });
  await waitFor(() => posts.length === 1, 'queued message sent');
  assert.deepEqual({ message: posts[0].message, parentRunId: posts[0].parentRunId }, { message: 'Ahora enriquécela', parentRunId: B });
  await waitFor(() => new URL(window.location.href).searchParams.get('work') === C, 'follow the new turn');
  await waitFor(() => wakes > 0, 'worker woken');

  // 4. Writing instead of approving discards the proposal, then sends the new instruction.
  world.runs[C].status = 'waiting_approval';
  world.events[C].push({ sequence: 1, kind: 'approval.requested', payload: { action: 'cowork.effect', kind: 'enrich_contact', targetId: A, label: 'Enriquecer contacto Paula Herrera (LogiSur)' }, created_at: at });
  await waitFor(() => text().includes('Necesita tu aprobación'), 'approval card');
  type('Mejor investígala primero');
  await waitFor(() => !window.document.querySelector('[aria-label="Enviar mensaje"]').disabled, 'send enabled for change');
  send();
  await waitFor(() => posts.length === 3, 'discard then follow-up');
  assert.deepEqual(posts[1], { approval: C, approve: false });
  assert.deepEqual({ message: posts[2].message, parentRunId: posts[2].parentRunId }, { message: 'Mejor investígala primero', parentRunId: C });
  console.log('PASS: follows continuations, hides synthetic prompts, queues messages while working, writing replaces a pending proposal, wakes the worker.');
} finally { window.close(); }

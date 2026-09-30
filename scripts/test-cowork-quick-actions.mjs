// The quick actions above the composer (roadmap, point 1): four short actions while a conversation is open. They show only
// when a message can go out now (the turn is over, nothing waits for a decision), go away while something is being written
// or attached, and one tap sends them in the same thread. Isolated DOM test on the real workspace, with a fake stream.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const bundle = await build({
  stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {CoworkWorkspace} from './src/components/cowork/CoworkWorkspace'; createRoot(document.getElementById('root')).render(<CoworkWorkspace/>);`, resolveDir: process.cwd(), loader: 'tsx' },
  bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"test"' },
});

const RUN = '00000000-0000-4000-8000-0000000000a1';
const created = '2026-09-30T10:00:00Z';
const agent = (sequence, result) => ({ sequence, kind: 'tool.completed', payload: { action: 'assistant.agent', input: '', result }, created_at: created });

/** One page with a fake stream: `world` is what the API says about the run, `source` the open stream. */
async function mount(world, { stream = true } = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: `http://localhost/cowork?work=${RUN}`, runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  const sources = [];
  class FakeEventSource {
    constructor(url) { this.url = url; this.readyState = 1; this.listeners = {}; sources.push(this); queueMicrotask(() => this.onopen?.()); }
    addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
    close() { this.readyState = 2; }
    emit(type, data) { for (const listener of this.listeners[type] || []) listener({ data: JSON.stringify(data) }); }
  }
  FakeEventSource.CLOSED = 2;
  window.EventSource = FakeEventSource;
  const posts = [];
  window.fetch = async (url, init) => {
    if (init?.method === 'POST' && url.endsWith('/api/cowork/runs')) { posts.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ id: '00000000-0000-4000-8000-0000000000b2' }) }; }
    if (url.endsWith('/runs')) return { ok: true, status: 200, json: async () => ({ runs: [world.run], canSubmit: true }) };
    if (url.endsWith(RUN)) return { ok: true, status: 200, json: async () => ({ run: world.run, events: world.events }) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
  window.eval(bundle.outputFiles[0].text);
  const waitFor = async (predicate, label) => {
    for (let i = 0; i < 300; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
    throw new Error(`Timed out waiting for ${label}`);
  };
  if (stream) await waitFor(() => sources.length > 0, 'the stream to open');
  const text = () => window.document.body.textContent;
  return { window, waitFor, text, posts, source: () => sources.at(-1), close: () => window.close() };
}

const finished = () => ({
  run: { id: RUN, message: 'Prepara una secuencia para RR. HH.', mode: 'approval', status: 'completed', created_at: created, updated_at: created },
  events: [{ sequence: 1, kind: 'run.started', payload: {}, created_at: created },
    { sequence: 90, kind: 'run.completed', payload: { reply: 'Listo, te dejé la secuencia.', document: null, question: null, model: 'test', durationMs: 1 }, created_at: created }],
});
const nav = page => page.window.document.querySelector('nav[aria-label="Acciones rápidas"]');

try {
  // Running: a message cannot go out yet, so the row is not there.
  const live = finished();
  live.run.status = 'running'; live.events.pop();
  const busy = await mount(live);
  await busy.waitFor(() => busy.text().includes('Prepara una secuencia para RR. HH.'), 'the turn');
  assert.equal(nav(busy), null, 'nothing to tap while the step runs');
  live.run = { ...live.run, status: 'completed' };
  live.events = finished().events;
  busy.source().emit('end', { status: 'completed', sequence: 90 });
  await busy.waitFor(() => nav(busy), 'the row once the turn is over');
  busy.close();

  // Finished: the four actions, in order, each a real button.
  const page = await mount(finished(), { stream: false });
  await page.waitFor(() => nav(page), 'the quick actions');
  const labels = [...nav(page).querySelectorAll('button')].map(button => button.textContent.trim());
  assert.deepEqual(labels, ['¿Qué toca hoy?', 'Escribir a mis contactos', 'Buscar prospectos', '¿Cómo voy?']);

  // Writing hides them: they never compete with what is being typed.
  const box = page.window.document.getElementById('cowork-followup');
  const setter = Object.getOwnPropertyDescriptor(page.window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(box, 'Una pregunta mía');
  box.dispatchEvent(new page.window.Event('input', { bubbles: true }));
  await page.waitFor(() => !nav(page), 'the row to hide while writing');
  setter.call(box, '');
  box.dispatchEvent(new page.window.Event('input', { bubbles: true }));
  await page.waitFor(() => nav(page), 'the row to come back when the box is empty');

  // One tap sends the prompt as a follow-up of this run.
  [...nav(page).querySelectorAll('button')].find(button => button.textContent.includes('¿Qué toca hoy?')).click();
  await page.waitFor(() => page.posts.length === 1, 'the message to be sent');
  assert.equal(page.posts[0].message, '¿Qué toca hoy?');
  assert.equal(page.posts[0].parentRunId, RUN, 'same thread');
  page.close();
  console.log('PASS: four quick actions above the composer; only when a message can go out and the box is empty; one tap sends it in the same thread.');
} finally {
  // jsdom windows keep timers alive: the process ends here.
  setTimeout(() => process.exit(process.exitCode || 0), 50).unref?.();
}

// A held answer (COWORK_ANSWER_HOLD_ENABLED): the page never shows a text that its review then replaces.
// Isolated DOM test on the real workspace, with a fake stream: no app environment, credentials or providers.
// Held, the stream only carries the phase (writing, reviewing, adjusting) and the cards; the answer shows once,
// when it is final. Not held, the text streams as before, and «Ajusté la respuesta» only says so when the
// judge really kept a correction.
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
async function mount(world) {
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
  window.fetch = async url => {
    if (url.endsWith('/runs')) return { ok: true, status: 200, json: async () => ({ runs: [world.run], canSubmit: true }) };
    if (url.endsWith(RUN)) return { ok: true, status: 200, json: async () => ({ run: world.run, events: world.events }) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
  window.eval(bundle.outputFiles[0].text);
  const waitFor = async (predicate, label) => {
    for (let i = 0; i < 300; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
    throw new Error(`Timed out waiting for ${label}`);
  };
  await waitFor(() => sources.length > 0, 'the stream to open');
  const text = () => window.document.body.textContent;
  return { window, waitFor, text, source: () => sources.at(-1), close: () => window.close() };
}

const running = () => ({
  run: { id: RUN, message: 'Prepara una secuencia para RR. HH.', mode: 'approval', status: 'running', created_at: created, updated_at: created },
  events: [{ sequence: 1, kind: 'run.started', payload: {}, created_at: created }],
});
const complete = (world, reply, extra = []) => {
  world.run = { ...world.run, status: 'completed' };
  world.events = [...world.events, ...extra, { sequence: 90, kind: 'run.completed', payload: { reply, document: null, question: null, model: 'test', durationMs: 1 }, created_at: created }];
};
const times = (text, part) => text.split(part).length - 1;

try {
  // Held: the phases show, never a text, and the final answer shows once without saying it was adjusted.
  const held = running();
  const page = await mount(held);
  const frame = (phase, cards = []) => ({ from: 0, text: '', cards, reviewing: false, phase });
  page.source().emit('draft', frame('writing'));
  await page.waitFor(() => page.text().includes('Escribiendo la respuesta…'), 'the writing line');
  assert.equal(page.window.document.querySelector('.cw-live-answer'), null, 'no live text while held');
  const view = page.window.document.querySelector('[aria-busy="true"]');
  assert.ok(view, 'the held answer is a busy region, not a live region');
  assert.equal(view.getAttribute('aria-live'), null);
  assert.equal(view.querySelector('.cw-prose'), null, 'nothing to read yet');

  page.source().emit('draft', frame('reviewing', [{ type: 'sequence', title: null, parts: 2 }]));
  await page.waitFor(() => page.text().includes('Revisando los correos antes de mostrártelos…'), 'the reviewing line');
  assert.match(page.text(), /Secuencia · 2 correos/);
  assert.equal(page.text().includes('Escribiendo la respuesta'), false, 'the line is replaced, not stacked');
  page.source().emit('draft', frame('adjusting', [{ type: 'sequence', title: null, parts: 3 }]));
  await page.waitFor(() => page.text().includes('Ajustando los correos tras revisarlos…'), 'the adjusting line');
  assert.match(page.text(), /Secuencia · 3 correos/);
  assert.equal(page.window.document.querySelector('.cw-live-answer'), null);

  // The review fixed it: the answer shows once, final, and it does not say it changed under the reader.
  complete(held, 'Te dejo la secuencia para RR. HH., ya corregida.', [
    agent(2, { agent: 'judge', state: 'working', label: 'Revisando la respuesta', outcome: null, changes: [] }),
    agent(3, { agent: 'judge', state: 'done', label: 'Ajustó la respuesta', outcome: 'fixed', changes: [] })]);
  page.source().emit('end', { status: 'completed', sequence: 90 });
  await page.waitFor(() => page.text().includes('Te dejo la secuencia para RR. HH., ya corregida.'), 'the final answer');
  assert.equal(times(page.text(), 'Te dejo la secuencia para RR. HH.'), 1, 'one answer, once');
  assert.equal(page.window.document.querySelector('[aria-busy="true"]'), null, 'the held view is gone');
  for (const gone of ['Ajustando los correos', 'Revisando los correos', 'Ajusté la respuesta al revisarla']) assert.equal(page.text().includes(gone), false, gone);
  page.close();

  // Streamed (not held): the text shows as it is written, and «Ajusté…» only says so when the judge kept a correction.
  for (const [outcome, label, adjusted] of [['fixed', 'Ajustó la respuesta', true], ['clean', 'Sin ajustes', false]]) {
    const live = running();
    const streamed = await mount(live);
    streamed.source().emit('draft', { from: 0, text: 'Tus 3 contactos de RR. HH.', cards: [], reviewing: false });
    await streamed.waitFor(() => streamed.window.document.querySelector('.cw-live-answer')?.textContent.includes('Tus 3 contactos de RR. HH.'), 'the live text');
    streamed.source().emit('draft', { from: 26, text: '', cards: [], reviewing: true });
    await streamed.waitFor(() => streamed.text().includes('Revisando la respuesta…'), 'the reviewing mark');
    complete(live, 'Tus 3 contactos de RR. HH. tienen correo; ninguno ha recibido nada.', [
      agent(2, { agent: 'judge', state: 'done', label, outcome, changes: [] })]);
    streamed.source().emit('end', { status: 'completed', sequence: 90 });
    await streamed.waitFor(() => streamed.text().includes('ninguno ha recibido nada'), 'the final answer');
    assert.equal(streamed.text().includes('Ajusté la respuesta al revisarla'), adjusted, `judge ${outcome}: the notice says so only for a kept correction`);
    streamed.close();
  }
  console.log('PASS: held, the page shows the phase and never a text that a review replaces, once; streamed, it says it adjusted only after a correction that was kept.');
} finally {
  // jsdom windows keep timers alive: the process ends here.
  setTimeout(() => process.exit(process.exitCode || 0), 50).unref?.();
}

// «Cerrar conversación» (Plan 5, PR-9a): the dialog offers the four outcomes with what each one does (alone or in a
// team), sends the chosen one, shows a refusal in plain words and reports the result. Isolated DOM test, not visual.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const bundle = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
  import {CloseConversationDialog, conversationClosedNotice} from './src/components/contacted/CloseConversationDialog';
  const root = createRoot(document.getElementById('root'));
  window.__render = props => root.render(<CloseConversationDialog open contactedId="contacted-1" name="Marcela Rojas" observedAt="2026-10-01T12:00:00.000Z"
    onOpenChange={value => { window.__openChange = value; }} onClosed={result => { window.__closed = result; }} {...props} />);
  window.__notice = conversationClosedNotice;`,
resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"test"' } });
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/contacted', runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;
window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
window.ResizeObserver = window.ResizeObserver || class { observe() {} unobserve() {} disconnect() {} };
const requests = [];
let reply = { status: 200, body: {} };
window.fetch = async (url, init) => { requests.push({ url: String(url), init }); return { ok: reply.status < 400, status: reply.status, json: async () => reply.body }; };
window.eval(bundle.outputFiles[0].text);
const settle = async (ms = 150) => { for (let i = 0; i < ms / 10; i++) await new Promise(resolve => setTimeout(resolve, 10)); };
const text = () => window.document.body.textContent;
const radios = () => [...window.document.querySelectorAll('[role="radio"]')];
const submit = () => [...window.document.querySelectorAll('button')].find(node => /^(Cerrar conversación|Cerrando…)$/.test(node.textContent.trim()));
try {
  window.__render({ team: null });
  await settle();
  assert.ok(window.document.querySelector('[role="dialog"]'), 'opens as a dialog');
  assert.match(text(), /Cerrar la conversación con Marcela Rojas/);
  assert.match(text(), /La conversación sale de «Por responder» y el historial se conserva\./);
  assert.equal(radios().length, 4);
  for (const label of ['Sin acuerdo', 'Ganado', 'No interesado', 'Lo retomo yo']) assert.match(text(), new RegExp(label));
  assert.match(text(), /Pasa a Perdido en el pipeline\./, 'alone, it says what changes for this person');
  assert.doesNotMatch(text(), /equipo/, 'alone, nothing about a team');
  assert.equal(submit().disabled, true, 'nothing is sent before choosing');

  // A refusal comes back in plain words and nothing is reported as closed.
  radios()[0].click();
  await settle();
  assert.equal(radios()[0].getAttribute('aria-checked'), 'true');
  assert.equal(submit().disabled, false);
  reply = { status: 409, body: { error: 'Hay un envío en curso a esta persona. Espera a que termine y vuelve a intentarlo.' } };
  submit().click();
  await settle();
  assert.equal(window.document.querySelector('[role="alert"]')?.textContent, 'Hay un envío en curso a esta persona. Espera a que termine y vuelve a intentarlo.');
  assert.equal(window.__closed, undefined);

  // The chosen outcome is sent with the moment the conversation was read.
  reply = { status: 200, body: { outcome: 'no_deal', team: { status: null, changed: false }, stage: 'closed_lost', stageSaved: true } };
  submit().click();
  await settle();
  const last = requests.at(-1);
  assert.equal(last.url, '/api/contacted/contacted-1/conversation/close');
  assert.equal(last.init.method, 'POST');
  assert.deepEqual(JSON.parse(last.init.body), { outcome: 'no_deal', observedAt: '2026-10-01T12:00:00.000Z' });
  assert.equal(window.__closed.outcome, 'no_deal');

  // In a team with an active thread, each line says what changes for the team.
  window.__render({ team: { enabled: true, status: 'active', mine: true } });
  await settle();
  assert.match(text(), /queda libre: cualquiera del equipo puede volver a contactarlo/);
  assert.match(text(), /Sigue siendo tuyo: nadie más del equipo puede contactarlo/);
  assert.doesNotMatch(text(), /lo lleva otra persona/);
  window.__render({ team: { enabled: true, status: 'active', mine: false } });
  await settle();
  assert.match(text(), /Este contacto lo lleva otra persona del equipo: solo ella o un administrador pueden cerrarlo\./);

  // What the page says afterwards.
  assert.equal(window.__notice('Marcela', { outcome: 'no_deal', team: { status: 'available', changed: true }, stage: 'closed_lost', stageSaved: true }),
    'Conversación con Marcela cerrada: Sin acuerdo. Queda libre para el equipo.');
  assert.equal(window.__notice('Marcela', { outcome: 'won', team: { status: null, changed: false }, stage: null, stageSaved: false }),
    'Conversación con Marcela cerrada: Ganado. No pudimos cambiar la etapa en el pipeline: cámbiala desde ahí.');
  console.log('PASS: «Cerrar conversación» offers four outcomes with their effect, alone or in a team, sends the choice and explains refusals.');
} finally { window.close(); }

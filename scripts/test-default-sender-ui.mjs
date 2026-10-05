// Conexiones, «Remitente predeterminado» (Plan 5, PR-6b): the connected mailboxes, the one that sends, choosing it
// once, and what is said when one or two are connected. Isolated DOM test with a fake server, not visual certification.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const bundle = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
  import {DefaultSenderCard} from './src/components/settings/DefaultSenderCard';
  createRoot(document.getElementById('root')).render(<DefaultSenderCard />);`,
resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"test"' } });

async function render(state, onPut) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/connections', runScripts: 'outside-only', pretendToBeVisual: true });
  const requests = [];
  dom.window.fetch = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    requests.push({ url, method: init.method || 'GET', body });
    if (init.method === 'PUT') return onPut(body);
    return { ok: true, status: 200, json: async () => state };
  };
  dom.window.eval(bundle.outputFiles[0].text);
  for (let i = 0; i < 30; i++) await new Promise(resolve => setTimeout(resolve, 10));
  return { dom, requests };
}
const radio = (dom, provider) => dom.window.document.getElementById(`default-sender-${provider}`);

// Two connected and none chosen: it asks once, here, and saves the choice.
let view = await render({ connected: { google: true, outlook: true }, preferred: null, resolved: null },
  body => ({ ok: true, status: 200, json: async () => ({ connected: { google: true, outlook: true }, preferred: body.provider, resolved: body.provider }) }));
try {
  const text = () => view.dom.window.document.body.textContent;
  assert.match(text(), /Remitente predeterminado/);
  assert.match(text(), /Cowork y tus campañas envían desde esta cuenta, sin preguntarte cada vez\./);
  assert.match(text(), /Tienes dos cuentas conectadas: elige cuál envía/);
  assert.equal(radio(view.dom, 'google').disabled, false);
  assert.equal(radio(view.dom, 'outlook').getAttribute('aria-checked'), 'false');
  radio(view.dom, 'outlook').click();
  for (let i = 0; i < 20; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(view.requests.filter(request => request.method === 'PUT').map(request => request.body), [{ provider: 'outlook' }]);
  assert.equal(radio(view.dom, 'outlook').getAttribute('aria-checked'), 'true');
  assert.match(text(), /Listo: Cowork y tus campañas enviarán desde Outlook\./);
} finally { view.dom.window.close(); }

// Only Gmail connected: it sends without a choice, and Outlook cannot be chosen until it is connected.
view = await render({ connected: { google: true, outlook: false }, preferred: null, resolved: 'google' },
  () => ({ ok: false, status: 409, json: async () => ({ error: 'Conecta Outlook antes de elegirla para enviar.' }) }));
try {
  const text = view.dom.window.document.body.textContent;
  assert.match(text, /Se usa Gmail, tu única cuenta conectada\./);
  assert.equal(radio(view.dom, 'outlook').disabled, true);
  assert.match(text, /No conectada: conéctala en «Correo» para elegirla/, 'the card points to the «Correo» section, where the account is connected');
  assert.equal(radio(view.dom, 'google').getAttribute('aria-checked'), 'true');
} finally { view.dom.window.close(); }

// A refused save says why.
view = await render({ connected: { google: true, outlook: true }, preferred: 'google', resolved: 'google' },
  () => ({ ok: false, status: 503, json: async () => ({ error: 'No se pudo guardar tu remitente. Inténtalo de nuevo.' }) }));
try {
  radio(view.dom, 'outlook').click();
  for (let i = 0; i < 20; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(view.dom.window.document.querySelector('[role="alert"]').textContent, 'No se pudo guardar tu remitente. Inténtalo de nuevo.');
  assert.equal(radio(view.dom, 'google').getAttribute('aria-checked'), 'true', 'the choice on screen stays the saved one');
} finally { view.dom.window.close(); }

console.log('PASS: default sender card with the connected mailboxes, one choice saved, the only mailbox used without asking, and refusals said.');

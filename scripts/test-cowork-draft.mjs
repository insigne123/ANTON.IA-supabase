// Isolated DOM test: an unsent message survives the remount the app does once
// the session resolves (AuthContext keys its tree by user and workspace).
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const OWNER = '00000000-0000-4000-8000-0000000000aa';
const bundle = await build({
  stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {CoworkWorkspace} from './src/components/cowork/CoworkWorkspace';
    const root = createRoot(document.getElementById('root'));
    window.mountWorkspace = (key, userId = "${OWNER}") => root.render(<React.StrictMode><CoworkWorkspace key={key} userId={userId}/></React.StrictMode>);
    window.mountWorkspace('anonymous:personal');`, resolveDir: process.cwd(), loader: 'tsx' },
  bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"test"' },
});
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/cowork', runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;
const posts = [];
let failSend = false;
window.fetch = async (url, options = {}) => {
  const json = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
  if (url === '/api/cowork/runs' && options.method === 'POST') { posts.push(JSON.parse(options.body)); return failSend ? json({ error: 'No se pudo guardar' }, 503) : json({ id: '00000000-0000-4000-8000-0000000000bb' }, 202); }
  if (url === '/api/cowork/runs') return json({ runs: [], canSubmit: true });
  return json({ error: 'No encontrado' }, 404);
};
window.eval(bundle.outputFiles[0].text);
const waitFor = async (predicate, label) => {
  for (let i = 0; i < 400; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
  throw new Error(`Timed out: ${label}`);
};
const box = () => window.document.getElementById('cowork-message');
const type = value => {
  Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(box(), value);
  box().dispatchEvent(new window.Event('input', { bubbles: true }));
};
const saved = () => JSON.parse(window.sessionStorage.getItem('cowork:draft') || 'null');
const remount = async key => {
  const previous = box();
  window.mountWorkspace(key);
  await waitFor(() => box() && box() !== previous && !box().disabled, 'new composer mounted');
};
try {
  await waitFor(() => box() && !box().disabled, 'composer');
  // 1. Typed before the session resolved, restored after the remount.
  type('que tengo pendiente para hoy?');
  await waitFor(() => saved()?.text === 'que tengo pendiente para hoy?', 'draft saved');
  await remount(`${OWNER}:org`);
  await waitFor(() => box()?.value === 'que tengo pendiente para hoy?', 'draft restored after remount');

  // 2. Mounting never clears a saved draft, and sending does.
  await waitFor(() => !window.document.querySelector('[aria-label="Crear trabajo"]').disabled, 'send enabled');
  window.document.querySelector('[aria-label="Crear trabajo"]').click();
  await waitFor(() => posts.length === 1, 'message sent');
  assert.equal(posts[0].message, 'que tengo pendiente para hoy?');
  await waitFor(() => saved() === null, 'draft cleared after sending');

  // 3. A draft saved by another account in this tab is never shown.
  window.sessionStorage.setItem('cowork:draft', JSON.stringify({ userId: 'otra-cuenta', text: 'borrador ajeno' }));
  window.history.pushState(null, '', '/cowork');
  await remount('otra:vez');
  const composer = () => window.document.querySelector('#cowork-message, #cowork-followup');
  await waitFor(() => composer(), 'composer after remount');
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(composer().value, '');

  // 4. A failed send preserves text across a StrictMode remount.
  failSend = true;
  type('conservar ante fallo');
  await waitFor(() => saved()?.text === 'conservar ante fallo', 'failed-send draft saved');
  window.document.querySelector('[aria-label="Crear trabajo"]').click();
  await waitFor(() => posts.length === 2 && window.document.querySelector('[role="alert"]'), 'failed send visible');
  await remount('retry');
  await waitFor(() => box()?.value === 'conservar ante fallo', 'failed-send draft restored');

  // 5. Changing account without a React key change cannot copy the old text.
  window.mountWorkspace('retry', 'other-owner');
  await waitFor(() => box()?.value === '' && saved() === null, 'account switch cleared visible draft');
  console.log('PASS: drafts survive StrictMode remounts and failed sends, clear on success, and never cross accounts.');
} finally { window.close(); }

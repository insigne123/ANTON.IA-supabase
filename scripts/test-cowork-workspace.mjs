// Isolated DOM interaction test: no app environment, credentials or providers.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const bundle = await build({
  stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {CoworkWorkspace} from './src/components/cowork/CoworkWorkspace'; createRoot(document.getElementById('root')).render(<CoworkWorkspace/>);`, resolveDir: process.cwd(), loader: 'tsx' },
  bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"test"' },
});
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/cowork', runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;
const run = { id: '00000000-0000-4000-8000-000000000001', message: 'Prepara un resumen', mode: 'approval', status: 'completed', created_at: '2026-09-15T00:00:00Z' };
let denied = false;
const calls = [];
window.fetch = async url => {
  calls.push(url);
  const data = denied ? { error: 'Acceso revocado' } : url.endsWith('/runs')
    ? { runs: [run], canSubmit: false }
    : { run, events: [
      { sequence: 1, kind: 'tool.completed', payload: { action: 'leads.search', result: { scope: 'own_saved_contacts', truncated: true, items: [{ id: run.id, name: 'Ana Ejemplo', company: 'Logística Sur', email: 'ana@example.com' }] } }, created_at: run.created_at },
      { sequence: 2, kind: 'run.completed', payload: { reply: 'Resumen listo', document: { title: 'Mi documento', content: '<script>window.compromised=true</script>\nContenido' }, model: 'test', durationMs: 1 }, created_at: run.created_at },
      { sequence: 3, kind: 'tool.completed', payload: { action: 'research.get_existing', result: { availability: 'available', research: { capturedAt: run.created_at, status: 'completed', truncated: false, sources: [{ id: 'source', title: 'Fuente oficial', url: 'https://example.com/evidence', retrievedAt: run.created_at }] } } }, created_at: run.created_at }] };
  return { ok: !denied, status: denied ? 403 : 200, json: async () => data };
};
window.eval(bundle.outputFiles[0].text);
const waitFor = async predicate => {
  for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
  throw new Error('Timed out waiting for workspace');
};
const button = text => [...window.document.querySelectorAll('button')].find(node => node.textContent.trim() === text);
try {
  await waitFor(() => button('Prepara un resumenCompletado'));
  assert.equal(window.document.querySelector('[aria-label="Crear trabajo"]').disabled, true);
  button('Prepara un resumenCompletado').click();
  await waitFor(() => button('Abrir'));
  assert.equal(window.document.querySelector('a[href="https://example.com/evidence"]').rel, 'noopener noreferrer');
  assert.match(window.document.querySelector('[aria-label="Fuentes de investigación"]').textContent, /No se consultaron nuevamente/);
  assert.equal(new URL(window.location.href).searchParams.get('work'), run.id);
  const contacts = window.document.querySelector('section[aria-label="Contactos consultados"]');
  assert.match(contacts.textContent, /Ana Ejemplo/);
  assert.match(contacts.textContent, /no representa toda tu base/);
  assert.ok(contacts.querySelector('[aria-label="Descargar contactos"]'));
  const filter = contacts.querySelector('input');
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(filter, 'No coincide');
  filter.dispatchEvent(new window.Event('input', { bubbles: true }));
  await waitFor(() => contacts.textContent.includes('No hay coincidencias'));
  assert.match(contacts.textContent, /descarga incluye los 1 contactos/);
  button('Abrir').click();
  await waitFor(() => window.document.querySelector('aside[aria-label="Documento"]'));
  assert.match(window.document.querySelector('pre').textContent, /<script>/);
  assert.equal(window.compromised, undefined);
  assert.equal(window.document.activeElement.textContent, 'Mi documento');
  window.document.querySelector('[aria-label="Cerrar documento"]').click();
  await waitFor(() => window.document.activeElement === button('Abrir'));
  button('Nuevo trabajo').click();
  assert.equal(new URL(window.location.href).searchParams.has('work'), false);
  await waitFor(() => button('Prepara un resumenCompletado'));
  denied = true;
  button('Prepara un resumenCompletado').click();
  await waitFor(() => window.document.querySelector('[role="alert"]'));
  assert.equal(window.document.querySelector('pre'), null);
  assert.equal(window.document.body.textContent.includes('Resumen listo'), false);
  assert.equal(window.document.body.textContent.includes('ana@example.com'), false);
  assert.ok(calls.every(url => url.startsWith('/api/cowork/runs')));
  console.log('PASS: worker-unavailable state, persistent result, metadata-compatible document, safe text rendering, focus restoration, access revocation.');
} finally { window.close(); }

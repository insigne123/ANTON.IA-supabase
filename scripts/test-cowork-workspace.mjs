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
const sendRun = { id: '00000000-0000-4000-8000-000000000002', message: 'Enviar correo', mode: 'approval', status: 'waiting_approval', created_at: '2026-09-15T00:00:00Z' };
const campRun = { id: '00000000-0000-4000-8000-000000000003', message: 'Crear campaña', mode: 'approval', status: 'waiting_approval', created_at: '2026-09-15T00:00:00Z' };
const sendTarget = '00000000-0000-4000-8000-000000000004:00000000-0000-4000-8000-000000000005:' + 'a'.repeat(64) + ':google:' + 'b'.repeat(64);
let denied = false;
const calls = [];
window.fetch = async url => {
  calls.push(url);
  if (denied) return { ok: false, status: 403, json: async () => ({ error: 'Acceso revocado' }) };
  if (url.includes('/send-preview')) return { ok: true, status: 200, json: async () => ({
    to: 'ana@example.com', toName: 'Ana', subject: 'Propuesta', text: 'Hola Ana',
    from: 'vendedor@example.com', provider: 'google', revision: 1, versionId: '00000000-0000-4000-8000-000000000005',
    matches: false, label: 'Enviar «Propuesta»' }) };
  if (url.includes('/campaign-preview')) return { ok: true, status: 200, json: async () => ({
    kind: 'campaign_create', label: 'Crear campaña', name: 'Reactivación', objective: 'Retomar',
    provider: 'google', messages: [{ subject: 'Hola', body: 'Te escribo por…', delayDays: 0 }],
    emails: ['ana@example.com'], matched: 1 }) };
  if (url.endsWith('/runs')) return { ok: true, status: 200, json: async () => ({ runs: [run, sendRun, campRun], canSubmit: false }) };
  if (url.endsWith(sendRun.id)) return { ok: true, status: 200, json: async () => ({ run: sendRun, events: [
    { sequence: 1, kind: 'approval.requested', payload: { action: 'cowork.effect', kind: 'send_email', targetId: sendTarget, label: 'Enviar «Propuesta»' }, created_at: sendRun.created_at }] }) };
  if (url.endsWith(campRun.id)) return { ok: true, status: 200, json: async () => ({ run: campRun, events: [
    { sequence: 1, kind: 'approval.requested', payload: { action: 'cowork.effect', kind: 'campaign_create', targetId: campRun.id, label: 'Crear campaña' }, created_at: campRun.created_at }] }) };
  const data = { run, events: [
      { sequence: 1, kind: 'tool.completed', payload: { action: 'leads.search', result: { scope: 'own_saved_contacts', truncated: true, items: [{ id: run.id, name: 'Ana Ejemplo', company: 'Logística Sur', email: 'ana@example.com' }] } }, created_at: run.created_at },
      { sequence: 2, kind: 'run.completed', payload: { reply: '**Resumen** listo\n\n- Punto uno\n- Punto dos', document: { title: 'Mi documento', content: '<script>window.compromised=true</script>\nContenido' }, model: 'test', durationMs: 1 }, created_at: run.created_at },
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
  const replyBlock = [...window.document.querySelectorAll('div')].find(node =>
    node.textContent.includes('Punto uno') && node.querySelector('strong') && node.querySelector('li'));
  assert.ok(replyBlock);
  assert.equal(replyBlock.querySelector('strong').textContent, 'Resumen');
  assert.equal(replyBlock.textContent.includes('**'), false);
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
  await waitFor(() => button('Enviar correoEsperando tu aprobación'));
  button('Enviar correoEsperando tu aprobación').click();
  await waitFor(() => window.document.querySelector('section[aria-label="Revisar acción propuesta"]'));
  const sendCard = window.document.querySelector('section[aria-label="Revisar acción propuesta"]');
  assert.match(sendCard.textContent, /vendedor@example\.com/);
  assert.match(sendCard.textContent, /Hola Ana/);
  const sendApprove = [...sendCard.querySelectorAll('button')].find(node => node.textContent.trim() === 'Aprobar y enviar');
  assert.ok(sendApprove);
  assert.equal(sendApprove.disabled, true, 'mismatched version blocks approval');
  button('Nuevo trabajo').click();
  await waitFor(() => button('Crear campañaEsperando tu aprobación'));
  button('Crear campañaEsperando tu aprobación').click();
  await waitFor(() => window.document.body.textContent.includes('Te escribo por…'));
  const campCard = window.document.querySelector('section[aria-label="Revisar acción propuesta"]');
  assert.match(campCard.textContent, /ana@example\.com/);
  assert.match(campCard.textContent, /Reactivación/);
  const campApprove = [...campCard.querySelectorAll('button')].find(node => node.textContent.trim() === 'Crear borrador pausado');
  assert.ok(campApprove);
  assert.equal(campApprove.disabled, false);
  console.log('PASS: reviews render sender, full bodies and recipients; drift blocks send approval.');
  button('Nuevo trabajo').click();
  await waitFor(() => button('Prepara un resumenCompletado'));
  denied = true;
  button('Prepara un resumenCompletado').click();
  await waitFor(() => window.document.querySelector('[role="alert"]'));
  assert.equal(window.document.querySelector('pre'), null);
  assert.equal(window.document.body.textContent.includes('Punto uno'), false);
  assert.equal(window.document.body.textContent.includes('ana@example.com'), false);
  assert.ok(calls.every(url => url.startsWith('/api/cowork/runs')));
  console.log('PASS: worker-unavailable state, persistent result, metadata-compatible document, safe text rendering, focus restoration, access revocation.');
} finally { window.close(); }

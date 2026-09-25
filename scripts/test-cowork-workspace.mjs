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
const codeRun = { id: '00000000-0000-4000-8000-000000000006', message: 'Ejecutar código', mode: 'approval', status: 'waiting_approval', created_at: '2026-09-15T00:00:00Z' };
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
  if (url.includes('/code-preview')) return { ok: true, status: 200, json: async () => ({
    language: 'python', code: 'print("hola")', inputFiles: ['in.csv'],
    matches: true, label: 'Ejecutar python aislado' }) };
  if (url.includes('/versions')) return { ok: true, status: 200, json: async () => ({ currentRevision: null, versions: [] }) };
  if (url.endsWith('/runs')) return { ok: true, status: 200, json: async () => ({ runs: [run, sendRun, campRun, codeRun], canSubmit: false }) };
  if (url.endsWith(sendRun.id)) return { ok: true, status: 200, json: async () => ({ run: sendRun, events: [
    { sequence: 1, kind: 'approval.requested', payload: { action: 'cowork.effect', kind: 'send_email', targetId: sendTarget, label: 'Enviar «Propuesta»' }, created_at: sendRun.created_at }] }) };
  if (url.endsWith(campRun.id)) return { ok: true, status: 200, json: async () => ({ run: campRun, events: [
    { sequence: 1, kind: 'approval.requested', payload: { action: 'cowork.effect', kind: 'campaign_create', targetId: campRun.id, label: 'Crear campaña' }, created_at: campRun.created_at }] }) };
  if (url.endsWith(codeRun.id)) return { ok: true, status: 200, json: async () => ({ run: codeRun, events: [
    { sequence: 1, kind: 'approval.requested', payload: { action: 'cowork.effect', kind: 'code_execute', targetId: 'code:' + 'c'.repeat(64), label: 'Ejecutar python aislado' }, created_at: codeRun.created_at }] }) };
  const data = { run, events: [
      { sequence: 1, kind: 'tool.completed', payload: { action: 'leads.search', result: { scope: 'own_saved_contacts', truncated: true, items: [{ id: run.id, name: 'Ana Ejemplo', company: 'Logística Sur', email: 'ana@example.com' }] } }, created_at: run.created_at },
      { sequence: 2, kind: 'run.completed', payload: { reply: '**Resumen** listo\n\n- Punto uno\n- Punto dos', document: { title: 'Mi documento', content: '<script>window.compromised=true</script>\nContenido\n\n| Cuenta | Estado |\n|---|---|\n| Sur | Activa |' }, model: 'test', durationMs: 1 }, created_at: run.created_at },
      { sequence: 3, kind: 'tool.completed', payload: { action: 'research.get_existing', result: { availability: 'available', research: { capturedAt: run.created_at, status: 'completed', truncated: false, sources: [{ id: 'source', title: 'Fuente oficial', url: 'https://example.com/evidence', retrievedAt: run.created_at }] } } }, created_at: run.created_at }] };
  return { ok: !denied, status: denied ? 403 : 200, json: async () => data };
};
window.eval(bundle.outputFiles[0].text);
const waitFor = async (predicate, label = 'workspace') => {
  for (let i = 0; i < 200; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
  throw new Error(`Timed out waiting for ${label}`);
};
const buttons = () => [...window.document.querySelectorAll('button')];
const button = text => buttons().find(node => node.textContent.trim() === text);
const byLabel = label => window.document.querySelector(`[aria-label="${label}"]`);
const thread = title => buttons().find(node => node.getAttribute('title') === title);
try {
  await waitFor(() => thread('Prepara un resumen'), 'thread list');
  assert.equal(byLabel('Crear trabajo').disabled, true, 'worker unavailable disables sending');
  assert.match(window.document.body.textContent, /El procesamiento todavía no está disponible/);
  thread('Prepara un resumen').click();
  await waitFor(() => byLabel('Abrir Mi documento'), 'artifact cards');
  assert.equal(new URL(window.location.href).searchParams.get('work'), run.id);
  const replyBlock = [...window.document.querySelectorAll('.cw-prose')].find(node => node.textContent.includes('Punto uno'));
  assert.ok(replyBlock, 'reply renders as Markdown');
  assert.equal(replyBlock.querySelector('strong').textContent, 'Resumen');
  assert.equal(replyBlock.querySelectorAll('li').length, 2);
  assert.equal(replyBlock.textContent.includes('**'), false);
  assert.match(window.document.body.textContent, /Hizo 2 consultas/, 'activity summarizes what was consulted');

  byLabel('Abrir Fuentes de la investigación').click();
  await waitFor(() => window.document.querySelector('a[href="https://example.com/evidence"]'), 'sources panel');
  assert.equal(window.document.querySelector('a[href="https://example.com/evidence"]').rel, 'noopener noreferrer');
  assert.match(byLabel('Fuentes de investigación').textContent, /No se consultaron nuevamente/);

  byLabel('Abrir Ana Ejemplo en Contactos consultados').click();
  await waitFor(() => window.document.querySelector('section[aria-label="Contactos consultados"]'), 'contacts panel');
  const contacts = window.document.querySelector('section[aria-label="Contactos consultados"]');
  assert.match(contacts.textContent, /Ana Ejemplo/);
  assert.match(contacts.textContent, /no representa toda tu base/);
  assert.ok(contacts.querySelector('[aria-label="Descargar contactos"]'));
  const filter = contacts.querySelector('input');
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(filter, 'No coincide');
  filter.dispatchEvent(new window.Event('input', { bubbles: true }));
  await waitFor(() => contacts.textContent.includes('No hay coincidencias'), 'filter');
  assert.match(contacts.textContent, /descarga incluye 1 contacto/);

  const opener = byLabel('Abrir Mi documento');
  opener.click();
  await waitFor(() => window.document.querySelector('aside[aria-label="Documento"]'), 'document panel');
  const panel = window.document.querySelector('aside[aria-label="Documento"]');
  assert.match(panel.textContent, /<script>window.compromised=true<\/script>/, 'raw HTML stays literal text');
  assert.equal(panel.querySelector('script'), null);
  assert.equal(window.compromised, undefined);
  assert.ok(panel.querySelector('table th'), 'document tables render as tables');
  assert.equal(window.document.activeElement.textContent, 'Mi documento');
  byLabel('Cerrar documento').click();
  await waitFor(() => window.document.activeElement === byLabel('Abrir Mi documento'), 'focus restoration');
  assert.equal(window.document.activeElement, opener);

  button('Nuevo trabajo').click();
  assert.equal(new URL(window.location.href).searchParams.has('work'), false);
  await waitFor(() => thread('Enviar correo'), 'thread list after new');
  thread('Enviar correo').click();
  await waitFor(() => window.document.querySelector('section[aria-label="Revisar acción propuesta"]')?.textContent.includes('vendedor@example.com'), 'send review');
  const sendCard = window.document.querySelector('section[aria-label="Revisar acción propuesta"]');
  assert.match(sendCard.textContent, /Necesita tu aprobación/);
  assert.match(sendCard.textContent, /Hola Ana/);
  const sendApprove = [...sendCard.querySelectorAll('button')].find(node => node.textContent.trim() === 'Aprobar y enviar');
  assert.ok(sendApprove);
  assert.equal(sendApprove.disabled, true, 'mismatched version blocks approval');

  button('Nuevo trabajo').click();
  await waitFor(() => thread('Crear campaña'), 'campaign thread');
  thread('Crear campaña').click();
  await waitFor(() => window.document.body.textContent.includes('Te escribo por…'), 'campaign review');
  const campCard = window.document.querySelector('section[aria-label="Revisar acción propuesta"]');
  assert.match(campCard.textContent, /ana@example\.com/);
  assert.match(campCard.textContent, /Reactivación/);
  const campApprove = [...campCard.querySelectorAll('button')].find(node => node.textContent.trim() === 'Crear borrador pausado');
  assert.ok(campApprove);
  assert.equal(campApprove.disabled, false);
  console.log('PASS: reviews render sender, full bodies and recipients; drift blocks send approval.');

  button('Nuevo trabajo').click();
  await waitFor(() => thread('Ejecutar código'), 'code thread');
  thread('Ejecutar código').click();
  await waitFor(() => window.document.querySelector('section[aria-label="Revisar acción propuesta"]')?.textContent.includes('print('), 'code review');
  const codeCard = window.document.querySelector('section[aria-label="Revisar acción propuesta"]');
  assert.match(codeCard.textContent, /Python/);
  assert.match(codeCard.textContent, /in\.csv/);
  assert.match(codeCard.textContent, /entorno aislado/);
  const codeApprove = [...codeCard.querySelectorAll('button')].find(node => node.textContent.trim() === 'Aprobar y ejecutar');
  assert.ok(codeApprove);
  assert.equal(codeApprove.disabled, false);
  console.log('PASS: code review renders pinned code, inputs and isolation limits.');

  button('Nuevo trabajo').click();
  await waitFor(() => thread('Prepara un resumen'), 'summary thread');
  denied = true;
  thread('Prepara un resumen').click();
  await waitFor(() => window.document.querySelector('[role="alert"]'), 'revocation alert');
  assert.equal(window.document.body.textContent.includes('Punto uno'), false);
  assert.equal(window.document.body.textContent.includes('ana@example.com'), false);
  assert.equal(window.document.querySelector('aside[aria-label="Documento"]'), null);
  assert.ok(calls.every(url => url.startsWith('/api/cowork/runs')), `unexpected calls: ${calls.filter(url => !url.startsWith('/api/cowork/runs')).join(', ')}`);
  console.log('PASS: worker-unavailable state, conversation view, Markdown artifacts, safe text rendering, focus restoration, access revocation.');
} finally { window.close(); }

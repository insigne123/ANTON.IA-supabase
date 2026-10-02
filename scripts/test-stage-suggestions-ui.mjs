// «Sugerencias de etapa» in the pipeline (Plan 5, PR-10): each suggestion says who, the move and why; it is accepted or
// dismissed one by one or all at once, and nothing renders when there is nothing to decide. Isolated DOM test.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const bundle = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
  import {StageSuggestions} from './src/components/crm/StageSuggestions';
  const root = createRoot(document.getElementById('root'));
  const names = { 'lead_saved|1': 'Marcela Rojas', 'lead_enriched|2': 'Rafael Díaz' };
  window.__render = (suggestions, busy = false) => root.render(<StageSuggestions suggestions={suggestions} busy={busy}
    nameFor={id => names[id] || 'Contacto'} onDecide={(ids, decision) => { window.__decisions.push([ids, decision]); }} />);`,
resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"test"' } });
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/crm', runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;
window.__decisions = [];
window.eval(bundle.outputFiles[0].text);
const settle = async (ms = 100) => { for (let i = 0; i < ms / 10; i++) await new Promise(resolve => setTimeout(resolve, 10)); };
const button = label => [...window.document.querySelectorAll('button')].find(node => node.textContent.trim() === label || node.getAttribute('aria-label') === label);
const suggestions = [
  { id: 's1', crm_id: 'lead_saved|1', from_stage: 'contacted', to_stage: 'engaged', reason: 'Respondió con interés.', source: 'positive', created_at: '2026-10-02T10:00:00Z' },
  { id: 's2', crm_id: 'lead_enriched|2', from_stage: null, to_stage: 'contacted', reason: 'Se entregó el correo.', source: 'delivered', created_at: '2026-10-02T09:00:00Z' },
];
try {
  window.__render([]);
  await settle();
  assert.equal(window.document.getElementById('root').textContent, '', 'nothing to decide, nothing shown');

  window.__render(suggestions);
  await settle();
  const text = window.document.body.textContent;
  assert.match(text, /2 sugerencias de etapa/);
  assert.match(text, /Nada se mueve hasta que lo aceptes\./);
  assert.match(text, /Marcela Rojas · Contactado → Interesado/);
  assert.match(text, /Respondió con interés\./);
  assert.match(text, /Rafael Díaz · Nuevos → Contactado/);

  button('Aceptar: Marcela Rojas a Contactado → Interesado').click();
  button('Descartar la sugerencia de Rafael Díaz').click();
  button('Aceptar todas').click();
  button('Descartar todas').click();
  assert.deepEqual(JSON.parse(JSON.stringify(window.__decisions)), [
    [['s1'], 'accept'], [['s2'], 'dismiss'], [['s1', 's2'], 'accept'], [['s1', 's2'], 'dismiss'],
  ]);

  // The list folds away; while a decision is saving nothing else can be decided.
  const toggle = window.document.querySelector('button[aria-expanded]');
  toggle.click();
  await settle();
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(window.document.querySelectorAll('li').length, 0);
  window.__render(suggestions, true);
  await settle();
  assert.ok(button('Aceptar todas').disabled && button('Descartar todas').disabled);
  console.log('PASS: stage suggestions say who, the move and why, decide one or all, fold away and wait while saving.');
} finally { window.close(); }

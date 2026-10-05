// The pipeline as a CRM panel (Plan 11, PR 4a): figures compared with the previous period, the reading sentences with the
// stalled stage, the open stages with their changes waiting for confirmation, how far each stage gets, a table behind every
// chart, and how fresh the data is. Isolated DOM test, not visual certification (the charts are checked in the browser).
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const bundle = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
  import {PipelineDashboard} from './src/components/crm/PipelineDashboard';
  const NOW = Date.parse('2026-10-02T12:00:00Z');
  const row = (gid, stage, patch = {}) => ({ gid, sourceId: gid, status: 'saved', kind: 'lead_saved', name: gid, company: 'Empresa ' + gid, stage, createdAt: '2026-09-29T10:00:00Z', ...patch });
  const sent = (gid, at, replied) => row(gid, replied ? 'engaged' : 'contacted', { kind: 'contacted', status: replied ? 'replied' : 'sent', createdAt: at, sentAt: at, updatedAt: at });
  const rows = [
    row('Ana', 'inbox'), row('Beto', null, { createdAt: '2026-08-20T10:00:00Z' }),
    ...['Carla', 'Dani', 'Eva'].map((name, i) => row(name, 'contacted', { updatedAt: '2026-09-0' + (i + 1) + 'T10:00:00Z' })),
    row('Fede', 'contacted', { updatedAt: '2026-09-28T10:00:00Z' }),
    row('Inés', 'qualified'), row('Juan', 'meeting'), row('Kati', 'closed_won'), row('Luis', 'closed_lost'),
    sent('c1', '2026-09-10T15:00:00Z', true), sent('c2', '2026-09-15T15:00:00Z', true), sent('c3', '2026-09-20T15:00:00Z', false), sent('c4', '2026-09-25T15:00:00Z', false),
    sent('c5', '2026-08-10T15:00:00Z', true), sent('c6', '2026-08-20T15:00:00Z', false),
  ];
  createRoot(document.getElementById('root')).render(<PipelineDashboard rows={rows} now={NOW} refreshedAt={NOW - 2 * 60_000}
    onOpenStage={stage => { window.__opened.push(stage); }} pending={{ engaged: 2, contacted: 1 }} />);`,
resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"test"' } });
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/crm', runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;
window.__opened = [];
// The charts size themselves with ResizeObserver; jsdom has no layout, so they stay empty here and their tables carry the data.
window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
const warn = window.console.warn.bind(window.console);
window.console.warn = (...args) => { if (!/of chart should be greater than 0/.test(String(args[0]))) warn(...args); };
window.eval(bundle.outputFiles[0].text);
const settle = async (ms = 100) => { for (let i = 0; i < ms / 10; i++) await new Promise(resolve => setTimeout(resolve, 10)); };
const section = label => window.document.querySelector(`section[aria-label="${label}"]`);
const buttonIn = (root, text) => [...root.querySelectorAll('button')].find(button => button.textContent.includes(text));
try {
  await settle();
  const filters = window.document.querySelector('[role="group"][aria-label="Filtros del panel"]');
  assert.deepEqual([...filters.querySelectorAll('button[role="combobox"]')].map(select => `${select.getAttribute('aria-label')}: ${select.textContent}`),
    ['Período: Últimos 30 días', 'Responsable: Todos los responsables', 'Origen: Todos los orígenes'], 'one row of filters scopes the panel');
  assert.match(filters.textContent, /Actualizado hace 2 min · se actualiza solo/, 'the panel says how fresh it is');

  const tiles = [...section('Cifras del pipeline').children].map(tile => tile.textContent);
  assert.deepEqual(tiles, [
    'Abiertos14de 16 en el pipeline',
    'Leads nuevos9+8 vs 30 días antes',
    'Contactados4+2 vs 30 días antes',
    'Tasa de respuesta50 %igual que 30 días antes',
    'En reunión o más2reunión, negociación o ganado',
    '% ganados50 %1 ganado · 1 perdido',
  ]);
  for (const tile of section('Cifras del pipeline').children) {
    if (/vs/.test(tile.textContent)) assert.ok(tile.querySelector('svg[aria-hidden="true"]'), 'a compared figure carries its arrow, and the sign is written');
  }

  const reading = section('Lectura del pipeline');
  assert.match(reading.textContent, /En últimos 30 días contactaste a 4 personas, 2 más que en los 30 días anteriores\./);
  assert.match(reading.textContent, /Respondió el 50 % de quienes contactaste, igual que en los 30 días anteriores\./);
  assert.match(reading.textContent, /«Contactado» tiene 4 leads sin movimiento hace más de 14 días/);
  buttonIn(reading, 'Ver «Contactado»').click();
  assert.deepEqual(window.__opened.splice(0), ['contacted'], 'the stalled stage opens from the sentence');

  const stages = section('Pipeline abierto por etapa');
  const legend = [...stages.querySelectorAll('ul[aria-label="Etapas"] button')].map(button => button.textContent);
  assert.deepEqual(legend, ['Nuevos214 %', 'Calificado17 %', 'Contactado1 por confirmar750 %', 'Interesado2 por confirmar321 %', 'Reunión17 %', 'Negociación00 %']);
  buttonIn(stages, 'Reunión').click();
  assert.deepEqual(window.__opened.splice(0), ['meeting'], 'a stage of the legend opens its list');
  assert.match(stages.querySelector('[aria-label^="Pipeline abierto por etapa:"]').getAttribute('aria-label'), /Contactado 7, Interesado 3/);

  // Every chart has its table, closed until asked for.
  assert.equal(stages.querySelector('table'), null);
  buttonIn(stages, 'Ver como tabla').click();
  await settle();
  assert.deepEqual([...stages.querySelectorAll('tbody tr')].map(tr => [...tr.cells].map(cell => cell.textContent).join(' | ')).slice(0, 3),
    ['Nuevos | 2 | 14 %', 'Calificado | 1 | 7 %', 'Contactado | 7 | 50 %']);

  const funnel = section('Avance por etapa');
  assert.match(buttonIn(funnel, 'Contactado').textContent, /Contactado12 · 42 % siguió/, 'contactado → interesado: the share that moved on');
  buttonIn(funnel, 'Ganado').click();
  assert.deepEqual(window.__opened.splice(0), ['closed_won']);
  assert.match(funnel.textContent, /Perdidos: 1\./);

  const months = section('Contactos por mes');
  assert.match(months.textContent, /promedio de los 3 meses anteriores: 2 por mes/);
  buttonIn(months, 'Ver como tabla').click();
  await settle();
  assert.deepEqual([...months.querySelectorAll('tbody tr')].slice(-2).map(tr => [...tr.cells].map(cell => cell.textContent).join(' | ')),
    ['sept ’26 | 4 | 2 | 50 %', 'oct ’26 | 0 | 0 | —']);
  const leads = section('Leads nuevos, últimos 13 meses');
  buttonIn(leads, 'Ver como tabla').click();
  await settle();
  assert.equal(leads.querySelectorAll('tbody tr').length, 13, 'thirteen months, the current one included');
  console.log('PASS: the pipeline panel compares each figure with the previous period, reads it in sentences, opens a stage from the sentence, the legend or the funnel, marks the changes waiting for confirmation and has a table behind every chart.');
} finally { window.close(); }

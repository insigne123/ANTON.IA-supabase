// The pipeline as a graph (Plan 5, PR-10b): the figures, a node per stage with its count and the share that moved on,
// the stage changes waiting for confirmation, the five most recent leads on hover or focus, the whole stage on click,
// and the weekly trend with a table for screen readers. Isolated DOM test, not visual certification.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const bundle = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
  import {PipelineFlowView} from './src/components/crm/PipelineFlowView';
  const NOW = Date.parse('2026-10-02T12:00:00Z');
  const row = (gid, stage, patch = {}) => ({ gid, sourceId: gid, status: 'saved', kind: 'lead_saved', name: gid, company: 'Empresa ' + gid, stage, createdAt: '2026-09-29T10:00:00Z', ...patch });
  const rows = [row('Ana', 'inbox'), row('Beto', null), ...['Carla', 'Dani', 'Eva', 'Fede', 'Gabi', 'Hugo'].map((name, i) => row(name, 'contacted', { updatedAt: '2026-09-2' + i + 'T10:00:00Z' })),
    row('Inés', 'engaged'), row('Juan', 'meeting'), row('Kati', 'closed_won'), row('Luis', 'closed_lost')];
  createRoot(document.getElementById('root')).render(<PipelineFlowView rows={rows} now={NOW} onOpenStage={stage => { window.__opened.push(stage); }} pending={{ engaged: 2, closed_lost: 1 }} />);`,
resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"test"' } });
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/crm', runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;
window.__opened = [];
window.eval(bundle.outputFiles[0].text);
const settle = async (ms = 100) => { for (let i = 0; i < ms / 10; i++) await new Promise(resolve => setTimeout(resolve, 10)); };
const node = label => [...window.document.querySelectorAll('button')].find(item => item.getAttribute('aria-label')?.startsWith(`${label}:`));
const region = () => window.document.querySelector('[aria-live="polite"]');
try {
  await settle();
  const figures = [...window.document.querySelectorAll('section[aria-label="Cifras del pipeline"] > div')].map(tile => tile.textContent);
  assert.deepEqual(figures, [
    'Activos10de 12 en el pipeline',
    'Tasa de respuesta33 %de 9 contactados',
    'Llegaron a reunión2reunión, negociación o ganado',
    'Ganados11 perdidos',
  ]);
  assert.equal(node('Contactado').getAttribute('aria-label'), 'Contactado: 6 leads. Ver la etapa completa.');
  assert.equal(node('Nuevos').getAttribute('aria-label'), 'Nuevos: 2 leads. Ver la etapa completa.');
  assert.equal(node('Perdido').getAttribute('aria-label'), 'Perdido: 1 lead, 1 cambio por confirmar. Ver la etapa completa.');
  assert.equal(node('Interesado').getAttribute('aria-label'), 'Interesado: 1 lead, 2 cambios por confirmar. Ver la etapa completa.');
  assert.match(node('Interesado').textContent, /\+2 por confirmar/, 'the stage marks the changes waiting for confirmation');
  assert.doesNotMatch(node('Contactado').textContent, /por confirmar/, 'nothing to confirm, no mark');
  const flowText = window.document.querySelector('section[aria-labelledby="pipeline-flow-title"] ol').textContent;
  assert.match(flowText, /33 %/, 'contactado → interesado: 3 of 9');
  assert.match(region().textContent, /Pasa el mouse o el foco por una etapa/);

  // Hover shows the five most recent of the stage; focus does the same for the keyboard; an empty stage says so.
  node('Contactado').parentElement.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }));
  await settle();
  assert.match(region().textContent, /Más recientes en Contactado/);
  assert.deepEqual([...region().querySelectorAll('tbody tr td:first-child')].map(cell => cell.textContent), ['Hugo', 'Gabi', 'Fede', 'Eva', 'Dani']);
  node('Contactado').parentElement.dispatchEvent(new window.MouseEvent('mouseout', { bubbles: true }));
  await settle();
  node('Calificado').focus();
  await settle();
  assert.match(region().textContent, /Aún no hay leads en Calificado\./);

  node('Reunión').click();
  assert.deepEqual([...window.__opened], ['meeting'], 'a click opens the whole stage');

  // The weekly trend: one bar for this week, eight weeks in the table for screen readers.
  const trend = window.document.querySelector('section[aria-labelledby="pipeline-trend-title"]');
  assert.match(trend.textContent, /12 en las últimas 8 semanas/);
  assert.equal(trend.querySelectorAll('table.sr-only tbody tr').length, 8);
  const columns = trend.querySelectorAll('div.flex.h-40 > div');
  assert.equal(columns.length, 8);
  assert.equal([...columns].filter(column => column.querySelector('div')).length, 1, 'only the week with new leads has a bar');
  columns[7].dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }));
  await settle();
  assert.match(trend.querySelector('[role="status"]').textContent, /Semana del 28 sept?: 12/);
  console.log('PASS: the pipeline graph shows the figures, counts and conversion per stage, the changes waiting for confirmation, recent leads on hover or focus, the stage on click and the weekly trend.');
} finally { window.close(); }

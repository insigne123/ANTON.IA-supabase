// The value of each deal in the pipeline panel (Plan 11, PR 4c, CRM_DEAL_VALUES_ENABLED): «Pipeline abierto» and «Ganado»
// with its comparison, deals in another currency named apart, the donut by count or by amount with its table, and the
// column sums and card values of the board. Isolated DOM test, not visual certification (the charts are checked in the browser).
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

// The board cards read the signed-in team (Supabase); here nobody is signed in, as on a first render.
const stubs = { name: 'stubs', setup(b) {
  b.onResolve({ filter: /^@\/context\/AuthContext$/ }, () => ({ path: 'auth', namespace: 'stub' }));
  b.onResolve({ filter: /^@\/lib\/services\/lead-collaboration-service$/ }, () => ({ path: 'collaboration', namespace: 'stub' }));
  b.onLoad({ filter: /^auth$/, namespace: 'stub' }, () => ({ contents: 'export const useAuth = () => ({ organizationId: null, user: null });', loader: 'js' }));
  b.onLoad({ filter: /^collaboration$/, namespace: 'stub' }, () => ({ loader: 'js', contents: `export const resolveLeadUuid = () => null;
    export const isLeadClaimActive = () => false; export const contactThreadConflictsWithLead = () => false; export const collaborationMemberName = () => '';
    export const leadCollaborationService = { subscribe: () => () => {}, getCollaboration: async () => null };` }));
} };

const bundle = await build({ plugins: [stubs], stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
  import {PipelineDashboard} from './src/components/crm/PipelineDashboard';
  import {KanbanColumn} from './src/components/crm/KanbanColumn';
  import {DndContext} from '@dnd-kit/core';
  const NOW = Date.parse('2026-10-02T12:00:00Z');
  const day = n => new Date(NOW - n * 86400000).toISOString();
  const row = (gid, stage, patch = {}) => ({ gid, sourceId: gid, status: 'saved', kind: 'lead_saved', name: gid, company: 'Empresa ' + gid, stage, createdAt: day(20), ...patch });
  const rows = [
    row('Ana', 'meeting', { dealValue: 4500000, dealCurrency: 'CLP' }),
    row('Beto', 'engaged', { dealValue: 1200000, dealCurrency: 'CLP' }),
    row('Carla', 'negotiation', { dealValue: 6000000, dealCurrency: 'CLP' }),
    row('Dani', 'qualified', { dealValue: 3000, dealCurrency: 'USD' }),
    row('Eva', 'closed_won', { dealValue: 2500000, dealCurrency: 'CLP', wonAt: day(5) }),
    row('Fede', 'closed_won', { dealValue: 1000000, dealCurrency: 'CLP', wonAt: day(40) }),
    row('Gabi', 'contacted'),
  ];
  createRoot(document.getElementById('root')).render(<PipelineDashboard rows={rows} now={NOW} dealValues onOpenStage={() => {}} />);
  createRoot(document.getElementById('board')).render(<DndContext><KanbanColumn id="meeting" title="Reunión" count={2}
    leads={[rows[0], row('Hugo', 'meeting', { dealValue: 500000, dealCurrency: 'CLP' })]} /></DndContext>);
  createRoot(document.getElementById('off')).render(<PipelineDashboard rows={rows} now={NOW} onOpenStage={() => {}} />);`,
resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"test"' } });
const dom = new JSDOM('<div id="root"></div><div id="board"></div><div id="off"></div>', { url: 'http://localhost/crm', runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;
window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
const warn = window.console.warn.bind(window.console);
window.console.warn = (...args) => { if (!/of chart should be greater than 0/.test(String(args[0]))) warn(...args); };
window.eval(bundle.outputFiles[0].text);
const settle = async (ms = 100) => { for (let i = 0; i < ms / 10; i++) await new Promise(resolve => setTimeout(resolve, 10)); };
const root = window.document.getElementById('root');
const section = label => root.querySelector(`section[aria-label="${label}"]`);
const buttonIn = (scope, text) => [...scope.querySelectorAll('button')].find(button => button.textContent.trim() === text);
try {
  await settle();
  const tiles = [...section('Cifras del pipeline').children].map(tile => tile.textContent);
  assert.deepEqual(tiles.slice(0, 2), ['Pipeline abierto$11,7 Men 3 negocios abiertos con valor', 'Ganado$2,5 M+$1,5 M vs 30 días antes'],
    'the open pipeline and what was won, compared with the period before, never mixing currencies');
  assert.equal(tiles.length, 8, 'the six figures of the panel stay');
  assert.match(root.textContent, /Los montos suman los negocios en pesos \(CLP\), la moneda de la mayoría\. Aparte: 1 negocio en dólares \(USD\)\./);

  const stages = section('Pipeline abierto por etapa');
  const count = buttonIn(stages, 'Cantidad');
  const amount = buttonIn(stages, 'Monto');
  assert.equal(count.getAttribute('aria-pressed'), 'true', 'the donut starts by count');
  amount.click();
  await settle();
  assert.equal(amount.getAttribute('aria-pressed'), 'true');
  assert.match(stages.textContent, /\$11\.700\.000 en negocios abiertos/, 'the subtitle has the full amount');
  const legend = [...stages.querySelectorAll('ul[aria-label="Etapas"] button')].map(button => button.textContent);
  assert.deepEqual(legend, ['Nuevos$00 %', 'Calificado$00 %', 'Contactado$00 %', 'Interesado$1,2 M10 %', 'Reunión$4,5 M38 %', 'Negociación$6 M51 %']);
  [...stages.querySelectorAll('button')].find(button => /Ver como tabla/.test(button.textContent)).click();
  await settle();
  assert.deepEqual([...stages.querySelectorAll('thead th')].map(th => th.textContent), ['Etapa', 'Monto', '% del abierto']);
  assert.deepEqual([...stages.querySelectorAll('tbody tr')].map(tr => [...tr.cells].map(cell => cell.textContent).join(' | ')).slice(-1), ['Negociación | $6.000.000 | 51 %']);

  const board = window.document.getElementById('board');
  assert.match(board.querySelector('header').textContent, /Suma: \$5 M/, 'a column adds the values of its cards');
  assert.match(board.textContent, /Valor del negocio: \$4\.500\.000/, 'a card shows the value of its deal');

  const off = window.document.getElementById('off');
  assert.ok(!/Pipeline abierto\$/.test(off.textContent) && ![...off.querySelectorAll('button')].some(button => button.textContent.trim() === 'Monto'),
    'without the switch the panel stays as it was');
  console.log('PASS: with deal values the panel adds the open pipeline and what was won against the period before, names other currencies apart, shows the donut by amount with its table, and the board adds each column.');
} finally { window.close(); }

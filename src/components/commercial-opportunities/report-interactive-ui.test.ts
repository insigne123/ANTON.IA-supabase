import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as reportView from '@/lib/commercial-opportunities/report-view';
import * as reportMarks from '@/lib/commercial-opportunities/report-marks';
import * as workspace from '@/lib/commercial-opportunities/workspace';

const require = createRequire(import.meta.url);
const compile = async (file: string) => ts.transpileModule(await readFile(new URL(file, import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const passthrough = ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children);
const dependencies: Record<string, unknown> = {
  'lucide-react': new Proxy({}, { get: () => 'svg' }),
  '@/components/ui/button': { Button: ({ asChild, variant, size, children, ...props }: any) => asChild ? children : React.createElement('button', props, children) },
  '@/components/ui/popover': { Popover: passthrough, PopoverTrigger: passthrough, PopoverContent: ({ children }: any) => React.createElement('div', { 'data-popover': '' }, children) },
  '@/components/ui/textarea': { Textarea: (props: any) => React.createElement('textarea', props) },
  '@/lib/utils': { cn: (...values: unknown[]) => values.filter(Boolean).join(' ') },
  '@/lib/commercial-opportunities/report-view': reportView,
  '@/lib/commercial-opportunities/report-marks': reportMarks,
  '@/lib/commercial-opportunities/workspace': workspace,
};
const load = (code: string) => { const exports: any = {}; new Function('require', 'exports', code)((id: string) => (id in dependencies ? dependencies[id] : require(id)), exports); return exports; };
dependencies['./RoutePath'] = load(await compile('./RoutePath.tsx'));
dependencies['./ReportMarks'] = load(await compile('./ReportMarks.tsx'));
const { OpportunityWorkReport } = load(await compile('./OpportunityWorkReport.tsx'));
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/<!-- -->/g, '').replace(/\s+/g, ' ');

const report = {
  title: 'Seguridad Museo', executive: 'Conviene postular si se consigue la boleta a tiempo.', recommendation: 'conditional', reasons: [],
  sections: [], requirements: [
    { title: 'Boleta de garantía de seriedad', status: 'pending', evidence: [], action: 'Pedirla al banco', role: 'Finanzas', due: 'Antes del cierre' },
    { title: 'Anexo N.º 1 firmado', status: 'supported', evidence: [], action: 'Completar y firmar', role: 'Legal', due: '' },
  ],
  tasks: [{ title: 'Armar la oferta técnica', role: 'Operaciones', due: 'Semana 1', dependency: '', evidence: '' }],
  milestones: [
    { label: 'Fin de consultas', date: '16-10-2099 9:00', state: 'documented', citations: [] },
    { label: 'Cierre de ofertas', date: '29-10-2099 9:00', state: 'documented', citations: [] },
    { label: 'Adjudicación', date: 'Por confirmar', state: 'unknown', citations: [] },
  ],
  risks: [], scenarios: [], questions: ['¿Se acepta póliza en vez de boleta?'], warnings: [], nextSteps: ['Pedir la boleta de garantía'],
  generatedAt: '2026-10-16T12:00:00Z', coverage: [], sources: [], kind: 'tender',
};
const render = (props: Record<string, unknown> = {}) => renderToStaticMarkup(React.createElement(OpportunityWorkReport, {
  report, opportunity: { title: 'Seguridad Museo', deadline: '2099-10-29T12:00:00Z' }, onTask: () => {}, onAsk: () => {}, ...props }));
const key = (kind: any, label: string) => reportMarks.reportItemKey(kind, label);

test('without the marks table the report reads as before: no checks, no progress, no tools', () => {
  const html = render();
  assert.doesNotMatch(html, /role="checkbox"/);
  assert.doesNotMatch(html, /Avance de la postulación/);
  assert.doesNotMatch(html, /Destacar:/);
  assert.match(text(html), /Ruta de la postulación/, 'the route is drawn from the dates and the plan');
});

test('with marks: each requirement, task and step can be ticked, and the progress counts them', () => {
  const marks = { available: true, items: reportMarks.marksFromRows([
    { item_key: key('requirement', 'Boleta de garantía de seriedad'), done: true, highlight: true, note: 'Lo ve Ana el lunes', updated_by: 'u1', updated_at: '2026-10-16T14:00:00Z' },
  ]) };
  const html = render({ marks, onMark: async () => null, people: [{ user_id: 'u1', name: 'Ana Soto' }] });
  // A step, two requirements and a task; and the route's four steps (the task and three dates), drawn as a zigzag for
  // wide screens and as a line for phones (CSS shows one).
  assert.equal((html.match(/role="checkbox"/g) || []).length, 4 + 4 * 2);
  assert.match(html, /aria-checked="true" aria-label="Listo: Boleta de garantía de seriedad"/);
  assert.match(text(html), /Avance de la postulación 1 de 4 listos/);
  assert.match(html, /role="progressbar"[^>]*aria-valuenow="1"/);
  // Highlighted: listed on top and marked in place; its note sits beside it with who wrote it.
  assert.match(text(html), /Destacados 1 Boleta de garantía de seriedad/);
  assert.match(html, /aria-pressed="true" aria-label="Quitar destacado: Boleta de garantía de seriedad"/);
  assert.match(html, /aria-label="Nota: Boleta de garantía de seriedad"/);
  assert.match(text(html), /Lo ve Ana el lunes Ana Soto · 16 de octubre de 2026, 11:00/);
});

test('each future date offers a reminder, with Google Calendar and a calendar file, and the dates without a day do not', () => {
  const html = render({ marks: { available: true, items: {} }, onMark: async () => null });
  assert.equal((html.match(/Agregar a Google Calendar/g) || []).length, 2, 'one per dated milestone; «Por confirmar» has none');
  assert.match(html, /href="https:\/\/calendar\.google\.com\/calendar\/render\?action=TEMPLATE[^"]*dates=20991028T120000Z%2F20991028T123000Z/, 'one day before by default');
  assert.match(text(html), /Recordatorios de todas/);
  assert.match(text(html), /Descargar todas \(\.ics\)/);
  assert.match(text(html), /Una semana antes/);
});

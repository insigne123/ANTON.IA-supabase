import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as reportView from '@/lib/commercial-opportunities/report-view';
import * as reportMarks from '@/lib/commercial-opportunities/report-marks';
import * as markQueue from '@/lib/commercial-opportunities/mark-queue';
import * as priority from '@/lib/commercial-opportunities/priority';
import * as signalBrief from '@/lib/commercial-opportunities/signal-brief';
import * as signalSheet from '@/lib/commercial-opportunities/signal-sheet';
import { NOW, hiringItem, postItem, report } from '@/lib/commercial-opportunities/signal-sheet-fixtures';

const require = createRequire(import.meta.url);
const compile = async (file: string) => ts.transpileModule(await readFile(new URL(file, import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const passthrough = ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children);
const dependencies: Record<string, unknown> = {
  'lucide-react': new Proxy({}, { get: () => 'svg' }),
  '@/components/ui/button': { Button: ({ asChild, variant, size, children, ...props }: any) => asChild ? children : React.createElement('button', props, children) },
  '@/components/ui/popover': { Popover: passthrough, PopoverTrigger: passthrough, PopoverContent: ({ children }: any) => React.createElement('div', { 'data-popover': '' }, children) },
  '@/components/ui/textarea': { Textarea: (props: any) => React.createElement('textarea', props) },
  '@/components/ui/input': { Input: (props: any) => React.createElement('input', props) },
  '@/lib/utils': { cn: (...values: unknown[]) => values.filter(Boolean).join(' ') },
  '@/lib/commercial-opportunities/report-view': reportView,
  '@/lib/commercial-opportunities/report-marks': reportMarks,
  '@/lib/commercial-opportunities/mark-queue': markQueue,
  '@/lib/commercial-opportunities/priority': priority,
  '@/lib/commercial-opportunities/signal-brief': signalBrief,
  '@/lib/commercial-opportunities/signal-sheet': signalSheet,
};
const load = (code: string) => { const exports: any = {}; new Function('require', 'exports', code)((id: string) => (id in dependencies ? dependencies[id] : require(id)), exports); return exports; };
dependencies['./PriorityStars'] = load(await compile('./PriorityStars.tsx'));
dependencies['./ReportMarks'] = load(await compile('./ReportMarks.tsx'));
const { SignalSheetPanel } = load(await compile('./SignalSheet.tsx'));
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/<!-- -->/g, '').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ');
const render = (props: Record<string, unknown> = {}) => renderToStaticMarkup(React.createElement(SignalSheetPanel, {
  item: hiringItem(), report: report(), now: NOW, onTask: () => {}, onAsk: () => {}, ...props }));
const key = (kind: any, label: string) => reportMarks.reportItemKey(kind, label);

test('the sheet of a company that is hiring shows the pulse as figures and bars, the fit as a meter, and every part of the plan', () => {
  const html = render({ onContacts: () => {}, downloadHref: '/api/x/export?format=pdf' });
  const words = text(html);
  assert.match(html, /role="img" aria-label="4 de 5 estrellas/, 'the stars have their words');
  assert.match(words, /Contactar, validando primero lo pendiente/);
  assert.match(words, /Ofrecerles refuerzos de bodega/);
  for (const title of ['La señal', 'Calce con tu oferta', 'La empresa', 'A quién contactar', 'Cómo abordarlos', 'Mensajes listos', 'Secuencia de seguimiento', 'Objeciones y cómo responderlas', 'Qué validar antes de invertir tiempo', 'Pasos comerciales', 'Riesgos', 'Preguntas para la primera conversación', 'Avisos de muestra', 'Qué falta en esta ficha'])
    assert.match(words, new RegExp(title), `section: ${title}`);
  assert.match(words, /Avisos en 30 días/); assert.match(words, /11,7 veces su ritmo anterior/);
  assert.match(words, /reponedor 14 · 34 %/); assert.match(words, /Metropolitana 19 · 46 %/);
  assert.match(words, /Promedio anterior/); assert.match(words, /Última semana/);
  assert.match(html, /role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="75"/);
  assert.match(words, /Calza muy bien/);
  assert.match(html, /href="https:\/\/www\.linkedin\.com\/search\/results\/people\/\?keywords=/, 'a LinkedIn search for each buyer');
  assert.match(html, /href="\/api\/x\/export\?format=pdf"/); assert.match(words, /Descargar ficha en PDF/);
  assert.match(words, /Buscar a quién escribir/);
  assert.equal((html.match(/>Copiar</g) || []).length, 3, 'a copy button for each message');
  assert.match(words, /\d+ \/ 300/, 'the length of the connection note');
  assert.doesNotMatch(words, /undefined|NaN|\[object|null/);
});

test('the sections follow the order of the PDF', () => {
  const html = render();
  const order = ['La señal', 'Calce con tu oferta', 'La empresa', 'A quién contactar', 'Cómo abordarlos', 'Mensajes listos', 'Secuencia de seguimiento', 'Objeciones', 'Qué validar', 'Pasos comerciales', 'Riesgos', 'Preguntas para la primera', 'Avisos de muestra', 'Qué falta'];
  const at = order.map(title => html.indexOf(`>${title}`));
  assert.ok(at.every(index => index > 0), 'all present');
  assert.deepEqual([...at].sort((a, b) => a - b), at, 'in order');
});

test('before the plan is written the sheet is what the radar saw, and offers to write it only when asked to', () => {
  const html = render({ report: null });
  const words = text(html);
  assert.match(words, /Lo que ya vio el radar/);
  assert.match(words, /Retail Pacífico está contratando: 41 avisos en 30 días\./);
  assert.match(words, /La señal/); assert.match(words, /Calce con tu oferta/);
  assert.doesNotMatch(words, /Mensajes listos/);
  assert.match(words, /Qué falta en esta ficha/);
  assert.doesNotMatch(words, /Generar ficha comercial/, 'the page already has its own «Generar»: it is not offered twice');
  assert.match(text(render({ report: null, onGenerate: () => {} })), /Generar ficha comercial/);
});

test('a LinkedIn post is drawn as a quote with who wrote it and when', () => {
  const html = render({ item: postItem(), report: null });
  assert.match(html, /<blockquote/);
  assert.match(text(html), /Buscamos 30 conductores clase A4/);
  assert.match(text(html), /19 de octubre de 2026/);
  assert.doesNotMatch(text(html), /Cargos que buscan/);
});

test('with the marks table each step, requirement and task can be ticked, the progress counts them and the highlights are listed', () => {
  const sheet = signalSheet.buildSignalSheet({ item: hiringItem(), report: report(), now: NOW })!;
  const marks = { available: true, items: reportMarks.marksFromRows([
    { item_key: key('step', sheet.nextSteps[0]), done: true, highlight: true, note: 'Lo ve Ana', updated_by: 'u1', updated_at: '2026-10-22T14:00:00Z' },
  ]) };
  const html = render({ marks, onMark: async () => null, people: [{ user_id: 'u1', name: 'Ana Soto' }] });
  assert.equal((html.match(/role="checkbox"/g) || []).length, sheet.nextSteps.length + sheet.validate.length + sheet.plan.length);
  assert.match(html, /aria-checked="true" aria-label="Listo: /);
  assert.match(text(html), /1 de \d+ listos/);
  assert.match(text(html), /Destacados/); assert.match(text(html), /Ana Soto/);
  assert.doesNotMatch(render(), /role="checkbox"/, 'without the table the sheet reads as before: no checks');
});

test('a sheet for something that is not a signal draws nothing', () => {
  assert.equal(render({ item: { ...hiringItem(), kind: 'tender' } }), '');
});

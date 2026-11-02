import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as results from '../../lib/credit-results';

const require = createRequire(import.meta.url);
const compile = async (file: string) => ts.transpileModule(await readFile(new URL(file, import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const passthrough = (tag: string) => { const Plain = ({ children, ...props }: any) => React.createElement(tag, props, children); Plain.displayName = tag; return Plain; };
const dependencies: Record<string, unknown> = {
  'next/link': ({ href, children, ...props }: any) => React.createElement('a', { href, ...props }, children),
  'lucide-react': new Proxy({}, { get: () => 'svg' }),
  '@/lib/credit-results': results,
  '@/components/ui/button': { Button: ({ asChild, variant, size, children, ...props }: any) => React.createElement('button', props, children) },
  '@/components/ui/card': { Card: passthrough('section'), CardContent: passthrough('div'), CardHeader: passthrough('div') },
  '@/components/ui/skeleton': { Skeleton: () => React.createElement('div', { 'data-skeleton': true }) },
  '@/components/ui/table': { Table: passthrough('table'), TableBody: passthrough('tbody'), TableCell: passthrough('td'), TableHead: passthrough('th'), TableHeader: passthrough('thead'), TableRow: passthrough('tr') },
  './usePersonalHome': { usePersonalHome: () => ({ data: null }) },
};
const load = (code: string) => { const exports: any = {}; new Function('require', 'exports', code)((id: string) => (id in dependencies ? dependencies[id] : require(id)), exports); return exports; };
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/<!-- -->/g, '').replace(/\s+/g, ' ').trim();

const { CreditResultsView } = load(await compile('./CreditResultsCard.tsx'));
const { MyCreditResultsView } = load(await compile('../home/MyCreditResults.tsx'));
const totals = { credits: 28, paid: 4, withPhone: 2, contacted: 3, conversations: 2, meetings: 1, waiting: 1 };
const people = [
  { userId: 'u1', name: 'Ana Rojas', credits: 19, paid: 3, withPhone: 2, contacted: 3, conversations: 2, meetings: 1, waiting: 0 },
  { userId: 'u2', name: 'Leo Soto', credits: 9, paid: 1, withPhone: 0, contacted: 0, conversations: 0, meetings: 0, waiting: 1 },
];

test('Administración shows the credits\' path to meetings, what each one cost, who waits and each person', () => {
  const html = renderToStaticMarkup(React.createElement(CreditResultsView, { data: { from: '2026-10-01', to: '2026-10-31', totals, people }, loading: false, error: '', single: false, onRetry: () => undefined }));
  const words = text(html);
  assert.match(words, /^Qué se obtuvo con los créditos Con 28 créditos hubo datos de 4 personas: se contactó a 3, con 2 conversaciones y 1 reunión\./);
  assert.match(words, /28 Créditos usados 4 Personas con datos 3 Contactadas 2 Conversaciones 1 Reuniones/);
  assert.match(words, /14 créditos por conversación · 28 por reunión 1 persona pagada lleva más de 7 días sin contacto\./);
  assert.match(words, /Persona Créditos Con datos Contactadas Conversaciones Reuniones Sin contacto Ana Rojas 19 3 3 2 1 0 Leo Soto 9 1 0 0 0 1/);
  assert.match(html, /aria-labelledby="credit-results-title"/);
});

test('one person shows no table, a period without credits says so, and an error offers to retry', () => {
  const single = renderToStaticMarkup(React.createElement(CreditResultsView, { data: { from: 'a', to: 'b', totals, people: [people[0]] }, loading: false, error: '', single: true, onRetry: () => undefined }));
  assert.doesNotMatch(single, /<table/);
  const empty = text(renderToStaticMarkup(React.createElement(CreditResultsView, { data: { from: 'a', to: 'b', totals: results.EMPTY_OUTCOMES, people: [] }, loading: false, error: '', single: false, onRetry: () => undefined })));
  assert.equal(empty, 'Qué se obtuvo con los créditos En este período no se usaron créditos de Apollo.');
  const failed = text(renderToStaticMarkup(React.createElement(CreditResultsView, { data: null, loading: false, error: 'No pudimos leer.', single: false, onRetry: () => undefined })));
  assert.equal(failed, 'No pudimos leer. Reintentar');
});

test('«Hoy» shows the person\'s month in one line and who still waits, or nothing without credits', () => {
  const words = text(renderToStaticMarkup(React.createElement(MyCreditResultsView, { data: { ...people[0], waiting: 4, month: 'noviembre' } })));
  assert.equal(words, 'Tus créditos de noviembre 19 créditos · 3 personas con datos · 3 contactadas · 2 conversaciones · 1 reunión 4 personas pagadas esperan tu primer contacto (más de 7 días).');
  assert.equal(renderToStaticMarkup(React.createElement(MyCreditResultsView, { data: { ...results.EMPTY_OUTCOMES, month: 'noviembre' } })), '');
});

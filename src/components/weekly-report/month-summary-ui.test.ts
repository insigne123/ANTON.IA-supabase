import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as credits from '../../lib/credit-results';
import * as summary from '../../lib/month-summary';

const require = createRequire(import.meta.url);
const compile = async (file: string) => ts.transpileModule(await readFile(new URL(file, import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const dependencies: Record<string, unknown> = {
  'next/link': ({ href, children, ...props }: any) => React.createElement('a', { href, ...props }, children),
  'lucide-react': new Proxy({}, { get: () => 'svg' }),
  '@/lib/credit-results': credits,
  '@/lib/month-summary': summary,
};
const load = (code: string) => { const exports: any = {}; new Function('require', 'exports', code)((id: string) => (id in dependencies ? dependencies[id] : require(id)), exports); return exports; };
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/<!-- -->/g, '').replace(/\s+/g, ' ').trim();

const { MonthSummary } = load(await compile('./MonthSummary.tsx'));
const base = { start: '2026-10-01', label: 'octubre', from: '2026-10-01T03:00:00.000Z', to: '2026-11-01T03:00:00.000Z' };

test('«Resumen de octubre» tells the credits, what each result cost, the opportunities and one thing to do', () => {
  const html = renderToStaticMarkup(React.createElement(MonthSummary, { month: { ...base,
    credits: { credits: 28, paid: 4, withPhone: 2, contacted: 3, conversations: 2, meetings: 1, waiting: 1 },
    opportunities: { submitted: 2, won: 1, lost: 0, wonAmounts: [{ currency: 'CLP', amount: 12_000_000 }], wonWithoutAmount: 0 } } }));
  assert.equal(text(html), 'Resumen de octubre En octubre, con 28 créditos hubo datos de 4 personas: se contactó a 3, con 2 conversaciones y 1 reunión. '
    + '14 créditos por conversación · 28 por reunión. Oportunidades: 2 presentadas y 1 ganada por $12.000.000. '
    + 'Una persona pagada lleva más de una semana sin contacto: en Administración ves quién la pidió');
  assert.match(html, /aria-labelledby="month-summary-title"/);
  assert.match(html, /href="\/dashboard\/admin\/usage"/);
});

test('a month with nothing to tell is no block', () => {
  assert.equal(renderToStaticMarkup(React.createElement(MonthSummary, { month: { ...base, credits: null, opportunities: null } })), '');
});

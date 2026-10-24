import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { workReport } from '../../lib/admin/work';

const require = createRequire(import.meta.url);
const compile = async (file: string) => ts.transpileModule(await readFile(new URL(file, import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const h = React.createElement;
const tag = (name: string) => ({ children, className, ...props }: any) => h(name, { className, ...props }, children);
const dependencies: Record<string, unknown> = {
  'next/link': ({ href, children, ...props }: any) => h('a', { href, ...props }, children),
  'lucide-react': new Proxy({}, { get: () => () => null }),
  '@/components/page-header': { PageHeader: ({ title, children }: any) => h('header', null, h('h1', null, title), children) },
  '@/components/ui/button': { Button: ({ variant, size, children, ...props }: any) => h('button', props, children) },
  '@/components/ui/card': { Card: tag('section'), CardContent: tag('div'), CardHeader: tag('div'), CardTitle: tag('div') },
  '@/components/ui/skeleton': { Skeleton: tag('div') },
  '@/components/ui/table': { Table: tag('table'), TableBody: tag('tbody'), TableCell: tag('td'), TableHead: tag('th'), TableHeader: tag('thead'), TableRow: tag('tr') },
  '@/lib/utils': { cn: (...values: unknown[]) => values.filter(Boolean).join(' ') },
};
const exports: any = {};
new Function('require', 'exports', await compile('./AdminWorkDashboard.tsx'))((id: string) => (id in dependencies ? dependencies[id] : require(id)), exports);
const { AdminWorkReport } = exports;
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/<!-- -->/g, '').replace(/\s+/g, ' ').trim();

const NOW = new Date('2026-10-24T16:00:00.000Z');
const empty = { people: [{ id: 'ana', name: 'Ana Soto' }], from: '2026-09-25', to: '2026-10-24', now: NOW, work: [], participants: [], activity: [], waiting: 0, runs: [], calls: [], callsToday: [],
  budget: { spent: 3.4, cap: 20 }, credits: { used: 120, limit: 450 } };
const render = (report: ReturnType<typeof workReport>) => renderToStaticMarkup(h(AdminWorkReport, { report: { ...report, days: 30, period: { from: '2026-09-25', to: '2026-10-24' } } }));

test('the three budgets come first, side by side, each with how much is used and what it means', () => {
  const html = render(workReport(empty));
  assert.match(text(html), /^Presupuestos Oportunidades este mes 17 % US\$3,40 de US\$20,00: búsquedas, informes y borradores de toda la empresa\. Cowork hoy 0 % Nadie lo usó hoy\./);
  assert.match(text(html), /Créditos de prospección hoy 27 % 120 de 450 créditos del equipo; se renuevan cada día\. Ver créditos/);
  assert.match(html, /role="progressbar" aria-label="Oportunidades este mes" aria-valuemin="0" aria-valuemax="20" aria-valuenow="3.4"/);
});

test('with nothing done in the period each part says so and where to go, instead of empty tables', () => {
  const words = text(render(workReport(empty)));
  assert.match(words, /Oportunidades Nadie trabajó oportunidades en el período\./);
  assert.match(words, /Cuando alguien trabaje una oportunidad, aparecerá aquí\. Ir a Oportunidades/);
  assert.match(words, /Cowork Nadie usó Cowork en el período\./);
});

test('each person with what they did, the late ones in red, and the cost of Cowork with the calls it could not price', () => {
  const html = render(workReport({ ...empty, waiting: 1,
    work: [{ opportunityId: 'o1', state: 'working', responsibleId: 'ana', deadlineAt: '2026-10-20T15:00:00Z' }],
    participants: [{ opportunityId: 'o1', userId: 'ana' }],
    activity: [{ actorId: 'ana', kind: 'state', to: 'submitted', createdAt: '2026-10-22T15:00:00Z' }],
    runs: [{ id: 'r1', userId: 'ana', rootRunId: null, createdAt: '2026-10-23T12:00:00Z' }],
    calls: [{ userId: 'ana', createdAt: '2026-10-23T12:00:10Z', costUsd: 0.05 }, { userId: 'ana', createdAt: '2026-10-23T12:00:20Z', costUsd: null }] }));
  assert.match(text(html), /1 persona trabajó oportunidades en el período\. En curso 1 Vencidas sin presentar 1 Decisiones esperando 1 Presentadas 1 Ganadas 0 Perdidas 0/);
  assert.match(html, /class="text-xl font-semibold tabular-nums text-destructive">1</);
  assert.match(text(html), /Ana Soto 1 1 1 0/);
  assert.match(text(html), /Costo estimado US\$0,05 1 llamada a la IA no tiene precio configurado: el costo real puede ser mayor\./);
});

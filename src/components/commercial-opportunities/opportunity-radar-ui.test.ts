import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as radar from '@/lib/commercial-opportunities/workspace-radar';

const require = createRequire(import.meta.url);
const compile = async (file: string) => ts.transpileModule(await readFile(new URL(file, import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const dependencies: Record<string, unknown> = {
  'lucide-react': new Proxy({}, { get: () => 'svg' }),
  '@/components/ui/button': { Button: ({ asChild, variant, size, ...props }: any) => React.createElement('button', props) },
  '@/components/ui/collapsible': { Collapsible: 'div', CollapsibleContent: 'div', CollapsibleTrigger: ({ children }: any) => children },
  '@/lib/utils': { cn: (...values: unknown[]) => values.filter(Boolean).join(' ') },
  '@/lib/commercial-opportunities/workspace-radar': radar,
  './OpportunityFilters': { filterChip: (on: boolean) => (on ? 'chip chip-on' : 'chip') },
};
const load = (code: string) => { const exports: any = {}; new Function('require', 'exports', code)((id: string) => (id in dependencies ? dependencies[id] : require(id)), exports); return exports; };
const { AdvicePill, NewsList } = load(await compile('./OpportunityRadar.tsx'));
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/<!-- -->/g, '').replace(/\s+/g, ' ').trim();
const item = { id: 'a', kind: 'tender', title: 'Guardias', company_name: null, buyer_name: 'Banco', company_domain: null, url: null, score: 80, reasons: [], deadline_at: new Date(Date.now() + 10 * 86_400_000).toISOString(),
  amount: null, currency: null, data: { evaluation: 'recommended' }, updated_at: '2026-10-16T00:00:00Z' };

test('«Postular» is advice for a decision still to take: once presented or closed, the stage next to it says where it stands', () => {
  assert.equal(text(renderToStaticMarkup(React.createElement(AdvicePill, { item }))), 'Postular');
  for (const state of ['assigned', 'working', 'blocked', 'unassigned', null, undefined]) assert.equal(text(renderToStaticMarkup(React.createElement(AdvicePill, { item, state }))), 'Postular', String(state));
  for (const state of ['submitted', 'won', 'lost', 'archived']) assert.equal(renderToStaticMarkup(React.createElement(AdvicePill, { item, state })), '', state);
});

const notice = (id: string, opportunity: string, kind: string, title: string, at = '2026-10-24T12:00:00Z') => ({ id, opportunity_id: opportunity, kind, title, created_at: at, read_at: null });
const news = (props: Record<string, unknown>) => renderToStaticMarkup(React.createElement(NewsList, { notifications: [], onOpen: () => undefined, onClear: () => undefined, when: () => 'hoy', ...props }));

test('«Novedades» puts first what waits for the administrator, until someone answers, with the way to answer it', () => {
  const waiting = { total: 4, lines: [
    { id: 'o1', title: 'Aseo Hospital Regional', detail: 'Diego pide una decisión · espera hace 3 días', urgent: true, href: '/opportunities?op=o1', kind: 'ask' },
    { id: 'o2', title: 'Guardias Puerto Montt', detail: 'Bloqueada', urgent: true, href: '/opportunities?op=o2', kind: 'blocked' },
  ] };
  const html = news({ waiting });
  const words = text(html);
  assert.match(words, /^Novedades Esperan tu respuesta · 4 Aseo Hospital Regional Diego pide una decisión · espera hace 3 días Responder Guardias Puerto Montt Bloqueada Ver/);
  assert.match(words, /Y 2 más esperan tu respuesta\./);
  assert.doesNotMatch(words, /Marcar como leídas/, 'nothing unread to clear: what waits goes away when it is answered');
  assert.equal(news({}), '', 'nothing waiting and nothing new: no box');
  const twice = text(news({ waiting, notifications: [notice('n1', 'o1', 'task', 'Decisión pedida: Aseo Hospital Regional'), notice('n2', 'o9', 'report', 'Informe listo: Casino')] }));
  assert.doesNotMatch(twice, /Decisión pedida: Aseo/, 'the decision waiting is said once, above');
  assert.match(twice, /Novedades 1 Marcar como leídas/);
});

test('each notice is cleared on its own, and the kinds show only when there is more than one', () => {
  const one = news({ notifications: [notice('n1', 'o1', 'report', 'Informe listo: Aseo'), notice('n2', 'o2', 'report', 'Informe listo: Guardias')] });
  assert.doesNotMatch(text(one), /Todas|Decisiones|Asignaciones/, 'only reports: nothing to choose');
  assert.match(one, /aria-label="Marcar como leída: Informe listo: Aseo"/);
  const mixed = news({ notifications: [notice('n1', 'o1', 'report', 'Informe listo: Aseo'), notice('n2', 'o2', 'assignment', 'Oportunidad asignada: Guardias'),
    notice('n3', 'o3', 'task', 'Decisión pedida: Casino', '2026-10-24T13:00:00Z'), notice('n4', 'o3', 'task', 'Oportunidad bloqueada: Casino', '2026-10-24T11:00:00Z')] });
  assert.match(text(mixed), /Todas Decisiones Asignaciones Informes/);
  assert.match(mixed, /aria-pressed="true"[^>]*>Todas</);
  assert.match(text(mixed), /Novedades 3 Marcar como leídas/, 'one line per opportunity');
  const { byOpportunity, kinds } = radar.latestNews([notice('n3', 'o3', 'task', 'Decisión pedida: Casino'), notice('n4', 'o3', 'task', 'Oportunidad bloqueada: Casino'), { ...notice('n5', 'o4', 'report', 'Informe listo'), read_at: '2026-10-24T14:00:00Z' }]);
  assert.deepEqual(byOpportunity.get('o3'), ['n3', 'n4'], 'clearing a line clears what is behind it');
  assert.deepEqual(kinds, ['task'], 'what was read does not count');
  assert.deepEqual(radar.latestNews([notice('n1', 'o1', 'report', 'Informe'), notice('n2', 'o2', 'assignment', 'Asignada')], 'assignment').ids, ['n2']);
});

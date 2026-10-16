import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as pipeline from '@/lib/commercial-opportunities/pipeline';

const require = createRequire(import.meta.url);
const compile = async (file: string) => ts.transpileModule(await readFile(new URL(file, import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const dependencies: Record<string, unknown> = {
  'lucide-react': new Proxy({}, { get: () => 'svg' }),
  '@/components/ui/button': { Button: ({ asChild, variant, size, ...props }: any) => React.createElement('button', props) },
  '@/components/initials-avatar': { InitialsAvatar: ({ name }: { name: string }) => React.createElement('span', { 'data-avatar': name }) },
  '@/lib/utils': { cn: (...values: unknown[]) => values.filter(Boolean).join(' ') },
  '@/lib/commercial-opportunities/pipeline': pipeline,
};
const load = (code: string) => { const exports: any = {}; new Function('require', 'exports', code)((id: string) => (id in dependencies ? dependencies[id] : require(id)), exports); return exports; };
dependencies['./PipelineRoute'] = load(await compile('./PipelineRoute.tsx'));
const { PipelineBoard } = load(await compile('./PipelineBoard.tsx'));
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/<!-- -->/g, '').replace(/\s+/g, ' ');
const soon = new Date(Date.now() + 3 * 86_400_000).toISOString();
const later = new Date(Date.now() + 30 * 86_400_000).toISOString();
const item = (id: string, title: string, evaluation: string, deadline: string | null = later) => ({ id, kind: 'tender', title, company_name: null, buyer_name: 'Municipalidad', company_domain: null, url: null, score: 80,
  reasons: [], deadline_at: deadline, amount: null, currency: null, data: { evaluation }, updated_at: '2026-10-16T00:00:00Z' });
const items = [item('a', 'Aseo hospital', 'recommended', soon), item('b', 'Guardias museo', 'recommended'), item('c', 'Traslado de obras', 'recommended'), item('d', 'Software RR.HH.', 'review')];
const work = [{ opportunity_id: 'b', revision: 4, state: 'working', team_id: null, responsible_id: 'u1', assigned_by: null, objective: '', due_at: null, updated_at: '' },
  { opportunity_id: 'c', revision: 2, state: 'submitted', team_id: null, responsible_id: null, assigned_by: null, objective: '', due_at: null, updated_at: '' }];
const render = (props: Record<string, unknown> = {}) => renderToStaticMarkup(React.createElement(PipelineBoard, { items, work, totals: { found: 40, recommended: 12 },
  members: [{ user_id: 'u1', name: 'Ana Soto' }], busy: false, suggestions: null, reviewing: false, onReview: () => {}, onMove: () => {}, onOpen: () => {}, ...props }));

test('the road has one stop per stage with its count, exact totals for what nobody works yet, and urgent closings flagged', () => {
  const html = render();
  for (const [label, count] of [['Por revisar', 40], ['Recomendadas', 12], ['Asignadas', 0], ['En preparación', 1], ['Presentadas', 1], ['Ganadas', 0]])
    assert.match(html, new RegExp(`aria-label="${label}: ${count}"`), label);
  assert.match(html, /title="1 cierran en menos de 7 días"/, 'Aseo hospital closes in 3 days');
  assert.match(html, /<nav aria-label="Etapas de las oportunidades">/);
  // The first stage with opportunities is open below: its cards, closest closing first.
  assert.match(text(html), /Por revisar 40/);
  assert.match(text(html), /Se muestra la de más puntaje\./);
});

test('the AI suggestion sits on its card with the move to apply, and the summary says how many it moves', () => {
  const html = render({ suggestions: [{ id: 'b', move: 'submitted', reason: 'La nota dice que se subió la oferta.', nextAction: 'Confirmar recepción con el comprador' }] });
  assert.match(text(html), /La IA revisó 1 oportunidad en curso: sugiere mover 1/);
  assert.match(text(html), /Revisar con IA/);
});

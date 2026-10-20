import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as pipeline from '@/lib/commercial-opportunities/pipeline';
import * as summaries from '@/lib/commercial-opportunities/summaries';

const require = createRequire(import.meta.url);
const compile = async (file: string) => ts.transpileModule(await readFile(new URL(file, import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const dependencies: Record<string, unknown> = {
  'lucide-react': new Proxy({}, { get: () => 'svg' }),
  '@/components/ui/button': { Button: ({ asChild, variant, size, ...props }: any) => React.createElement('button', props) },
  '@/components/initials-avatar': { InitialsAvatar: ({ name }: { name: string }) => React.createElement('span', { 'data-avatar': name }) },
  '@/lib/utils': { cn: (...values: unknown[]) => values.filter(Boolean).join(' ') },
  '@/lib/commercial-opportunities/pipeline': pipeline,
  '@/lib/commercial-opportunities/summaries': summaries,
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
  for (const [label, count] of [['Por revisar', 40], ['Recomendadas', 12], ['Asignadas', 0], ['En preparación', 1], ['Presentadas', 1], ['Ganadas', 0]] as const)
    assert.match(html, new RegExp(`aria-label="${label}: ${count}"`), label);
  assert.match(text(html), /Recomendadas 1 cierra en menos de 7 días/, 'Aseo hospital closes in 3 days: said in words under the stop');
  assert.doesNotMatch(html, /bg-destructive px-1/, 'no red bubble without a meaning');
  assert.match(html, /<nav aria-label="Etapas de las oportunidades">/);
  // The first stage with opportunities is open below: its cards, closest closing first.
  assert.match(text(html), /Por revisar 40/);
  assert.match(text(html), /Se muestra 1 de 40, las de más puntaje\./);
  assert.match(text(html), /Licitación Cierra en/, 'each card says where it came from');
});

test('a stage with more than the page shows loads the next page, up to the most the server gives; then the search narrows it', () => {
  const html = render({ limits: { found: 60, recommended: 60 } });
  assert.match(text(html), /Cargar 39 más Quedan 39 en esta etapa\./);
  const atMost = render({ limits: { found: 600, recommended: 60 } });
  assert.doesNotMatch(text(atMost), /Cargar \d+ más/);
  assert.match(text(atMost), /Para ver las demás, búscalas por nombre o elige una fuente\./);
});

test('what is out of the road is a click away: lost, archived and the ones the AI left out, with their counts', () => {
  const html = render({ totals: { found: 40, recommended: 12, excluded: 340 } });
  assert.match(html, /<div role="group" aria-label="Fuera del embudo"/);
  assert.match(text(html), /No recomendadas 340/);
  assert.doesNotMatch(text(html), /Perdidas|Archivadas/, 'only the ones with something');
});

test('with a search or a source on, an empty stage says the filters left it empty and offers to clear them', () => {
  const html = render({ items: [], work: [], totals: { found: 0, recommended: 0 }, filtered: true, onClearFilters: () => {} });
  assert.match(text(html), /Ninguna oportunidad de esta etapa coincide con la búsqueda o la fuente elegida\. Quitar filtros/);
  assert.match(text(render({ items: [], work: [], totals: { found: 0, recommended: 0 } })), /No hay oportunidades en esta etapa\./);
});

test('the AI suggestion sits on its card with the move to apply, and the summary says how many it moves', () => {
  const html = render({ suggestions: [{ id: 'b', move: 'submitted', reason: 'La nota dice que se subió la oferta.', nextAction: 'Confirmar recepción con el comprador' }] });
  assert.match(text(html), /La IA revisó 1 oportunidad en curso: sugiere mover 1/);
  assert.match(text(html), /Sugerir próximos pasos/);
  assert.match(html, /title="La IA revisa las 2 oportunidades en curso: propone a qué etapa moverlas y qué hacer después\. Nada cambia sin que lo aceptes\."/);
});

test('with nothing in progress there is nothing for the AI to review: no button; an empty stage stays quiet', () => {
  const html = render({ work: [] });
  assert.doesNotMatch(text(html), /Sugerir próximos pasos|Revisar con IA/);
  assert.match(html, /aria-label="Asignadas: 0" class="[^"]*bg-background text-muted-foreground ring-border/);
});

test('each card says what the opportunity is about under its name, with its buyer above and no dash when there is none', () => {
  const withSummary = [{ ...item('a', 'Aseo hospital', 'recommended', soon), data: { evaluation: 'recommended', summary: { text: 'Aseo diario de pabellones y salas del hospital regional.' } } },
    { ...item('e', 'SERVICIOS VIGILANCIA DSSA PP-65', 'recommended'), buyer_name: null }];
  const html = render({ items: withSummary, work: [] });
  assert.match(text(html), /Municipalidad Aseo hospital Aseo diario de pabellones y salas del hospital regional\./);
  assert.doesNotMatch(text(html), /—/);
  assert.doesNotMatch(html, /animate-pulse/, 'nothing is on its way');
});

test('on a phone the cards fit the screen: the column can shrink below a long buyer name, which is cut with an ellipsis', () => {
  const html = render({ items: [{ ...item('a', 'SERVICIOS DE VIGILANCIA-GUARDIAS DRT VALPARAÍSO', 'recommended', soon), buyer_name: 'CORPORACION ADMINISTRATIVA DEL PODER JUDICIAL DE LA REGION' }], work: [] });
  assert.match(html, /<ul class="grid grid-cols-1 gap-3 lg:grid-cols-2">/);
  assert.match(html, /<li class="flex min-w-0 flex-col/);
  assert.match(html, /class="truncate text-xs text-muted-foreground">CORPORACION ADMINISTRATIVA/);
});

test('while summaries are being written, the cards without one show a faint line instead of text', () => {
  const html = render({ items: [item('a', 'Aseo hospital', 'recommended', soon)], work: [], summariesWaiting: true });
  assert.match(html, /aria-hidden="true"><span class="block h-3 w-11\/12 rounded-full bg-muted motion-safe:animate-pulse"/);
  const left = render({ items: [{ ...item('a', 'Aseo hospital', 'recommended'), data: { evaluation: 'recommended', summary: { text: '' } } }], work: [], summariesWaiting: true });
  assert.doesNotMatch(left, /animate-pulse/, 'one the model left out shows no line');
});

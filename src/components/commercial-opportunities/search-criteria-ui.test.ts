import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as hiring from '../../lib/commercial-opportunities/hiring';
import * as settings from '../../lib/commercial-opportunities/search-settings';
import * as health from '../../lib/commercial-opportunities/source-health';

const require = createRequire(import.meta.url);
const compile = async (file: string) => ts.transpileModule(await readFile(new URL(file, import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const dependencies: Record<string, unknown> = {
  'next/link': ({ href, children, ...props }: any) => React.createElement('a', { href, ...props }, children),
  '@/components/ui/input': { Input: (props: any) => React.createElement('input', props) },
  '@/components/ui/label': { Label: ({ htmlFor, ...props }: any) => React.createElement('label', { htmlFor, ...props }) },
  '@/components/ui/switch': { Switch: ({ checked, onCheckedChange, ...props }: any) => React.createElement('button', { role: 'switch', 'aria-checked': checked, ...props }) },
  '@/components/ui/textarea': { Textarea: (props: any) => React.createElement('textarea', props) },
  '@/lib/utils': { cn: (...values: unknown[]) => values.filter(Boolean).join(' ') },
  '@/lib/commercial-opportunities/hiring': hiring,
  '@/lib/commercial-opportunities/search-settings': settings,
  '@/lib/commercial-opportunities/source-health': health,
  './OpportunityFilters': { filterChip: (on: boolean) => (on ? 'chip chip-on' : 'chip') },
};
const load = (code: string) => { const exports: any = {}; new Function('require', 'exports', code)((id: string) => (id in dependencies ? dependencies[id] : require(id)), exports); return exports; };
const { SearchCriteriaFields } = load(await compile('./SearchCriteriaFields.tsx'));
const { SearchHealthLine } = load(await compile('./SearchHealthLine.tsx'));
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/<!-- -->/g, '').replace(/\s+/g, ' ').trim();
const criteria = { keywords: ['aseo'], postQueries: ['"aseo industrial"'], roles: ['Jefe de Aseo'], decisionMakerTitles: ['Jefe de Compras'] };
const fields = (search: unknown = {}, change: Partial<settings.CriteriaDraft> = {}) =>
  renderToStaticMarkup(React.createElement(SearchCriteriaFields, { draft: { ...settings.criteriaDraft(criteria, search), ...change }, onChange: () => undefined }));

test('«Qué buscamos» starts with the four sources as switches, each with its label tied to it, and the tenders\' own rules', () => {
  const html = fields({ tenders: { minAmount: 5_000_000, regions: ['Biobío'] } });
  for (const source of settings.SEARCH_SOURCES) {
    assert.match(html, new RegExp(`<label for="op-source-${source}"[^>]*>${settings.SEARCH_SOURCE_LABELS[source]}</label>`));
    assert.match(html, new RegExp(`role="switch" aria-checked="true" id="op-source-${source}"`));
  }
  const words = text(html);
  assert.match(words, /^Fuentes Lo que no te sirve se apaga/);
  assert.match(words, /Licitaciones y Compra Ágil Palabras que buscamos/);
  assert.match(html, /id="op-min-amount"[^>]*value="5.000.000"/, 'the amount reads as it is written in Chile');
  assert.match(html, /aria-pressed="true" class="chip chip-on">Biobío<\/button>/, 'a chosen region is a pressed chip');
  assert.match(html, /aria-pressed="false" class="chip">Ñuble<\/button>/);
  assert.match(words, /LinkedIn Búsquedas de publicaciones .* Cargos en avisos de trabajo que revelan una necesidad .* Cargos de quienes deciden la compra/);
  assert.match(html, /<textarea id="op-criteria-postQueries"[^>]*aria-describedby="op-criteria-postQueries-hint"/, 'the hint is read with its box');
  assert.match(html, /aria-pressed="true" class="chip chip-on">Cada día<\/button>/, 'job ads every day, as before');
});

test('a source turned off takes its boxes with it: no tenders, no tender rules; no LinkedIn, no searches to write', () => {
  const noTenders = text(fields({ sources: { tenders: false, compraAgil: false } }));
  assert.doesNotMatch(noTenders, /Licitaciones y Compra Ágil|Monto mínimo|Organismos que evitamos/);
  assert.match(noTenders, /Búsquedas de publicaciones/);
  const noLinkedIn = fields({ sources: { posts: false, hiring: false } });
  assert.doesNotMatch(text(noLinkedIn), /Búsquedas de publicaciones|Cargos de quienes deciden|Cada cuánto/);
  assert.match(noLinkedIn, /role="switch" aria-checked="false" id="op-source-posts"/);
  const onlyHiring = fields({ sources: { posts: false }, hiringEvery: 'week' });
  assert.doesNotMatch(text(onlyHiring), /Búsquedas de publicaciones/);
  assert.match(onlyHiring, /aria-label="Cada cuánto buscar avisos de trabajo"/);
  assert.match(onlyHiring, /aria-pressed="true" class="chip chip-on">Los lunes<\/button>/);
});

// Saturday 24 October 2026, 12:00 in Chile.
const NOW = new Date('2026-10-24T15:00:00.000Z');
const line = (sources: health.SourceHealth[], ticket: 'own' | 'shared' = 'shared') =>
  renderToStaticMarkup(React.createElement(SearchHealthLine, { health: { sources, ticket }, now: NOW }));
const source = (value: health.SourceHealth['source'], state: health.SourceState, detail: string, at: string | null = '2026-10-24T11:03:00Z'): health.SourceHealth =>
  ({ source: value, label: { tenders: 'Licitaciones', compraAgil: 'Compra Ágil', posts: 'LinkedIn', hiring: 'Avisos de trabajo' }[value], state, at, detail, failingDays: state === 'failed' ? 2 : 0 });

test('the line under the strip says when the search last answered and, only for a source that did not, why', () => {
  const html = line([source('tenders', 'ok', 'Respondió hoy 08:03'), source('compraAgil', 'failed', 'Mercado Público no respondió · 2 días seguidos', null), source('posts', 'retrying', 'No respondió a la primera; reintentamos solos', null)]);
  assert.equal(text(html), 'Última búsqueda: hoy 08:03 Licitaciones : Respondió hoy 08:03 Compra Ágil · Mercado Público no respondió · 2 días seguidos LinkedIn · No respondió a la primera; reintentamos solos Conecta el ticket de Mercado Público de tu empresa');
  assert.match(html, /<span class="sr-only">: Respondió hoy 08:03<\/span>/, 'a source that answered says so only to a screen reader');
  assert.match(html, /class="text-destructive">Compra Ágil<\/span>/, 'a failed source reads red');
  assert.match(html, /aria-hidden="true" class="h-1.5 w-1.5 shrink-0 rounded-full bg-destructive"/);
  assert.match(html, /<a href="\/connections" class="[^"]*focus-visible:ring-2[^"]*">Conecta el ticket/, 'the ticket is connected in «Conexiones»');
});

test('the line stays quiet before any search, and offers the ticket only for tenders on the shared one', () => {
  assert.equal(line([]), '');
  assert.doesNotMatch(line([source('tenders', 'ok', 'Respondió hoy 08:03')], 'own'), /Conecta el ticket/);
  assert.doesNotMatch(line([source('posts', 'failed', 'La búsqueda no terminó')], 'shared'), /Conecta el ticket/, 'no tenders, no ticket');
  assert.match(text(line([source('posts', 'searching', 'Buscando ahora', null)])), /^LinkedIn · Buscando ahora$/, 'nothing answered yet: no «Última búsqueda»');
});

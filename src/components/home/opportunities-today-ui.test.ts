import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const compile = async (file: string) => ts.transpileModule(await readFile(new URL(file, import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const dependencies: Record<string, unknown> = {
  'next/link': ({ href, children, ...props }: any) => React.createElement('a', { href, ...props }, children),
  'lucide-react': new Proxy({}, { get: () => 'svg' }),
  '@/components/ui/button': { Button: ({ asChild, variant, size, children, ...props }: any) => (asChild ? children : React.createElement('button', props, children)) },
  '@/components/ui/card': { Card: 'div', CardContent: 'div', CardHeader: 'div' },
  '@/lib/utils': { cn: (...values: unknown[]) => values.filter(Boolean).join(' ') },
  './usePersonalHome': { usePersonalHome: () => ({ data: null, loading: true, error: false, load: () => undefined }) },
};
const load = (code: string) => { const exports: any = {}; new Function('require', 'exports', code)((id: string) => (id in dependencies ? dependencies[id] : require(id)), exports); return exports; };
const { OpportunitiesToday } = load(await compile('./OpportunitiesTodayCard.tsx'));
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/<!-- -->/g, '').replace(/\s+/g, ' ').trim();
const line = (id: string, title: string, detail: string, urgent = false) => ({ id, title, detail, urgent, href: `/opportunities?op=${id}` });
const empty = { total: 0, lines: [] };
const card = (data: unknown, error = false) => renderToStaticMarkup(React.createElement(OpportunitiesToday, { data, error, onRetry: () => undefined }));

test('«Oportunidades» in «Hoy» says what waits, the ones you work, the reports and what closes with no team, each one a link', () => {
  const html = card({ access: true, admin: true, empty: false,
    waiting: { total: 4, lines: [line('a', 'Aseo Hospital Regional', 'Diego pide una decisión · espera hace 3 días', true)] },
    mine: { total: 1, lines: [line('b', 'Guardias Puerto Montt', 'Cierra el viernes')] },
    reports: { total: 1, lines: [line('c', 'Casino Minera', 'El informe está listo')] },
    closing: { total: 2, lines: [line('d', 'Compra Ágil Maipú', 'Cierra mañana · sin equipo', true)], href: '/opportunities?vista=lista&orden=deadline' } });
  const words = text(html);
  assert.match(words, /^Oportunidades Abrir Esperan tu respuesta · 4 Aseo Hospital Regional Diego pide una decisión · espera hace 3 días Ver las 4 Las que trabajas · 1 Guardias Puerto Montt Cierra el viernes/);
  assert.match(words, /Informes listos · 1 Casino Minera El informe está listo Cierran esta semana y nadie las trabaja · 2 Compra Ágil Maipú Cierra mañana · sin equipo Ver las 2, por fecha de cierre$/);
  assert.match(html, /href="\/opportunities\?op=a"/);
  assert.match(html, /href="\/opportunities\?vista=lista&amp;orden=deadline"/);
  assert.match(html, /<h2 id="opportunities-today-title"[^>]*>Oportunidades<\/h2>/);
  assert.match(html, /class="block text-xs text-destructive">Diego pide/, 'what is urgent reads red');
});

test('whoever asked a decision reads it waiting; with nothing to act on, or no access, there is no card', () => {
  const asked = text(card({ access: true, admin: false, empty: false, waiting: { total: 1, lines: [line('a', 'Aseo', 'Pediste una decisión · esperando respuesta desde ayer')] },
    mine: empty, reports: empty, closing: { ...empty, href: '/x' } }));
  assert.match(asked, /Esperando respuesta · 1 Aseo Pediste una decisión · esperando respuesta desde ayer/);
  assert.doesNotMatch(asked, /Ver las|Las que trabajas|Informes listos|Cierran esta semana/);
  assert.equal(card({ access: true, admin: false, empty: true, waiting: empty, mine: empty, reports: empty, closing: { ...empty, href: '/x' } }), '');
  assert.equal(card({ access: false }), '');
  assert.equal(card(null), '', 'while it loads it holds no place');
  assert.match(text(card(null, true)), /No pudimos leer tus oportunidades\. Reintentar/);
});

test('«Hoy» shows it right under the pending work, before calls and LinkedIn', () => {
  const page = readFileSync('src/app/(app)/dashboard/page.tsx', 'utf8');
  const today = page.indexOf('<TodayPanel'), opportunities = page.indexOf('<OpportunitiesTodayCard />'), touches = page.indexOf('<TouchesCard />');
  assert.ok(today > 0 && today < opportunities && opportunities < touches);
});

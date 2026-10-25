import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import * as presentation from '@/lib/cowork/presentation';
import type { CoworkThreadSummary } from '@/lib/cowork/presentation';

const require = createRequire(import.meta.url);
const source = await readFile(new URL('./CoworkThreadList.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
} }).outputText;
const dependencies: Record<string, unknown> = {
  'lucide-react': new Proxy({}, { get: () => 'svg' }),
  '@/lib/cowork/presentation': presentation,
  '@/lib/utils': { cn: (...values: unknown[]) => values.filter(Boolean).join(' ') },
  '@/components/ui/dropdown-menu': new Proxy({}, { get: () => ({ children }: { children?: React.ReactNode }) => children ?? null }),
  './ui': {
    CwButton: ({ variant: _variant, size: _size, ...props }: Record<string, unknown>) => React.createElement('button', { type: 'button', ...props }),
    CwStatusDot: () => null,
  },
  './CoworkMemories': { CoworkMemories: () => null },
};
const exports: any = {};
new Function('require', 'exports', code)((id: string) => id in dependencies ? dependencies[id] : require(id), exports);
const { CoworkThreadList } = exports as { CoworkThreadList: React.ComponentType<Record<string, unknown>> };

const thread = (index: number): CoworkThreadSummary => ({
  id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  rootId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  title: `Correos para clientes ${index}`, status: 'completed', updatedAt: new Date().toISOString(), turns: 1,
});
const base = { threads: [], loading: false, selectedThreadId: null, onSelect: () => {}, onNew: () => {}, onClose: () => {} };
const render = (props: Record<string, unknown>) => renderToStaticMarkup(React.createElement(CoworkThreadList, { ...base, ...props }));

test('a list that could not be read says so, with «Reintentar», instead of looking empty', () => {
  const failed = render({ error: 'No se pudo completar la solicitud.', onRetry: () => {} });
  assert.match(failed, /No pudimos cargar tus conversaciones\./);
  assert.match(failed, />Reintentar<\/button>/);
  assert.doesNotMatch(failed, /Aún no tienes conversaciones/);
  // While it retries, it shows the loading line, not the failure.
  assert.match(render({ error: 'x', loading: true }), /Cargando conversaciones…/);
  assert.doesNotMatch(render({ error: 'x', loading: true }), /No pudimos cargar/);
  // The threads it already had stay; the notice above the conversation tells the failure.
  assert.doesNotMatch(render({ error: 'x', threads: [thread(1)] }), /No pudimos cargar/);
});

test('without work yet the list explains what will appear', () => {
  const empty = render({});
  assert.match(empty, /Aún no tienes conversaciones/);
  assert.match(empty, /Lo que le pidas a Cowork queda aquí para retomarlo\./);
  assert.doesNotMatch(empty, /No pudimos cargar|Reintentar/);
});

test('in a sheet it closes with an X; as the side rail it folds away', () => {
  assert.match(render({ closeStyle: 'dismiss' }), /aria-label="Cerrar conversaciones"/);
  assert.doesNotMatch(render({ closeStyle: 'dismiss' }), /Ocultar conversaciones/);
  assert.match(render({}), /aria-label="Ocultar conversaciones"/);
});

test('a search with no match says so and clears in one click', async () => {
  const dom = new JSDOM('<div id="root"></div>');
  const previous = { window: globalThis.window, document: globalThis.document };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  // Loaded once the DOM exists, so React listens to real input events.
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(dom.window.document.getElementById('root')!);
  try {
    await act(async () => root.render(React.createElement(CoworkThreadList, { ...base, threads: Array.from({ length: 7 }, (_, index) => thread(index + 1)) })));
    const input = dom.window.document.querySelector<HTMLInputElement>('#cowork-rail-filter')!;
    const type = async (value: string) => act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
    await type('licitaciones');
    const text = () => dom.window.document.body.textContent || '';
    assert.match(text(), /Ninguna conversación coincide con «licitaciones»\./);
    assert.doesNotMatch(text(), /Correos para clientes/);
    const clear = Array.from(dom.window.document.querySelectorAll('button')).find(button => button.textContent === 'Limpiar búsqueda')!;
    await act(async () => clear.click());
    assert.equal(input.value, '');
    assert.match(text(), /Correos para clientes 7/);
    assert.doesNotMatch(text(), /Ninguna conversación coincide/);
  } finally {
    await act(async () => root.unmount());
    Object.assign(globalThis, previous);
  }
});

test('«Atajos de teclado» sits at the foot of the list on a desktop, when the workspace offers it (Plan 13)', () => {
  const opened: string[] = [];
  const html = render({ onShortcuts: () => opened.push('atajos') });
  assert.match(html, /aria-label="Atajos de teclado"/);
  assert.match(html, /hidden shrink-0 lg:inline-flex/, 'only where there is a keyboard');
  assert.doesNotMatch(render({}), /Atajos de teclado/);
});

test('«Memoria» (what Cowork remembers) is always at the foot of the list, also with no conversations, short enough to sit beside the icons', () => {
  for (const html of [render({}), render({ threads: [thread(1)] })]) {
    assert.match(html, /<span class="min-w-0 truncate">Memoria<\/span>/);
    assert.match(html, /title="Lo que Cowork recuerda"/, 'the long name stays as the tooltip; the dialog is titled with it');
  }
});

test('«Tareas programadas» sits at the foot of the list only where the account has them, by name, with how many and the next one', () => {
  const none = render({ onSchedules: () => {} });
  assert.match(none, /aria-label="Tareas programadas"/);
  assert.match(none, />Programadas</, 'a word, not only an icon (COW-19)');
  assert.doesNotMatch(render({}), /Tareas programadas|Programadas/);
  const two = render({ onSchedules: () => {}, schedules: { active: 2, next: 'lunes 26 de octubre, 09:00' } });
  assert.match(two, /aria-label="Tareas programadas: 2 activas, la próxima lunes 26 de octubre, 09:00"/);
  assert.match(two, /title="Próxima: lunes 26 de octubre, 09:00"/);
  assert.match(two, />2<\/span>/);
});

test('a conversation waiting for approval says «Aprobar» in words; the time goes to the tooltip so the title has the room', () => {
  const waiting = { ...thread(1), status: 'waiting_approval' as const };
  const html = render({ threads: [waiting, thread(2)] });
  assert.match(html, />Aprobar<span class="sr-only">: Necesita tu aprobación<\/span>/);
  assert.match(html, /title="Correos para clientes 2 · [^"]+"/, 'the time is still there, on hover');
  assert.equal((html.match(/Aprobar/g) || []).length, 1, 'only the one that waits');
});

test('every conversation that waits for approval goes first, under its own heading with how many, however old (COW-16)', () => {
  const old = new Date(Date.now() - 20 * 86_400_000).toISOString();
  const html = render({ threads: [thread(1), { ...thread(2), status: 'waiting_approval' as const, updatedAt: old }, { ...thread(3), status: 'waiting_approval' as const }] });
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  assert.match(text, /^.*Esperan tu aprobación · 2 Correos para clientes 2 .*Correos para clientes 3 .*Hoy Correos para clientes 1/);
  assert.doesNotMatch(render({ threads: [thread(1)] }), /Esperan tu aprobación/, 'no heading when nothing waits');
});

test('pinned conversations stay on top under what waits, in the order they were pinned, and the menu pins or unpins (COW-12)', () => {
  const old = new Date(Date.now() - 40 * 86_400_000).toISOString();
  const threads = [thread(1), { ...thread(2), updatedAt: old }, thread(3), { ...thread(4), status: 'waiting_approval' as const }];
  const html = render({ threads, pinnedRootIds: [thread(3).rootId, thread(2).rootId], onPin: () => {}, onRename: async () => true });
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  assert.match(text, /Esperan tu aprobación · 1 Correos para clientes 4 .*Fijadas Correos para clientes 3 .*Correos para clientes 2 .*Hoy Correos para clientes 1/);
  assert.match(text, /Quitar de fijadas/, 'a pinned one offers to unpin');
  assert.match(text, /Fijar arriba/, 'the others offer to pin');
  assert.doesNotMatch(render({ threads, pinnedRootIds: [] }), /Fijadas/, 'no pins, no group');
  assert.doesNotMatch(render({ threads, onRename: async () => true }), /Fijar arriba/, 'without pins on the server, no menu item');
});

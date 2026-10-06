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

test('«Lo que Cowork recuerda» is always at the foot of the list, also with no conversations', () => {
  assert.match(render({}), /Lo que Cowork recuerda/);
  assert.match(render({ threads: [thread(1)] }), /Lo que Cowork recuerda/);
});

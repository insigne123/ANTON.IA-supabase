import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import * as searchProposal from '@/lib/cowork/search-proposal';

// «Editar criterios» of a search Cowork proposes (COW-29).
const require = createRequire(import.meta.url);
const source = await readFile(new URL('./SearchCriteriaEditor.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
} }).outputText;

const h = React.createElement;
const dependencies: Record<string, unknown> = {
  '@/lib/cowork/search-proposal': searchProposal,
  '@/lib/utils': { cn: (...values: unknown[]) => values.filter(Boolean).join(' ') },
  './ReviewParts': { ReviewError: ({ message }: { message: string }) => h('p', { role: 'alert' }, message) },
  './ui': { CwButton: ({ variant: _variant, size: _size, type = 'button', ...props }: Record<string, unknown>) => h('button', { type, ...props }) },
};
const exports: any = {};
new Function('require', 'exports', code)((id: string) => id in dependencies ? dependencies[id] : require(id), exports);
const { SearchCriteriaEditor, coworkTermsFromText } = exports as {
  SearchCriteriaEditor: React.ComponentType<Record<string, unknown>>; coworkTermsFromText: (text: string) => string[];
};

const RUN = '00000000-0000-4000-8000-000000000003';
async function mount(criteria: Record<string, unknown>, respond: () => { status?: number; body: unknown }) {
  const dom = new JSDOM('<div id="root"></div>');
  const previous = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch };
  const calls: Array<{ url: string; method: string; body: any }> = [];
  const saved: unknown[] = [];
  Object.assign(globalThis, {
    window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (url: string, init: RequestInit = {}) => {
      calls.push({ url, method: init.method || 'GET', body: init.body ? JSON.parse(String(init.body)) : undefined });
      const answer = respond();
      return { ok: (answer.status ?? 200) < 400, status: answer.status ?? 200, json: async () => answer.body };
    },
  });
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(dom.window.document.getElementById('root')!);
  await act(async () => root.render(h(SearchCriteriaEditor, { runId: RUN, criteria, onSaved: (next: unknown) => saved.push(next), onCancel: () => saved.push('cancel') })));
  const doc = dom.window.document;
  const field = (label: string) => doc.getElementById(Array.from(doc.querySelectorAll('label')).find(item => item.textContent === label)!.htmlFor) as HTMLInputElement;
  const type = async (element: HTMLInputElement, value: string) => act(async () => {
    const prototype = element instanceof dom.window.HTMLTextAreaElement ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
  const button = (label: string) => Array.from(doc.querySelectorAll('button')).find(item => item.textContent === label)!;
  const done = async () => { await act(async () => root.unmount()); Object.assign(globalThis, previous); };
  return { doc, field, type, button, calls, saved, done };
}

const people = { target: 'people', titles: ['Gerente de Personas'], industries: ['Retail'], locations: ['Santiago, Chile'], limit: 25 };

test('the card’s criteria, as text to change; saving sends the four fields and hands back what was saved', async () => {
  const view = await mount(people, () => ({ body: { changed: true, criteria: { ...people, limit: 10 } } }));
  try {
    assert.equal(view.field('Cargos (y parecidos)').value, 'Gerente de Personas', 'with sectors it searches companies first');
    assert.equal(view.field('Rubros de las empresas').value, 'Retail');
    assert.equal(view.field('Ubicación de la persona').value, 'Santiago, Chile');
    await view.type(view.field('Cargos (y parecidos)'), 'Jefe de Selección\n  Gerente de Personas \n');
    await view.type(view.field('Cantidad'), '10');
    await act(async () => view.button('Guardar cambios').click());
    assert.deepEqual(view.calls, [{ url: `/api/cowork/runs/${RUN}/search-approval`, method: 'PATCH',
      body: { titles: ['Jefe de Selección', 'Gerente de Personas'], industries: ['Retail'], locations: ['Santiago, Chile'], limit: 10 } }]);
    assert.deepEqual(view.saved, [{ ...people, limit: 10 }]);
  } finally { await view.done(); }
});

test('how many stays between 1 and 100, and a refusal is said in the card', async () => {
  const view = await mount(people, () => ({ status: 400, body: { error: 'Deja al menos un cargo, un sector o una ubicación.' } }));
  try {
    await view.type(view.field('Cantidad'), '500');
    assert.equal(view.doc.querySelector('[role="alert"]')?.textContent, 'Elige entre 1 y 100.');
    assert.equal(view.button('Guardar cambios').disabled, true);
    await view.type(view.field('Cantidad'), '20');
    await act(async () => view.button('Guardar cambios').click());
    assert.equal(view.doc.querySelector('[role="alert"]')?.textContent, 'Deja al menos un cargo, un sector o una ubicación.');
    assert.deepEqual(view.saved, []);
    await act(async () => view.button('Cancelar').click());
    assert.deepEqual(view.saved, ['cancel']);
  } finally { await view.done(); }
});

test('a search of companies edits sectors and where the companies are, not people’s cargos', async () => {
  const view = await mount({ target: 'companies', titles: [], industries: ['Minería'], locations: [], companyLocations: ['Chile'], limit: 30 }, () => ({ body: { changed: false } }));
  try {
    assert.equal(view.doc.body.textContent?.includes('Cargos'), false);
    assert.equal(view.field('Ubicación de las empresas').value, 'Chile');
    await act(async () => view.button('Guardar cambios').click());
    assert.deepEqual(view.calls[0].body, { industries: ['Minería'], companyLocations: ['Chile'], limit: 30 });
  } finally { await view.done(); }
  assert.deepEqual(coworkTermsFromText('a\nb\n\n Antofagasta, Chile \nd\ne\nf'), ['a', 'b', 'Antofagasta, Chile', 'd', 'e']);
});

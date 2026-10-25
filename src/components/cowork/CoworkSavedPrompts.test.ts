import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import * as savedPrompts from '@/lib/cowork/saved-prompts';

// «Pedidos guardados» (COW-06): the dialog that keeps the request in the box and lists the saved ones.
const require = createRequire(import.meta.url);
const source = await readFile(new URL('./CoworkSavedPrompts.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
} }).outputText;

const h = React.createElement;
const pass = (tag: string) => ({ children, ...props }: Record<string, unknown>) => h(tag, props.className ? { className: props.className } : {}, children as React.ReactNode);
const dependencies: Record<string, unknown> = {
  'lucide-react': new Proxy({}, { get: () => () => null }),
  '@/lib/cowork/saved-prompts': savedPrompts,
  '@/lib/utils': { cn: (...values: unknown[]) => values.filter(Boolean).join(' ') },
  '@/components/ui/dialog': {
    Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? h('div', null, children) : null,
    DialogContent: ({ children }: { children: React.ReactNode }) => h('div', { role: 'dialog' }, children),
    DialogTitle: pass('h2'), DialogDescription: pass('p'),
  },
  './ui': { CwButton: ({ variant: _variant, size: _size, ...props }: Record<string, unknown>) => h('button', { type: 'button', ...props }) },
};
const exports: any = {};
new Function('require', 'exports', code)((id: string) => id in dependencies ? dependencies[id] : require(id), exports);
const { CoworkSavedPrompts } = exports as { CoworkSavedPrompts: React.ComponentType<Record<string, unknown>> };

const saved = (n: number, over: Partial<savedPrompts.CoworkSavedPrompt> = {}): savedPrompts.CoworkSavedPrompt => ({
  id: `00000000-0000-4000-8000-00000000010${n}`, title: `Pedido ${n}`, prompt: `Texto del pedido ${n}`, shared: false, mine: true, canDelete: true, ...over,
});

type Call = { url: string; method: string; body: any };
async function mount(props: { draft: string; prompts: savedPrompts.CoworkSavedPrompt[] }, respond: (call: Call) => { status?: number; body: unknown } = () => ({ body: {} })) {
  const dom = new JSDOM('<div id="root"></div>');
  const previous = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch };
  const calls: Call[] = [];
  let changed = 0;
  Object.assign(globalThis, {
    window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (url: string, init: RequestInit = {}) => {
      const call = { url, method: init.method || 'GET', body: init.body ? JSON.parse(String(init.body)) : undefined };
      calls.push(call);
      const answer = respond(call);
      return { ok: (answer.status ?? 200) < 400, status: answer.status ?? 200, json: async () => answer.body };
    },
  });
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(dom.window.document.getElementById('root')!);
  await act(async () => root.render(h(CoworkSavedPrompts, { open: true, onOpenChange: () => {}, onChanged: () => { changed += 1; }, ...props })));
  const doc = dom.window.document;
  const text = () => doc.body.textContent || '';
  const button = (label: string | RegExp) => Array.from(doc.querySelectorAll('button')).find(item => typeof label === 'string' ? (item.textContent === label || item.getAttribute('aria-label') === label) : label.test(item.textContent || ''))!;
  const type = async (element: Element, value: string) => act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
  const done = async () => { await act(async () => root.unmount()); Object.assign(globalThis, previous); };
  return { doc, text, button, type, calls, changed: () => changed, done };
}

const REQUEST = 'Busca 10 gerentes de personas en empresas de seguridad privada de Santiago y prepara un correo';

test('with a request in the box: one primary action that saves it with the name and sharing chosen, then the list with the confirmation', async () => {
  const view = await mount({ draft: `  ${REQUEST}  `, prompts: [] }, () => ({ status: 201, body: { prompt: { title: 'Seguridad privada' }, created: true } }));
  try {
    assert.match(view.text(), /Guardar este pedido/);
    assert.match(view.text(), /Todavía no hay pedidos guardados/);
    const name = view.doc.querySelector('input:not([type])')!;
    assert.equal(name.getAttribute('placeholder'), 'Busca 10 gerentes de personas en empresas de seguridad…', 'the name it gets when none is given');
    await view.type(name, 'Seguridad privada');
    await act(async () => { (view.doc.querySelector('input[type="checkbox"]') as HTMLInputElement).click(); });
    await act(async () => view.button('Guardar pedido').click());
    assert.deepEqual(view.calls.map(call => [call.method, call.url]), [['POST', '/api/cowork/prompts']]);
    assert.deepEqual(view.calls[0].body, { prompt: REQUEST, title: 'Seguridad privada', shared: true });
    assert.equal(view.changed(), 1);
    assert.match(view.text(), /Guardaste «Seguridad privada»\. Escribe «\/» para usarlo\./);
    assert.equal(view.button('Guardar pedido'), undefined, 'the form gives way to the list');
  } finally { await view.done(); }
});

test('a refusal is said where the form is and nothing changes', async () => {
  const view = await mount({ draft: REQUEST, prompts: [] }, () => ({ status: 409, body: { error: 'Ya tienes 30 pedidos guardados. Borra uno para guardar otro.' } }));
  try {
    await act(async () => view.button('Guardar pedido').click());
    assert.equal(view.doc.querySelector('[role="alert"]')?.textContent, 'Ya tienes 30 pedidos guardados. Borra uno para guardar otro.');
    assert.equal(view.changed(), 0);
    assert.ok(view.button('Guardar pedido'), 'the form stays to try again');
  } finally { await view.done(); }
});

test('without a request it only lists: one’s own and the team’s, and deleting asks first', async () => {
  const prompts = [saved(1, { shared: true }), saved(2, { mine: false, shared: true, canDelete: false, title: 'Del equipo' })];
  const view = await mount({ draft: '', prompts }, () => ({ body: { deleted: true } }));
  try {
    assert.match(view.text(), /Pedidos guardados/);
    assert.equal(view.button('Guardar pedido'), undefined);
    assert.match(view.text(), /Tuyos.*Pedido 1.*Compartido con tu equipo/);
    assert.match(view.text(), /De tu equipo.*Del equipo/);
    assert.match(view.text(), /los borra quien los guardó o un administrador/);
    assert.equal(view.button('Borrar «Del equipo»'), undefined, 'a teammate’s cannot be deleted by a member');
    await act(async () => view.button('Borrar «Pedido 1»').click());
    assert.equal(view.calls.length, 0, 'it asks first');
    await act(async () => view.button('Sí, borrar').click());
    assert.deepEqual(view.calls.map(call => [call.method, call.url]), [['DELETE', `/api/cowork/prompts/${saved(1).id}`]]);
    assert.equal(view.changed(), 1);
    assert.match(view.text(), /Borraste «Pedido 1»\./);
  } finally { await view.done(); }
});

test('«/» offers the saved requests first, by name or text and without accents, saying whose they are', () => {
  const prompts = [saved(1, { title: 'Seguimiento de retail', prompt: 'Revisa quién no respondió en minería' }), saved(2, { mine: false, title: 'Informe del lunes' })];
  assert.deepEqual(savedPrompts.coworkSavedTemplates(prompts, '').map(item => [item.title, item.note, item.icon]),
    [['Seguimiento de retail', 'Guardado', 'bookmark'], ['Informe del lunes', 'De tu equipo', 'bookmark']]);
  assert.deepEqual(savedPrompts.coworkSavedTemplates(prompts, 'MINERIA').map(item => item.title), ['Seguimiento de retail']);
  assert.deepEqual(savedPrompts.coworkSavedTemplates(prompts, 'zzz'), []);
  assert.equal(savedPrompts.coworkPromptTitle('Corto', '  Mi   nombre  '), 'Mi nombre');
  assert.equal(savedPrompts.coworkPromptTitle('Un pedido corto'), 'Un pedido corto');
});

test('the table: each person reads their own and what was shared in their organization, and only the server writes', async () => {
  const sql = await readFile(new URL('../../../supabase/migrations/20261025020000_cowork_prompts.sql', import.meta.url), 'utf8');
  assert.match(sql, /alter table public\.cowork_prompts enable row level security;/);
  assert.match(sql, /revoke all on public\.cowork_prompts from public, anon, authenticated;/);
  assert.match(sql, /grant select on public\.cowork_prompts to authenticated;/);
  assert.match(sql, /using \(\(user_id = \(select auth\.uid\(\)\) or shared\) and public\.cowork_has_access\(organization_id\)\);/);
  assert.doesNotMatch(sql, /grant (insert|update|delete|all)[^;]*to authenticated/);
});

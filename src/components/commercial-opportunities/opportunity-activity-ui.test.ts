import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import React, { act, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import * as notes from '@/lib/commercial-opportunities/activity-notes';

// «Actividad» (OPP-28): notes that name people with «@», and one's own notes corrected or deleted.
const require = createRequire(import.meta.url);
const h = React.createElement;
// The box of the design system, as a plain textarea that keeps its ref (the suggestions put the caret after the name).
const Textarea = React.forwardRef((props: any, ref) => h('textarea', { ...props, ref }));
Textarea.displayName = 'Textarea';
const dependencies: Record<string, unknown> = {
  'lucide-react': new Proxy({}, { get: () => () => null }),
  '@/lib/utils': { cn: (...values: unknown[]) => values.filter(Boolean).join(' ') },
  '@/lib/commercial-opportunities/activity-notes': notes,
  '@/components/ui/button': { Button: ({ variant, size: _size, ...props }: any) => h('button', { ...props, 'data-variant': variant ?? 'default' }) },
  '@/components/ui/label': { Label: ({ children, htmlFor }: any) => h('label', { htmlFor }, children) },
  '@/components/ui/textarea': { Textarea },
  '@/components/initials-avatar': { InitialsAvatar: () => h('span', { 'aria-hidden': true }) },
  '@/components/ui/dropdown-menu': {
    DropdownMenu: ({ children }: any) => h(React.Fragment, null, children), DropdownMenuTrigger: ({ children }: any) => children,
    DropdownMenuContent: ({ children }: any) => h('div', { role: 'menu' }, children),
    DropdownMenuItem: ({ children, onSelect }: any) => h('button', { type: 'button', role: 'menuitem', onClick: () => onSelect?.() }, children),
  },
};
async function load(file: string) {
  const code = ts.transpileModule(await readFile(new URL(file, import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const exports: any = {};
  new Function('require', 'exports', code)((id: string) => (id in dependencies ? dependencies[id] : require(id)), exports);
  return exports;
}
dependencies['./MentionTextarea'] = await load('./MentionTextarea.tsx');
const { OpportunityActivity } = await load('./OpportunityActivity.tsx');

const MEMBERS = [{ user_id: 'diego', name: 'Diego Fuentes' }, { user_id: 'maria', name: 'María José Pérez' }, { user_id: 'camila', name: 'Camila Torres' }];
const ACTIVITY = [
  { id: 'n1', actor_id: 'diego', kind: 'note', body: 'Enviamos las consultas, @María José Pérez revisa la respuesta.', created_at: '2026-10-24T12:00:00.000Z', data: { mentions: ['maria'], editedAt: '2026-10-24T13:00:00.000Z' } },
  { id: 'n2', actor_id: 'maria', kind: 'note', body: 'Listo el anexo.', created_at: '2026-10-23T12:00:00.000Z', data: {} },
  { id: 's1', actor_id: 'diego', kind: 'state', body: 'Estado: presentada', created_at: '2026-10-22T12:00:00.000Z', data: {} },
  { id: 'a1', actor_id: null, kind: 'created', body: 'Oportunidad encontrada por la búsqueda diaria', created_at: '2026-10-20T12:00:00.000Z', data: {} },
];
const props = (extra: Record<string, unknown> = {}) => ({ activity: ACTIVITY, members: MEMBERS, mentionable: MEMBERS, userId: 'diego', busy: false, when: (at: string) => at.slice(0, 10),
  note: '', onNote: () => {}, onAdd: async () => true, onEdit: async () => true, onDelete: () => {}, ...extra });
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

test('the names a note gives stand out, an edited one says so, and only one\'s own notes have their menu', () => {
  const html = renderToStaticMarkup(h(OpportunityActivity, props()));
  assert.match(html, /<span class="font-medium text-primary">@María José Pérez<\/span>/);
  assert.match(text(html), /Diego Fuentes · 2026-10-24 · editada/);
  assert.match(text(html), /El sistema · 2026-10-20/);
  assert.equal(html.match(/aria-label="Opciones de tu nota"/g)?.length, 1, 'Diego\'s note, not María\'s nor the stage he moved');
  assert.match(text(html), /Escribe @ y el nombre para avisarle a alguien del equipo\./);
});

async function mount(extra: Record<string, unknown>) {
  const dom = new JSDOM('<div id="root"></div>');
  const previous = { window: globalThis.window, document: globalThis.document, requestAnimationFrame: (globalThis as any).requestAnimationFrame };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true, requestAnimationFrame: (run: () => void) => setTimeout(run, 0) });
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(dom.window.document.getElementById('root')!);
  // The page keeps the note being written.
  function Page() { const [note, setNote] = useState(''); return h(OpportunityActivity, props({ note, onNote: setNote, ...extra })); }
  await act(async () => root.render(h(Page)));
  const doc = dom.window.document;
  const type = (field: HTMLTextAreaElement, value: string) => act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
  const key = (field: Element, name: string) => act(async () => { field.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: name, bubbles: true })); });
  const click = (element: Element) => act(async () => { element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  const submit = (form: Element) => act(async () => { form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); });
  const done = async () => { await act(async () => root.unmount()); Object.assign(globalThis, previous); };
  return { doc, type, key, click, submit, done };
}

test('typing «@» suggests the people who can read it, the arrows choose and Enter puts the whole name; the note goes out with it', async () => {
  const added: string[] = [];
  const view = await mount({ onAdd: async (value: string) => { added.push(value); return true; } });
  try {
    const box = view.doc.getElementById('op-note') as HTMLTextAreaElement;
    await view.type(box, 'Hola @');
    assert.deepEqual([...view.doc.querySelectorAll('[role="option"]')].map(item => item.textContent), ['Diego Fuentes', 'María José Pérez', 'Camila Torres']);
    assert.equal(box.getAttribute('aria-expanded'), 'true');
    await view.type(box, 'Hola @mar');
    assert.deepEqual([...view.doc.querySelectorAll('[role="option"]')].map(item => item.textContent), ['María José Pérez']);
    await view.key(box, 'Enter');
    assert.equal(box.value, 'Hola @María José Pérez ');
    assert.equal(view.doc.querySelector('[role="listbox"]'), null, 'chosen: the list closes');
    await view.type(box, 'Hola @María José Pérez revisa. @c');
    await view.key(box, 'Escape');
    assert.equal(view.doc.querySelector('[role="listbox"]'), null, 'Escape closes it without choosing');
    await view.submit(view.doc.querySelector('form')!);
    assert.deepEqual(added, ['Hola @María José Pérez revisa. @c']);
    assert.equal(box.value, '', 'saved: the box is empty again');
  } finally { await view.done(); }
});

test('whoever wrote a note corrects it in place or deletes it from its menu', async () => {
  const edits: unknown[] = []; const deleted: string[] = [];
  const view = await mount({ onEdit: async (id: string, value: string) => { edits.push([id, value]); return true; }, onDelete: (row: { id: string }) => deleted.push(row.id) });
  try {
    await view.click([...view.doc.querySelectorAll('[role="menuitem"]')].find(item => item.textContent === 'Editar')!);
    const box = view.doc.querySelector('[aria-label="Editar la nota"]') as HTMLTextAreaElement;
    assert.equal(box.value, ACTIVITY[0].body);
    await view.type(box, 'Enviamos las consultas el lunes.');
    await view.submit(box.closest('form')!);
    assert.deepEqual(edits, [['n1', 'Enviamos las consultas el lunes.']]);
    assert.equal(view.doc.querySelector('[aria-label="Editar la nota"]'), null, 'saved: back to the note');
    await view.click([...view.doc.querySelectorAll('[role="menuitem"]')].find(item => item.textContent === 'Eliminar')!);
    assert.deepEqual(deleted, ['n1']);
  } finally { await view.done(); }
});

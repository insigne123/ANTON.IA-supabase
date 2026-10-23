import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';

const require = createRequire(import.meta.url);
const source = await readFile(new URL('./CloseReasonDialog.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;

const h = React.createElement;
const pass = (tag: string) => ({ children, ...props }: Record<string, unknown>) => h(tag, props.htmlFor ? { htmlFor: props.htmlFor } : {}, children as React.ReactNode);
const dependencies: Record<string, unknown> = {
  'lucide-react': new Proxy({}, { get: () => () => null }),
  '@/components/ui/button': { Button: ({ variant: _variant, size: _size, ...props }: Record<string, unknown>) => h('button', props) },
  '@/components/ui/textarea': { Textarea: (props: Record<string, unknown>) => h('textarea', props) },
  '@/components/ui/label': { Label: pass('label') },
  // The dialog without a portal: what matters here is what it holds while it is open.
  '@/components/ui/dialog': {
    Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? h('div', null, children) : null,
    DialogContent: ({ children }: { children: React.ReactNode }) => h('div', { role: 'dialog' }, children),
    DialogHeader: pass('div'), DialogTitle: pass('h2'), DialogDescription: pass('p'),
  },
};
const exports: any = {};
new Function('require', 'exports', code)((id: string) => id in dependencies ? dependencies[id] : require(id), exports);
const { CloseReasonDialog } = exports as { CloseReasonDialog: React.ComponentType<Record<string, unknown>> };

const WON = { id: '00000000-0000-4000-8000-000000000201', state: 'won' as const, revision: 4 };
const LOST = { id: '00000000-0000-4000-8000-000000000202', state: 'lost' as const, revision: 7 };

async function mount(props: { target: typeof WON | typeof LOST | null; busy?: boolean; error?: string }) {
  const dom = new JSDOM('<div id="root"></div>');
  const previous = { window: globalThis.window, document: globalThis.document };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(dom.window.document.getElementById('root')!);
  const confirmed: Array<[unknown, string]> = []; let cancelled = 0;
  const render = (next: typeof props) => act(async () => root.render(h(CloseReasonDialog, { busy: false, ...next,
    onConfirm: (target: unknown, note: string) => { confirmed.push([target, note]); }, onCancel: () => { cancelled += 1; } })));
  await render(props);
  const doc = dom.window.document;
  const text = () => doc.body.textContent || '';
  const button = (label: string) => Array.from(doc.querySelectorAll('button')).find(item => item.textContent === label)!;
  const type = (value: string) => act(async () => {
    const field = doc.querySelector('textarea')!;
    Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
  const submit = () => act(async () => { doc.querySelector('form')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); });
  const done = async () => { await act(async () => root.unmount()); Object.assign(globalThis, previous); };
  return { doc, text, button, type, submit, render, confirmed, cancelled: () => cancelled, done };
}

test('nothing shows until an opportunity is being closed', async () => {
  const view = await mount({ target: null });
  try { assert.equal(view.doc.querySelector('[role="dialog"]'), null); } finally { await view.done(); }
});

test('closing as won asks what made the difference, in one optional line, and the move is confirmed with or without it', async () => {
  const view = await mount({ target: WON });
  try {
    assert.match(view.text(), /Pasar a Ganada/);
    assert.match(view.text(), /qué hizo la diferencia/);
    assert.match(view.text(), /Motivo \(opcional\)/);
    // With the line empty the move works: the reason is not a toll.
    await view.submit();
    assert.deepEqual(view.confirmed, [[WON, '']]);
    await view.type('  Respondimos   antes del cierre\ny el precio era el más bajo.  ');
    await view.submit();
    assert.deepEqual(view.confirmed[1], [WON, 'Respondimos antes del cierre y el precio era el más bajo.']);
  } finally { await view.done(); }
});

test('closing as lost says so, and cancel leaves the opportunity where it was', async () => {
  const view = await mount({ target: LOST });
  try {
    assert.match(view.text(), /Pasar a Perdida/);
    assert.match(view.text(), /qué pasó/);
    assert.ok(view.button('Pasar a Perdida'), 'the main action says what it does');
    await act(async () => { view.button('Cancelar').dispatchEvent(new (view.doc.defaultView as any).MouseEvent('click', { bubbles: true })); });
    assert.equal(view.cancelled(), 1);
    assert.deepEqual(view.confirmed, []);
  } finally { await view.done(); }
});

test('while it saves nothing can be pressed twice, and a failure is told inside the dialog with the note still there', async () => {
  const view = await mount({ target: LOST });
  try {
    await view.type('Adjudicaron a otra empresa');
    await view.render({ target: LOST, busy: true });
    assert.equal(view.button('Pasar a Perdida').disabled, true);
    assert.equal(view.button('Cancelar').disabled, true);
    await view.submit();
    assert.deepEqual(view.confirmed, [], 'a second submit while saving does nothing');
    await view.render({ target: LOST, error: 'El estado cambió. Actualiza la oportunidad.' });
    assert.equal(view.doc.querySelector('[role="alert"]')?.textContent, 'El estado cambió. Actualiza la oportunidad.');
    assert.equal(view.doc.querySelector('textarea')!.value, 'Adjudicaron a otra empresa');
  } finally { await view.done(); }
});

test('the line of one opportunity is not carried to the next one', async () => {
  const view = await mount({ target: WON });
  try {
    await view.type('Primer motivo');
    await view.render({ target: null });
    await view.render({ target: LOST });
    assert.equal(view.doc.querySelector('textarea')!.value, '');
  } finally { await view.done(); }
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import * as stages from '@/lib/commercial-opportunities/list-stages';

const require = createRequire(import.meta.url);
const compile = async (file: string) => ts.transpileModule(await readFile(new URL(file, import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const h = React.createElement;
const pass = (tag: string) => ({ children, ...props }: Record<string, unknown>) => h(tag, props.htmlFor ? { htmlFor: props.htmlFor } : {}, children as React.ReactNode);
const dependencies: Record<string, unknown> = {
  'lucide-react': new Proxy({}, { get: () => () => null }),
  '@/components/ui/button': { Button: ({ variant: _variant, size: _size, ...props }: Record<string, unknown>) => h('button', props) },
  '@/components/ui/input': { Input: (props: Record<string, unknown>) => h('input', props) },
  '@/components/ui/label': { Label: pass('label') },
  '@/components/ui/dialog': {
    Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? h('div', null, children) : null,
    DialogContent: ({ children }: { children: React.ReactNode }) => h('div', { role: 'dialog' }, children),
    DialogHeader: pass('div'), DialogTitle: pass('h2'), DialogDescription: pass('p'),
  },
  '@/lib/utils': { cn: (...values: unknown[]) => values.filter(Boolean).join(' ') },
  '@/lib/commercial-opportunities/list-stages': stages,
  './OpportunityFilters': { filterChip: (on: boolean) => (on ? 'chip on' : 'chip') },
};
const exports: any = {};
new Function('require', 'exports', await compile('./DiscardDialog.tsx'))((id: string) => id in dependencies ? dependencies[id] : require(id), exports);
const { DiscardDialog } = exports as { DiscardDialog: React.ComponentType<Record<string, unknown>> };

async function mount(props: Record<string, unknown>) {
  const dom = new JSDOM('<div id="root"></div>');
  const previous = { window: globalThis.window, document: globalThis.document };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(dom.window.document.getElementById('root')!);
  const confirmed: unknown[][] = []; let cancelled = 0;
  const render = (next: Record<string, unknown>) => act(async () => root.render(h(DiscardDialog, { busy: false, ...next,
    onConfirm: (...args: unknown[]) => { confirmed.push(args); }, onCancel: () => { cancelled += 1; } })));
  await render(props);
  const doc = dom.window.document;
  const button = (label: string) => Array.from(doc.querySelectorAll('button')).find(item => item.textContent === label)!;
  const click = (label: string) => act(async () => { button(label).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  const type = (value: string) => act(async () => {
    const field = doc.querySelector('input')!;
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
  const submit = () => act(async () => { doc.querySelector('form')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); });
  const done = async () => { await act(async () => root.unmount()); Object.assign(globalThis, previous); };
  return { doc, text: () => doc.body.textContent || '', button, click, type, submit, render, confirmed, cancelled: () => cancelled, done };
}
const ONE = { ids: ['a'], title: 'Servicio de aseo para el Hospital Regional' };

test('putting one aside asks why in a word, says where it goes and that the AI will read it', async () => {
  const view = await mount({ target: ONE });
  try {
    assert.match(view.text(), /No es para nosotros/);
    assert.match(view.text(), /«Servicio de aseo para el Hospital Regional» pasa a «Archivadas»\. La IA tendrá en cuenta el motivo/);
    assert.equal(view.doc.querySelectorAll('[role="radio"]').length, stages.DISCARD_REASONS.length);
    assert.equal(view.button('Archivar').disabled, true, 'nothing goes without a reason');
    await view.click('Fuera de nuestra zona');
    assert.equal(view.doc.querySelector('[aria-checked="true"]')?.textContent, 'Fuera de nuestra zona');
    await view.type('  Solo   la RM ');
    await view.submit();
    assert.deepEqual(view.confirmed, [[ONE, 'zona', 'Solo la RM']]);
  } finally { await view.done(); }
});

test('«Otro motivo» needs its line; several at once say how many; cancel leaves them where they were', async () => {
  const view = await mount({ target: { ids: ['a', 'b', 'c'] } });
  try {
    assert.match(view.text(), /No son para nosotros \(3\)/);
    assert.match(view.text(), /Las 3 pasan a «Archivadas»/);
    await view.click('Otro motivo');
    assert.match(view.text(), /Cuéntalo en una línea/);
    assert.equal(view.button('Archivar 3').disabled, true);
    await view.type('El comprador nos debe dos facturas');
    assert.equal(view.button('Archivar 3').disabled, false);
    await view.click('Cancelar');
    assert.equal(view.cancelled(), 1);
    assert.deepEqual(view.confirmed, []);
  } finally { await view.done(); }
});

test('while it saves nothing can be pressed twice, a failure is told inside, and the next one starts clean', async () => {
  const view = await mount({ target: ONE });
  try {
    await view.click('El monto no conviene');
    await view.render({ target: ONE, busy: true });
    assert.equal(view.button('Archivar').disabled, true);
    await view.submit();
    assert.deepEqual(view.confirmed, []);
    await view.render({ target: ONE, error: 'No se pudo completar la acción.' });
    assert.equal(view.doc.querySelector('[role="alert"]')?.textContent, 'No se pudo completar la acción.');
    await view.render({ target: { ids: ['z'], title: 'Otra' } });
    assert.equal(view.doc.querySelector('[aria-checked="true"]'), null, 'the reason is not carried to the next one');
  } finally { await view.done(); }
});

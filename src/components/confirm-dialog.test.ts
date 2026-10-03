import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { JSDOM } from 'jsdom';
import * as React from 'react';

// The dialog parts are stubbed (open → render, buttons → <button>): what is under test is the promise each question returns.
function loadConfirm() {
  const require = createRequire(import.meta.url);
  const source = ts.transpileModule(readFileSync('src/components/confirm-dialog.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const passthrough = ({ children }: any) => React.createElement(React.Fragment, null, children);
  const stubs: Record<string, unknown> = {
    '@/components/ui/alert-dialog': {
      AlertDialog: ({ open, children }: any) => (open ? React.createElement('div', { role: 'alertdialog' }, children) : null),
      AlertDialogContent: passthrough, AlertDialogHeader: passthrough, AlertDialogFooter: passthrough,
      AlertDialogTitle: ({ children }: any) => React.createElement('h2', null, children),
      AlertDialogDescription: ({ children }: any) => React.createElement('p', null, children),
      AlertDialogAction: ({ children, onClick, className }: any) => React.createElement('button', { 'data-action': 'confirm', onClick, className }, children),
      AlertDialogCancel: ({ children, onClick }: any) => React.createElement('button', { 'data-action': 'cancel', onClick }, children),
    },
    '@/components/ui/button': { buttonVariants: ({ variant }: any) => `variant-${variant}` },
    '@/lib/utils': { cn: (...values: unknown[]) => values.filter(Boolean).join(' ') },
  };
  const exports: any = {};
  new Function('require', 'exports', source)((name: string) => stubs[name] ?? require(name), exports);
  return exports;
}

test('a question resolves with the answer, names its action and a newer question cancels an open one', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://app.test' });
  const globals = globalThis as any;
  const previous = { window: globals.window, document: globals.document, act: globals.IS_REACT_ACT_ENVIRONMENT };
  Object.assign(globals, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const { createRoot } = await import('react-dom/client');
  const { ConfirmProvider, useConfirm } = loadConfirm();
  let confirm: any = null;
  const Probe = () => { confirm = useConfirm(); return null; };
  const root = createRoot(dom.window.document.getElementById('root')!);
  const button = (action: string) => dom.window.document.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!;
  try {
    await React.act(async () => root.render(React.createElement(ConfirmProvider, null, React.createElement(Probe))));
    assert.equal(dom.window.document.querySelector('[role="alertdialog"]'), null, 'nothing shows until something asks');

    let accepted: Promise<boolean> = Promise.resolve(false);
    await React.act(async () => { accepted = confirm({ title: '¿Eliminar 3 contactos?', description: 'No se puede deshacer.', confirmLabel: 'Eliminar 3 contactos', tone: 'danger' }); });
    assert.match(dom.window.document.body.textContent!, /¿Eliminar 3 contactos\?/);
    assert.equal(button('confirm').textContent, 'Eliminar 3 contactos');
    assert.match(button('confirm').className, /variant-destructive/);
    assert.equal(button('cancel').textContent, 'Cancelar');
    await React.act(async () => button('confirm').click());
    assert.equal(await accepted, true);
    assert.equal(dom.window.document.querySelector('[role="alertdialog"]'), null, 'the dialog closes after answering');

    let declined: Promise<boolean> = Promise.resolve(true);
    await React.act(async () => { declined = confirm({ title: '¿Salir sin guardar?' }); });
    assert.equal(button('confirm').textContent, 'Confirmar');
    assert.doesNotMatch(button('confirm').className || '', /variant-destructive/);
    await React.act(async () => button('cancel').click());
    assert.equal(await declined, false);

    let first: Promise<boolean> = Promise.resolve(true);
    let second: Promise<boolean> = Promise.resolve(false);
    await React.act(async () => { first = confirm({ title: 'Primera' }); });
    await React.act(async () => { second = confirm({ title: 'Segunda' }); });
    assert.equal(await first, false, 'an open question is answered «no» when another replaces it');
    assert.match(dom.window.document.body.textContent!, /Segunda/);
    await React.act(async () => button('confirm').click());
    assert.equal(await second, true);
  } finally {
    await React.act(async () => root.render(null));
    Object.assign(globals, { window: previous.window, document: previous.document, IS_REACT_ACT_ENVIRONMENT: previous.act });
  }
});

test('useConfirm outside the provider says where to mount it', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://app.test' });
  const globals = globalThis as any;
  const previous = { window: globals.window, document: globals.document, act: globals.IS_REACT_ACT_ENVIRONMENT, error: console.error };
  Object.assign(globals, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  console.error = () => {};
  const { createRoot } = await import('react-dom/client');
  const { useConfirm } = loadConfirm();
  let caught: unknown = null;
  class Boundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
    state = { failed: false };
    static getDerivedStateFromError() { return { failed: true }; }
    componentDidCatch(error: unknown) { caught = error; }
    render() { return this.state.failed ? null : this.props.children; }
  }
  const Probe = () => { useConfirm(); return null; };
  const root = createRoot(dom.window.document.getElementById('root')!);
  try {
    await React.act(async () => root.render(React.createElement(Boundary, null, React.createElement(Probe))));
    assert.match(String((caught as Error)?.message), /ConfirmProvider/);
  } finally {
    await React.act(async () => root.render(null));
    console.error = previous.error;
    Object.assign(globals, { window: previous.window, document: previous.document, IS_REACT_ACT_ENVIRONMENT: previous.act });
  }
});

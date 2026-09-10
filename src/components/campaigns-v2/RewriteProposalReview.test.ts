import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { JSDOM } from 'jsdom';
import * as React from 'react';

test('proposal review focuses/restores safely, exposes keyboard-scrollable text, and fences busy actions', async () => {
  const dom = new JSDOM('<button id="trigger">Proponer</button><div id="root"></div>', { url: 'https://app.test' });
  const globals = globalThis as any;
  const previous = { window: globals.window, document: globals.document, act: globals.IS_REACT_ACT_ENVIRONMENT };
  Object.assign(globals, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const { createRoot } = await import('react-dom/client');
  const require = createRequire(import.meta.url);
  const source = ts.transpileModule(readFileSync('src/components/campaigns-v2/RewriteProposalReview.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: any = {};
  new Function('require', 'exports', source)((name: string) => name === '@/components/ui/button'
    ? { Button: ({ children, variant, ...props }: any) => React.createElement('button', props, children) }
    : require(name), exports);
  const root = createRoot(dom.window.document.getElementById('root')!);
  const trigger = dom.window.document.getElementById('trigger')!;
  let applies = 0;
  let discards = 0;
  const render = (extra = {}) => React.act(async () => root.render(React.createElement(exports.RewriteProposalReview, {
    before: { subject: 'Original', body: 'Original body' },
    proposal: { subject: '<script>not HTML</script>', body: 'Proposed body', expectedVersionId: 'v1' },
    onApply: () => { applies += 1; }, onDiscard: () => { discards += 1; }, ...extra,
  })));
  try {
    trigger.focus();
    await render({ autoFocus: false });
    assert.equal(dom.window.document.activeElement, trigger, 'background proposal cannot steal focus from an open sheet');
    await render();
    assert.equal(dom.window.document.activeElement?.textContent, 'Propuesta sin guardar');
    assert.equal(dom.window.document.querySelector('section')?.getAttribute('aria-label'), 'Comparar propuesta de IA');
    assert.equal(dom.window.document.querySelectorAll('p[tabindex="0"]').length, 2);
    assert.equal(dom.window.document.querySelector('script'), null, 'proposal renders as text, never HTML');
    assert.match(dom.window.document.body.textContent!, /No envía el correo/);
    await render({ busy: true });
    const buttons = () => Array.from(dom.window.document.querySelectorAll<HTMLButtonElement>('#root button'));
    assert.equal(dom.window.document.querySelector('section')?.getAttribute('aria-busy'), 'true');
    assert.ok(buttons().every((button) => button.disabled));
    await React.act(async () => buttons().forEach((button) => button.click()));
    assert.equal(applies + discards, 0);
    await render({ disabled: true });
    assert.equal(buttons()[0].disabled, false, 'discard remains available for a stale/read-only proposal');
    assert.equal(buttons()[1].disabled, true);
    await React.act(async () => buttons()[0].click());
    assert.equal(discards, 1);
    await render();
    await React.act(async () => buttons()[1].click());
    assert.equal(applies, 1);
    await React.act(async () => root.render(null));
    assert.equal(dom.window.document.activeElement, trigger);
    await render();
    const other = dom.window.document.createElement('button');
    dom.window.document.body.append(other);
    other.focus();
    await React.act(async () => root.render(null));
    assert.equal(dom.window.document.activeElement, other, 'cleanup must not steal focus from another surface');
  } finally {
    await React.act(async () => root.unmount());
    dom.window.close();
    Object.assign(globals, { window: previous.window, document: previous.document, IS_REACT_ACT_ENVIRONMENT: previous.act });
  }
});

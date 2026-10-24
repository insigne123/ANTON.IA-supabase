import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const compiled = ts.transpileModule(await readFile(new URL('./segmented-tabs.tsx', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const dependencies: Record<string, unknown> = { '@/lib/utils': { cn: (...values: unknown[]) => values.filter(Boolean).join(' ') } };
const exports: any = {};
new Function('require', 'exports', compiled)((id: string) => (id in dependencies ? dependencies[id] : require(id)), exports);
const { SegmentedTabs, nextTabIndex, tabPanelProps } = exports;

const tabs = [{ value: 'summary', label: 'Informe' }, { value: 'apply', label: 'Cómo postular' }, { value: 'documents', label: 'Documentos', count: 3 }];
const render = (props: Record<string, unknown> = {}) => renderToStaticMarkup(React.createElement(SegmentedTabs, { tabs, value: 'apply', onChange: () => {}, label: 'Secciones de la oportunidad', idPrefix: 'op', ...props }));

test('a row of tabs is a tablist with one tab in the Tab order, the selected one (OPP-43)', () => {
  const html = render();
  assert.match(html, /^<div role="tablist" aria-label="Secciones de la oportunidad" aria-orientation="horizontal"/);
  assert.equal((html.match(/role="tab"/g) || []).length, 3);
  assert.match(html, /id="op-tab-apply" aria-selected="true" aria-controls="op-panel" tabindex="0"/);
  assert.equal((html.match(/tabindex="-1"/g) || []).length, 2);
  assert.match(html, />Documentos<span class="tabular-nums opacity-70">3<\/span>/);
  // It scrolls sideways on a narrow screen instead of wrapping into rows.
  assert.match(html, /overflow-x-auto/);
  assert.doesNotMatch(html, /flex-wrap/);
  assert.match(render({ variant: 'pills' }), /aria-selected:bg-foreground/);
});

test('arrows move to the next and previous tab and wrap around; Home and End go to the ends; other keys are left alone', () => {
  assert.equal(nextTabIndex('ArrowRight', 0, 3), 1);
  assert.equal(nextTabIndex('ArrowRight', 2, 3), 0);
  assert.equal(nextTabIndex('ArrowLeft', 0, 3), 2);
  assert.equal(nextTabIndex('Home', 2, 3), 0);
  assert.equal(nextTabIndex('End', 0, 3), 2);
  assert.equal(nextTabIndex('Enter', 1, 3), null);
  assert.equal(nextTabIndex('ArrowDown', 1, 3), null);
});

test('the panel is named by its tab', () => {
  assert.deepEqual(tabPanelProps('op', 'documents'), { role: 'tabpanel', id: 'op-panel', 'aria-labelledby': 'op-tab-documents' });
});

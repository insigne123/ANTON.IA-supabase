import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as radar from '../../lib/commercial-opportunities/workspace-radar';

const require = createRequire(import.meta.url);
const compile = async (file: string) => ts.transpileModule(await readFile(new URL(file, import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const dependencies: Record<string, unknown> = {
  'lucide-react': new Proxy({}, { get: () => 'svg' }),
  '@/components/ui/input': { Input: (props: any) => React.createElement('input', props) },
  '@/lib/utils': { cn: (...values: unknown[]) => values.filter(Boolean).join(' ') },
  '@/lib/commercial-opportunities/workspace-radar': radar,
};
const load = (code: string) => { const exports: any = {}; new Function('require', 'exports', code)((id: string) => (id in dependencies ? dependencies[id] : require(id)), exports); return exports; };
const { OpportunityFilters, filterChip } = load(await compile('./OpportunityFilters.tsx'));
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/<!-- -->/g, '').replace(/\s+/g, ' ');
const render = (props: Record<string, unknown> = {}) => renderToStaticMarkup(React.createElement(OpportunityFilters,
  { query: '', onQuery: () => {}, source: 'all', onSource: () => {}, categories: [], onCategories: () => {}, ...props }));

test('the filter that is on is the only dark pill, in both sizes: «secondary» on white could not be seen', () => {
  for (const size of ['md', 'sm'] as const) {
    const on = filterChip(true, size), off = filterChip(false, size);
    assert.match(on, /\bbg-foreground\b/);
    assert.match(on, /\btext-background\b/);
    assert.doesNotMatch(off, /\bbg-foreground\b/);
    assert.match(off, /\bborder-border\b/);
    assert.match(off, /hover:bg-muted/);
  }
  assert.match(filterChip(false), /\bh-8\b/);
  assert.match(filterChip(false, 'sm'), /\bh-7\b/);
  assert.match(filterChip(true), /focus-visible:ring-2/, 'keyboard focus is visible on every pill');
});

test('the filters offer the lines of service as buttons that can be pressed together, each one saying if it is on', () => {
  const html = render({ categories: ['seguridad'] });
  assert.match(html, /role="group" aria-label="Rubro"/);
  for (const label of ['Seguridad', 'Aseo', 'Outsourcing y externalización', 'Reclutamiento y selección']) assert.match(text(html), new RegExp(label));
  assert.match(html, /aria-pressed="true"[^>]*>Seguridad<\/button>/);
  assert.match(html, /aria-pressed="false"[^>]*>Aseo<\/button>/);
  assert.equal((html.match(/aria-pressed="true"/g) || []).length, 2, 'the picked line and the source «Todas las fuentes»');
});

test('without the handler, or for someone who does not see sources, there are no lines of service', () => {
  assert.doesNotMatch(render({ onCategories: undefined }), /aria-label="Rubro"/);
  assert.doesNotMatch(render({ showSources: false }), /aria-label="Rubro"/);
});

test('a button adds its line to the ones picked, or takes it away', () => {
  const calls: unknown[] = [];
  const tree: any = OpportunityFilters({ query: '', onQuery: () => {}, source: 'all', onSource: () => {}, categories: ['seguridad'], onCategories: (value: unknown) => calls.push(value) });
  const buttons: any[] = [];
  const walk = (node: any) => { if (!node || typeof node !== 'object') return; if (node.type === 'button' && node.props['aria-pressed'] !== undefined) buttons.push(node); [node.props?.children].flat(Infinity).forEach(walk); };
  walk(tree);
  const by = (label: string) => buttons.find(button => [button.props.children].flat().join('') === label);
  by('Aseo').props.onClick();
  by('Seguridad').props.onClick();
  assert.deepEqual(calls, [['seguridad', 'aseo'], []]);
});

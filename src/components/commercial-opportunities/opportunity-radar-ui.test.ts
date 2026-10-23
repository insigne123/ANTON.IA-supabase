import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as radar from '@/lib/commercial-opportunities/workspace-radar';

const require = createRequire(import.meta.url);
const compile = async (file: string) => ts.transpileModule(await readFile(new URL(file, import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const dependencies: Record<string, unknown> = {
  'lucide-react': new Proxy({}, { get: () => 'svg' }),
  '@/components/ui/button': { Button: ({ asChild, variant, size, ...props }: any) => React.createElement('button', props) },
  '@/components/ui/collapsible': { Collapsible: 'div', CollapsibleContent: 'div', CollapsibleTrigger: ({ children }: any) => children },
  '@/lib/utils': { cn: (...values: unknown[]) => values.filter(Boolean).join(' ') },
  '@/lib/commercial-opportunities/workspace-radar': radar,
};
const load = (code: string) => { const exports: any = {}; new Function('require', 'exports', code)((id: string) => (id in dependencies ? dependencies[id] : require(id)), exports); return exports; };
const { AdvicePill } = load(await compile('./OpportunityRadar.tsx'));
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/<!-- -->/g, '').replace(/\s+/g, ' ').trim();
const item = { id: 'a', kind: 'tender', title: 'Guardias', company_name: null, buyer_name: 'Banco', company_domain: null, url: null, score: 80, reasons: [], deadline_at: new Date(Date.now() + 10 * 86_400_000).toISOString(),
  amount: null, currency: null, data: { evaluation: 'recommended' }, updated_at: '2026-10-16T00:00:00Z' };

test('«Postular» is advice for a decision still to take: once presented or closed, the stage next to it says where it stands', () => {
  assert.equal(text(renderToStaticMarkup(React.createElement(AdvicePill, { item }))), 'Postular');
  for (const state of ['assigned', 'working', 'blocked', 'unassigned', null, undefined]) assert.equal(text(renderToStaticMarkup(React.createElement(AdvicePill, { item, state }))), 'Postular', String(state));
  for (const state of ['submitted', 'won', 'lost', 'archived']) assert.equal(renderToStaticMarkup(React.createElement(AdvicePill, { item, state })), '', state);
});

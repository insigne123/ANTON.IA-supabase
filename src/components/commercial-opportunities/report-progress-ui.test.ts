import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as reportView from '@/lib/commercial-opportunities/report-view';

const require = createRequire(import.meta.url);
const source = await readFile(new URL('./OpportunityExpedient.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const dependencies: Record<string, unknown> = {
  'lucide-react': new Proxy({}, { get: () => 'svg' }),
  '@/components/ui/button': { Button: ({ asChild, variant, size, ...props }: any) => React.createElement('button', props) },
  '@/lib/utils': { cn: (...values: unknown[]) => values.filter(Boolean).join(' ') },
  '@/lib/commercial-opportunities/report-view': reportView,
};
const exports: any = {};
new Function('require', 'exports', code)((id: string) => (id in dependencies ? dependencies[id] : require(id)), exports);
const { ReportProgress } = exports;
const render = (props: Record<string, unknown>) => renderToStaticMarkup(React.createElement(ReportProgress, { state: 'failed', error: null, onRetry: () => {}, ...props }));

test('a failed report offers one retry, and once pressed the button says it is on its way', () => {
  const idle = render({});
  assert.match(idle, /No pudimos terminar<!-- --> <!-- -->el informe|No pudimos terminar el informe/);
  assert.match(idle, />Intentar de nuevo<\/button>/);
  assert.doesNotMatch(idle, /disabled/);
  const pending = render({ pending: true });
  assert.match(pending, /Reintentando…/);
  assert.match(pending, /<button[^>]*disabled=""[^>]*aria-busy="true"/, 'a second press cannot send it twice');
});

test('while it runs, the progress says what is happening instead of the error', () => {
  const running = render({ state: 'running' });
  assert.match(running, /Leyendo los documentos y redactando el informe/);
  assert.doesNotMatch(running, /Intentar de nuevo|Reintentando/);
});

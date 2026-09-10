import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import * as loading from '@/lib/research-report-loading';
import * as workspace from '@/lib/research-workspace';
import * as contracts from '@/lib/report-v2-contracts';

const require = createRequire(import.meta.url);
async function component(file: string, dependencies: Record<string, unknown>) {
  const source = await readFile(new URL(file, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const exports: any = {};
  new Function('require', 'exports', code)((id: string) => {
    if (id in dependencies) return dependencies[id];
    if (id.startsWith('@/components/ui/')) return new Proxy({}, { get: () => 'div' });
    return require(id);
  }, exports);
  return exports;
}

const { ResearchReportProgress } = await component('./ResearchReportProgress.tsx', {
  '@/lib/research-report-loading': loading,
  '@/components/ui/progress': { Progress: ({ value, ...props }: any) => React.createElement('div', { ...props, role: 'progressbar', 'aria-valuenow': value }) },
});
const { NativeResearchReport } = await component('./NativeResearchReport.tsx', {
  'lucide-react': new Proxy({}, { get: () => 'svg' }),
  '@/lib/research-report-loading': loading,
  '@/lib/research-workspace': workspace,
  '@/lib/report-v2-contracts': contracts,
  '@/lib/utils': { cn: (...values: unknown[]) => values.filter(Boolean).join(' ') },
  '@/components/research/ResearchReportProgress': { ResearchReportProgress },
  '@/components/research/ReportFieldAnswers': {
    ReportFieldAnswers: () => null,
    ReportFieldStatusBadge: () => null,
    selectPreviewReportFields: (answers: unknown[]) => answers,
  },
});

test('actual report component hides evidence and ready labels; failure renders a retry, not a skeleton', () => {
  const result = workspace.parseResearchReportDetail({ status: 'partial', researchSnapshotId: 'snapshot', result: {
    status: 'partial', researchSnapshotId: 'snapshot', lead: { companyName: 'Acme' },
    evidence: [{ statement: 'PRIVATE PRELIMINARY EVIDENCE', kind: 'fact', sourceUrl: 'https://example.com' }],
  } })!.result;
  const pending = renderToStaticMarkup(React.createElement(NativeResearchReport, { result, readiness: 'ready', reportSynthesis: { status: 'running' } }));
  assert.match(pending, /Preparando el informe completo/);
  assert.doesNotMatch(pending, /PRIVATE PRELIMINARY|Lista para redactar|Completada|Lo esencial/);
  const failed = renderToStaticMarkup(React.createElement(NativeResearchReport, { result, reportSynthesis: { status: 'failed_permanent' }, onRetrySynthesis: () => {} }));
  assert.match(failed, /Reintentar informe/);
  assert.doesNotMatch(failed, /progressbar|aria-busy="true"|PRIVATE PRELIMINARY/);
});

test('progress uses the clock, isolates lead switches, and clears its timer on unmount', async (t) => {
  const dom = new JSDOM('<div id="root"></div>');
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const start = '2026-09-09T12:00:00.000Z';
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(start) });
  const timers = new Map<number, () => void>();
  let id = 0;
  dom.window.setInterval = ((callback: () => void) => { timers.set(++id, callback); return id; }) as any;
  dom.window.clearInterval = (timer) => { if (timer !== undefined) timers.delete(timer); };
  const root = createRoot(dom.window.document.getElementById('root')!);
  try {
    const render = async (key: string, startedAt: string) => act(async () => root.render(React.createElement(ResearchReportProgress, { key, startedAt })));
    const value = () => Number(dom.window.document.querySelector('[role="progressbar"]')!.getAttribute('aria-valuenow'));
    await render('lead-a', start);
    await act(async () => { t.mock.timers.tick(150_000); timers.forEach((tick) => tick()); });
    const elapsedValue = value();
    assert.ok(elapsedValue > 0 && elapsedValue < 95);
    assert.match(dom.window.document.body.textContent!, /tomando más de lo estimado/);
    assert.equal(dom.window.document.querySelector('[role="status"] [role="progressbar"]'), null);
    await render('lead-b', new Date(Date.now()).toISOString());
    assert.equal(value(), 0);
    assert.equal(timers.size, 1);
    await render('lead-a', start);
    assert.equal(value(), elapsedValue);
    await act(async () => root.unmount());
    assert.equal(timers.size, 0);
  } finally {
    Object.assign(globalThis, { window: previousWindow, document: previousDocument, IS_REACT_ACT_ENVIRONMENT: false });
    dom.window.close();
  }
});

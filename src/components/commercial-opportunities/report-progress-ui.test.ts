import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as reportView from '@/lib/commercial-opportunities/report-view';
import * as reportProgress from '@/lib/commercial-opportunities/report-progress';

const require = createRequire(import.meta.url);
const compile = async (file: string) => ts.transpileModule(await readFile(new URL(file, import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const dependencies: Record<string, unknown> = {
  'lucide-react': new Proxy({}, { get: () => 'svg' }),
  '@/components/ui/button': { Button: ({ asChild, variant, size, ...props }: any) => React.createElement('button', props) },
  '@/lib/utils': { cn: (...values: unknown[]) => values.filter(Boolean).join(' ') },
  '@/lib/commercial-opportunities/report-view': reportView,
  '@/lib/commercial-opportunities/report-progress': reportProgress,
};
const load = (code: string) => { const exports: any = {}; new Function('require', 'exports', code)((id: string) => (id in dependencies ? dependencies[id] : require(id)), exports); return exports; };
dependencies['./ReportOffice'] = load(await compile('./ReportOffice.tsx'));
const { ReportProgress } = load(await compile('./OpportunityExpedient.tsx'));
const render = (props: Record<string, unknown>) => renderToStaticMarkup(React.createElement(ReportProgress, { state: 'failed', error: null, onRetry: () => {}, ...props }));

test('a failed report offers one retry, and once pressed the button says it is on its way', () => {
  const idle = render({});
  assert.match(idle, /No pudimos terminar<!-- --> <!-- -->el informe|No pudimos terminar el informe/);
  assert.match(idle, />Intentar de nuevo<\/button>/);
  assert.doesNotMatch(idle, /disabled/);
  const pending = render({ pending: true });
  assert.match(pending, /Reintentando…/);
  assert.match(pending, /<button[^>]*disabled=""[^>]*aria-busy="true"/, 'a second press cannot send it twice');
  // An update that fails leaves the earlier report, and says so.
  const kept = text(render({ kept: true }));
  assert.match(kept, /No pudimos actualizar el informe\./);
  assert.match(kept, /El informe anterior sigue abajo\./);
});

test('while it runs, the progress says what is happening instead of the error', () => {
  const running = render({ state: 'running' });
  assert.match(running, /Leyendo los documentos y redactando el informe/);
  assert.doesNotMatch(running, /Intentar de nuevo|Reintentando/);
});

const progress = (extra: Record<string, unknown>) => ({ read: 0, total: null, document: null, since: null, ...extra });
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/<!-- -->/g, '').replace(/\s+/g, ' ');

test('the office says who is doing what, from what the job recorded, and what is done reads as done', () => {
  const reading = render({ state: 'running', tender: true, documents: 6, buyer: 'Corporación Cultural de Puente Alto',
    progress: progress({ stage: 'read', read: 11, total: 40, document: 'Bases Administrativas.pdf' }) });
  assert.match(reading, /role="status" aria-live="polite"/);
  assert.match(text(reading), /Analista · Lee «Bases Administrativas\.pdf» · parte 12 de 40/);
  // Each desk: done with what it did, working, or waiting; the ghosts are decoration.
  assert.match(text(reading), /Mensajero Listo: Reunió 6 documentos/);
  assert.match(text(reading), /Becario Listo: Revisó fuentes públicas/);
  assert.match(text(reading), /Analista Parte 12 de 40/);
  assert.match(text(reading), /Jefe En espera/);
  assert.equal((reading.match(/<svg[^>]*>/g) || []).length, 4);
  assert.ok((reading.match(/aria-hidden="true"/g) || []).length >= 4, 'the ghosts are hidden from screen readers');
  // Only reading is measured: 11 of 40 parts.
  assert.match(reading, /width:27\.5%/);
  assert.doesNotMatch(reading, /width:35%/);

  const gathering = text(render({ state: 'running', tender: true, documents: 0, progress: progress({ stage: 'gather' }) }));
  assert.match(gathering, /Mensajero · Trae los formularios y el foro desde Mercado Público/);
  assert.match(gathering, /Becario En espera/);
  assert.match(text(render({ state: 'running', progress: progress({ stage: 'buyer' }), buyer: '' })), /Becario · Busca quién es el comprador en fuentes públicas/);
  assert.match(text(render({ state: 'queued', progress: progress({ stage: 'queued' }) })), /En cola: la oficina empieza en menos de un minuto/);
  // A signal gets its ficha, not a report on whether to bid.
  assert.match(text(render({ state: 'running', signal: true, progress: progress({ stage: 'write', total: 3, read: 3 }) })), /Jefe · Escribe la ficha comercial/);
});

test('writing says how long it has been at it, but not a time from an earlier attempt', () => {
  const now = Date.now();
  const html = render({ state: 'running', progress: progress({ stage: 'write', read: 40, total: 40, since: new Date(now - 83_000).toISOString() }) });
  const writing = text(html);
  // The time ticks every second: a screen reader hears the stage, not a count every second.
  assert.equal(html.match(/aria-live="polite">([^<]*)</)?.[1], 'Jefe · Escribe el informe y decide si conviene postular');
  assert.match(writing, /Jefe · Escribe el informe y decide si conviene postular · lleva 1 min 2[34] s/);
  assert.match(writing, /Analista Listo: Leyó 40 partes/);
  const stale = text(render({ state: 'running', progress: progress({ stage: 'write', read: 40, total: 40, since: new Date(now - 40 * 60_000).toISOString() }) }));
  assert.match(stale, /Jefe · Escribe el informe y decide si conviene postular /);
  assert.doesNotMatch(stale, /lleva/);
});

test('without progress from the server the card says what it always said', () => {
  assert.match(render({ state: 'running', progress: null }), /Leyendo los documentos y redactando el informe/);
});

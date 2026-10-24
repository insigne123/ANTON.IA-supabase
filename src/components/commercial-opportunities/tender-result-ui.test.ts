import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as closeOutcome from '@/lib/commercial-opportunities/close-outcome';

const require = createRequire(import.meta.url);
const code = ts.transpileModule(await readFile(new URL('./TenderResultCallout.tsx', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const h = React.createElement;
const dependencies: Record<string, unknown> = {
  'lucide-react': new Proxy({}, { get: () => () => null }),
  '@/components/ui/button': { Button: ({ variant, size, children, ...props }: any) => h('button', { ...props, 'data-variant': variant ?? 'default' }, children) },
  '@/lib/commercial-opportunities/close-outcome': closeOutcome,
};
const exports: any = {};
new Function('require', 'exports', code)((id: string) => (id in dependencies ? dependencies[id] : require(id)), exports);
const { TenderResultCallout } = exports;
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const awarded = { status: 'adjudicada', awardedAt: '2026-10-20T20:27:00.000Z', expectedAt: null, bidders: 5, total: 85_000_000, currency: 'CLP',
  actUrl: 'https://www.mercadopublico.cl/acta?qs=1', winners: [{ rut: '76.543.210-3', name: 'Seguridad Sur SpA', amount: 85_000_000 }], checkedAt: '2026-10-21T11:00:00.000Z' };
const render = (props: Record<string, unknown>) => renderToStaticMarkup(h(TenderResultCallout, { result: awarded, state: 'submitted', admin: true, busy: false, onClose: () => {}, ...props }));
const buttons = (html: string) => [...html.matchAll(/<button[^>]*data-variant="([^"]+)"[^>]*>([^<]+)</g)].map(match => [match[2], match[1]]);

test('a tender awarded to someone else: the result with its act, and «Pasar a Perdida» in front for an administrator', () => {
  const html = render({ result: { ...awarded, ours: false } });
  assert.match(text(html), /^Resultado: Adjudicada el 20 de octubre a Seguridad Sur SpA por \$85\.000\.000, entre 5 ofertas\. Ver acta/);
  assert.match(html, /href="https:\/\/www\.mercadopublico\.cl\/acta\?qs=1" target="_blank" rel="noopener noreferrer"/);
  assert.deepEqual(buttons(html), [['Pasar a Perdida', 'default'], ['La ganamos', 'ghost']]);
});

test('awarded to the company it says so and «Pasar a Ganada» goes first; unknown, neither goes first', () => {
  const ours = render({ result: { ...awarded, ours: true } });
  assert.match(text(ours), /La adjudicaron a tu empresa\./);
  assert.deepEqual(buttons(ours), [['Pasar a Ganada', 'default'], ['No la ganamos', 'ghost']]);
  assert.deepEqual(buttons(render({ result: { ...awarded, ours: null } })), [['La ganamos', 'outline'], ['No la ganamos', 'outline']]);
});

test('a void tender offers only «Pasar a Perdida», and a member reads that an administrator records it', () => {
  const html = render({ result: { ...awarded, status: 'desierta', winners: [], total: null, actUrl: null } });
  assert.match(text(html), /Declarada desierta el 20 de octubre: nadie se la adjudicó\./);
  assert.deepEqual(buttons(html), [['Pasar a Perdida', 'default']]);
  const member = render({ admin: false });
  assert.deepEqual(buttons(member), []);
  assert.match(text(member), /Un administrador registrará el resultado\./);
});

test('presented and not decided it says it is watched; closed or not presented it says nothing', () => {
  assert.match(text(render({ result: null })), /^Presentada\. Revisamos el resultado en Mercado Público cada mañana/);
  assert.match(text(render({ result: { ...awarded, status: 'cerrada', awardedAt: null, winners: [], total: null, actUrl: null, expectedAt: '2026-10-28T15:00:00.000Z' } })),
    /^Presentada\. Cerrada; la adjudicación se espera para el 28 de octubre\.$/);
  assert.equal(render({ state: 'lost' }), '');
  assert.equal(render({ state: 'working', result: null }), '');
  // Decided while still in preparation (never marked as presented): it is shown all the same.
  assert.match(text(render({ state: 'working' })), /^Resultado: Adjudicada/);
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as calls from '../../lib/contact-calls';

const require = createRequire(import.meta.url);
const compile = async (file: string) => ts.transpileModule(await readFile(new URL(file, import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const started: Array<[string, unknown]> = [];
const dependencies: Record<string, unknown> = {
  'next/link': ({ href, children, ...props }: any) => React.createElement('a', { href, ...props }, children),
  'lucide-react': new Proxy({}, { get: () => 'svg' }),
  '@/context/AuthContext': { useAuth: () => ({ user: { user_metadata: { full_name: 'Diego Soto' } } }) },
  '@/lib/contact-calls': calls,
  '@/lib/contact-calls-client': { startCall: (channel: string, contact: unknown) => { started.push([channel, contact]); }, saveCallOutcome: async () => ({ ok: true, pipeline: false }), CALL_OUTCOME_EVENT: 'x', CALL_STARTED_EVENT: 'y' },
  '@/lib/utils': { cn: (...values: unknown[]) => values.filter(Boolean).join(' ') },
  '@/components/ui/button': { Button: ({ asChild, variant, size, children, ...props }: any) => (asChild ? children : React.createElement('button', props, children)) },
  '@/components/ui/card': { Card: 'div', CardContent: 'div', CardHeader: 'div' },
  '@/hooks/use-toast': { useToast: () => ({ toast: () => undefined }) },
  '@/components/contact/CallOutcomePrompt': {
    CallOutcomeChoices: ({ channel }: any) => React.createElement('div', { 'data-choices': channel },
      calls.CALL_OUTCOMES.map(({ key }) => React.createElement('button', { key }, calls.outcomeLabel(key, channel)))),
  },
  './usePersonalHome': { usePersonalHome: () => ({ data: null, loading: true, error: false, load: () => undefined }) },
};
const load = (code: string) => {
  const exports: any = {};
  new Function('require', 'exports', code)((id: string) => (id in dependencies ? dependencies[id] : require(id)), exports);
  return exports;
};
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/<!-- -->/g, '').replace(/\s+/g, ' ').trim();

const { ContactActions } = load(await compile('./ContactActions.tsx'));
const { CallsTodayView } = load(await compile('../home/CallsCard.tsx'));

test('a mobile shows as text with «Llamar» and «WhatsApp», the opener in the seller\'s name, and the script when there is one', () => {
  const html = renderToStaticMarkup(React.createElement(ContactActions, {
    phone: '+56 9 1234 5678', morePhones: 1, onScript: () => undefined,
    contact: { leadId: 'lead-1', name: 'Ana Rojas', company: 'Minera Sur' }, senderCompany: 'GrupoExpro',
  }));
  assert.match(text(html), /^\+56 9 1234 5678 \+1 Llamar WhatsApp Guion$/);
  assert.match(html, /href="tel:\+56912345678"/);
  assert.match(html, /aria-label="Llamar a Ana Rojas al \+56 9 1234 5678"/);
  assert.match(html, /href="https:\/\/wa\.me\/56912345678\?text=Hola%20Ana%2C%20soy%20Diego%20de%20GrupoExpro\./);
  assert.match(html, /target="_blank" rel="noopener noreferrer"/);
});

test('a local number calls but offers no WhatsApp, and no usable number shows nothing', () => {
  const local = renderToStaticMarkup(React.createElement(ContactActions, { phone: '22 345 6789', contact: { name: 'Pedro' } }));
  assert.match(local, /href="tel:223456789"/);
  assert.doesNotMatch(local, /wa\.me/);
  assert.doesNotMatch(text(local), /Guion/);
  assert.equal(renderToStaticMarkup(React.createElement(ContactActions, { phone: 'Not Found', contact: { name: 'Nadie' } })), '');
});

test('«Llamadas» in «Hoy» lists the calls without a result with their choices and links to «Por llamar»', () => {
  const html = renderToStaticMarkup(React.createElement(CallsTodayView, {
    busy: null, onChoose: () => undefined,
    data: {
      partial: false, toCall: 4,
      pending: [{ id: 'c1', channel: 'whatsapp', name: 'Ana Rojas', company: 'Minera Sur', leadId: 'lead-1', startedAt: '2026-11-02T14:05:00Z' }],
    },
  }));
  const words = text(html);
  assert.match(words, /^Llamadas Por llamar Sin resultado · 1 Ana Rojas WhatsApp · Minera Sur · 2 nov, 11:05 Respondió/);
  assert.match(words, /Respondió Agendó reunión Sin respuesta aún No le interesa Número equivocado/);
  assert.match(words, /4 contactos con móvil esperan tu llamada \.$/);
  assert.match(html, /href="\/saved\/leads\/enriched\?etapa=to_call"/);
  assert.match(html, /<h2 id="calls-today-title"[^>]*>Llamadas<\/h2>/);
});

test('with nothing pending and nobody to call there is no card', () => {
  assert.equal(renderToStaticMarkup(React.createElement(CallsTodayView, { busy: null, onChoose: () => undefined, data: { pending: [], toCall: 0, partial: false } })), '');
  assert.equal(renderToStaticMarkup(React.createElement(CallsTodayView, { busy: null, onChoose: () => undefined, data: null })), '');
});

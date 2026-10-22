import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as memberWork from '../../lib/commercial-opportunities/member-work';
import * as assignmentEmail from '../../lib/commercial-opportunities/assignment-email';

const require = createRequire(import.meta.url);
const compile = async (file: string) => ts.transpileModule(await readFile(new URL(file, import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const el = (tag: string) => (props: any) => React.createElement(tag, props);
const dependencies: Record<string, unknown> = {
  'lucide-react': new Proxy({}, { get: () => 'svg' }),
  '@/components/ui/button': { Button: (props: any) => React.createElement('button', { ...props, variant: undefined, size: undefined }) },
  '@/components/ui/textarea': { Textarea: el('textarea') }, '@/components/ui/label': { Label: el('label') }, '@/components/ui/input': { Input: el('input') },
  // The dialog\'s content only exists while it is open; closed, as here, the page shows nothing of it.
  '@/components/ui/dialog': { Dialog: ({ open, children }: any) => (open ? React.createElement('div', null, children) : null), DialogContent: el('div'), DialogHeader: el('div'), DialogTitle: el('h2'), DialogDescription: el('p') },
  '@/lib/commercial-opportunities/member-work': memberWork,
  '@/lib/commercial-opportunities/assignment-email': assignmentEmail,
};
const load = (code: string) => { const exports: any = {}; new Function('require', 'exports', code)((id: string) => (id in dependencies ? dependencies[id] : require(id)), exports); return exports; };
const { MemberStrip, DecisionCallout } = load(await compile('./MemberWork.tsx'));
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/<!-- -->/g, '').replace(/\s+/g, ' ');
const noop = async () => true;
const strip = (props: Record<string, unknown> = {}) => renderToStaticMarkup(React.createElement(MemberStrip, {
  state: 'working', assignedBy: 'Nicolás Yarur', nextActionAt: '2026-10-22T13:00:00Z', openTasks: 2, canStep: true, busy: false, onStep: noop, onDecision: noop, ...props }));

test('the person working an opportunity sees where it is, what is expected and the one step forward first', () => {
  const html = strip();
  assert.match(html, /aria-label="Tu avance"/);
  const words = text(html);
  assert.match(words, /Estado En gestión/);
  assert.match(words, /Próxima acción: jueves 22 de octubre, 10:00/);
  assert.match(words, /Asignó: Nicolás Yarur/);
  assert.match(words, /2 tareas tuyas pendientes/);
  assert.ok(html.indexOf('Marcar como presentada') < html.indexOf('Reportar un bloqueo'), 'the way forward before the exit');
  assert.match(words, /Plantear una decisión/);
  assert.equal((html.match(/<button[^>]*type="submit"/g) || []).length, 0, 'the dialog is closed: no form on the page');
});

test('a just assigned opportunity starts from «Empezar a gestionarla»; a blocked one is taken back with «Retomarla»', () => {
  assert.match(text(strip({ state: 'assigned' })), /Estado Asignada.*Empezar a gestionarla.*Reportar un bloqueo/);
  const blocked = text(strip({ state: 'blocked' }));
  assert.match(blocked, /Estado Bloqueada/);
  assert.match(blocked, /Retomarla/);
  assert.doesNotMatch(blocked, /Reportar un bloqueo/);
});

test('an administrator sees the facts but not the steps; nobody takes steps on what an administrator closed', () => {
  const admin = text(strip({ canStep: false }));
  assert.match(admin, /Estado En gestión/); assert.match(admin, /Asignó: Nicolás Yarur/);
  assert.doesNotMatch(admin, /Marcar como presentada|Reportar un bloqueo|Plantear una decisión/);
  const won = text(strip({ state: 'won' }));
  assert.match(won, /Estado Ganada/); assert.doesNotMatch(won, /Marcar|Reportar|Plantear|Retomarla|Volver a gestión/);
});

test('what is missing is left out instead of saying «sin fecha»', () => {
  const words = text(strip({ nextActionAt: null, assignedBy: null, openTasks: 0 }));
  assert.doesNotMatch(words, /Próxima acción|Asignó|tareas tuyas|tarea tuya/);
  assert.match(text(strip({ openTasks: 1 })), /1 tarea tuya pendiente/);
});

const decision = { id: 'a1', type: 'no_go', body: 'Propone no postular: Pide 24 meses de experiencia que no podemos acreditar', dueAt: '2026-10-23T15:00:00Z', actorId: 'u1', at: '2026-10-22T10:00:00Z' };
const callout = (props: Record<string, unknown> = {}) => renderToStaticMarkup(React.createElement(DecisionCallout, { decision, who: 'Luis Soto', admin: false, busy: false, onReply: noop, ...props }));

test('the team sees the decision waiting, who put it and the date it is needed by', () => {
  const words = text(callout());
  assert.match(words, /Propone no postular · Luis Soto · para el viernes 23 de octubre/);
  assert.match(words, /Pide 24 meses de experiencia que no podemos acreditar/);
  assert.doesNotMatch(words, /Propone no postular: Pide/, 'the label is not repeated in the sentence');
  assert.match(words, /Un administrador te responderá aquí mismo/);
  assert.doesNotMatch(callout(), /<input/);
});

test('only an administrator gets the box to answer it', () => {
  const html = callout({ admin: true });
  assert.match(html, /<label[^>]*for="decision-reply"[^>]*>Tu respuesta/);
  assert.match(html, /<input[^>]*id="decision-reply"/);
  assert.match(text(html), /Responder/);
  assert.doesNotMatch(text(html), /te responderá aquí mismo/);
  assert.doesNotMatch(text(callout({ decision: { ...decision, dueAt: null } })), /para el/);
});

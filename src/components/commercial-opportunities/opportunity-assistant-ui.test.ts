import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as assistant from '../../lib/commercial-opportunities/assistant';
import * as reportView from '../../lib/commercial-opportunities/report-view';

const require = createRequire(import.meta.url);
const compile = async (file: string) => ts.transpileModule(await readFile(new URL(file, import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const dependencies: Record<string, unknown> = {
  'lucide-react': new Proxy({}, { get: () => 'svg' }),
  '@/components/ui/button': { Button: ({ asChild, variant, size, ...props }: any) => React.createElement('button', props) },
  '@/components/ui/markdown-text': { MarkdownText: ({ text }: { text: string }) => React.createElement('div', { 'data-markdown': '' }, text) },
  '@/lib/utils': { cn: (...values: unknown[]) => values.filter(Boolean).join(' ') },
  '@/lib/commercial-opportunities/assistant': assistant,
  '@/lib/commercial-opportunities/report-view': reportView,
};
const load = (code: string) => { const exports: any = {}; new Function('require', 'exports', code)((id: string) => (id in dependencies ? dependencies[id] : require(id)), exports); return exports; };
const { AssistantConversation, AssistantSidebar, OpportunityAssistant } = load(await compile('./OpportunityAssistant.tsx'));
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/<!-- -->/g, '').replace(/\s+/g, ' ');
const noop = () => {};
const conversation = (props: Record<string, unknown>) => renderToStaticMarkup(React.createElement(AssistantConversation, {
  admin: true, title: 'Nueva conversación', messages: [], pending: null, busy: false, onAsk: noop, onRetry: noop, onOpen: noop, onHandoff: noop, ...props,
}));

test('an empty conversation invites a first question with suggestions for the role', () => {
  const admin = conversation({});
  assert.match(text(admin), /¿En qué te ayudo con tus oportunidades\?/);
  assert.match(admin, /<button type="button"[^>]*>¿Qué planean comprar los organismos de aquí a fin de año\?<\/button>/);
  assert.match(text(admin), /y la demanda futura/);
  assert.match(admin, /<label for="assistant-question" class="sr-only">Escribe tu pregunta<\/label>/);
  assert.match(admin, /aria-label="Enviar pregunta"[^>]*disabled=""|disabled=""[^>]*aria-label="Enviar pregunta"/);
  const member = conversation({ admin: false });
  assert.match(text(member), /¿Qué tengo pendiente esta semana\?/);
  assert.doesNotMatch(text(member), /demanda futura|planean comprar/);
});

test('an answer shows its opportunities to open, the way into one licitación\'s chat and what to ask next', () => {
  const html = conversation({ messages: [{ id: 'm1', question: '¿Algo de cámaras?', created_at: '2026-10-18T12:00:00Z', answer: {
    answer: 'Hay **una** que cierra el martes.', followups: ['¿Qué garantía piden?', '¿Tiene equipo?'],
    cards: [{ id: 'o2', title: 'Cámaras de seguridad Castro', buyer: 'Municipalidad de Castro', kind: 'compra_agil', deadline: '2026-10-21T18:00:00Z', note: 'Calza con tu monitoreo' }],
    handoff: { id: 'o2', title: 'Cámaras de seguridad Castro', question: '¿Qué garantía piden?' },
  } }] });
  assert.match(html, /bg-primary[^"]*">¿Algo de cámaras\?<\/p>/);
  assert.match(html, /data-markdown="">Hay \*\*una\*\* que cierra el martes\.<\/div>/);
  assert.match(text(html), /Compra Ágil · Municipalidad de Castro · cierra el 21 de octubre de 2026, 15:00/);
  assert.match(html, /aria-label="Abrir Cámaras de seguridad Castro"/);
  assert.match(text(html), /Esto lo responde mejor la conversación de Cámaras de seguridad Castro , que lee sus bases\./);
  assert.match(text(html), /Seguir en la conversación de esta licitación/);
  assert.match(html, /aria-label="Preguntas para seguir"/);
  assert.match(html, /aria-busy="false"/);
});

test('a question on its way shows at once; one that stopped says why and can be asked again', () => {
  const waiting = conversation({ pending: '¿Qué cierra?' });
  assert.match(waiting, /role="status"/);
  assert.match(text(waiting), /Revisando tus oportunidades…/);
  assert.match(waiting, /aria-busy="true"/);
  const stopped = conversation({ messages: [{ id: 'm1', question: '¿Qué cierra?', created_at: '', answer: null, job: { state: 'blocked', error: 'Se alcanzó el presupuesto disponible para este trabajo.' } }] });
  assert.match(text(stopped), /Se alcanzó el presupuesto disponible para este trabajo\./);
  assert.match(text(stopped), /Intentar de nuevo/);
  assert.match(stopped, /aria-busy="false"/, 'nothing is on its way');
  const queued = conversation({ messages: [{ id: 'm1', question: '¿Qué cierra?', created_at: '', answer: null, job: { state: 'queued', error: null } }] });
  assert.match(text(queued), /Revisando tus oportunidades…/);
});

test('the side list has a new conversation, the person\'s conversations and the chats by licitación', () => {
  const html = renderToStaticMarkup(React.createElement(AssistantSidebar, { threadId: 't1', onNew: noop, onPick: noop, onDelete: noop, onOpportunity: noop,
    data: { available: true, threads: [{ id: 't1', title: 'Cierres de la semana', updated_at: '' }, { id: 't2', title: 'Garantías', updated_at: '' }],
      opportunities: [{ id: 'o1', title: 'Aseo Hospital de Castro', updated_at: '' }] } }));
  assert.match(html, /<nav aria-label="Conversaciones del asistente"/);
  assert.match(text(html), /Nueva conversación/);
  assert.match(html, /aria-current="true"[^>]*>.*Cierres de la semana/);
  assert.match(html, /aria-label="Borrar «Garantías»"/);
  assert.match(text(html), /Por licitación .*Aseo Hospital de Castro/);
  const empty = renderToStaticMarkup(React.createElement(AssistantSidebar, { threadId: null, onNew: noop, onPick: noop, onDelete: noop, onOpportunity: noop,
    data: { available: true, threads: [], opportunities: [] } }));
  assert.match(text(empty), /Tus conversaciones aparecerán aquí\./);
  assert.doesNotMatch(text(empty), /Por licitación/);
});

test('the page opens with the list loading and the conversation ready to write', () => {
  const html = renderToStaticMarkup(React.createElement(OpportunityAssistant, { admin: false, threadId: null, onThread: noop, onOpen: noop, onHandoff: noop }));
  assert.match(text(html), /Cargando…/);
  assert.match(html, /aria-controls="assistant-list"/, 'the list folds away on a phone');
  assert.match(text(html), /¿En qué te ayudo con tus oportunidades\?/);
});

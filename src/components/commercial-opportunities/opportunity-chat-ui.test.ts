import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const compile = async (file: string) => ts.transpileModule(await readFile(new URL(file, import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const dependencies: Record<string, unknown> = {
  'lucide-react': new Proxy({}, { get: () => 'svg' }),
  '@/components/ui/button': { Button: ({ asChild, variant, size, ...props }: any) => React.createElement('button', props) },
  '@/components/ui/markdown-text': { MarkdownText: ({ text }: { text: string }) => React.createElement('div', { 'data-markdown': '' }, text) },
  '@/components/initials-avatar': { InitialsAvatar: ({ name }: { name: string }) => React.createElement('span', { 'data-avatar': name }) },
  '@/lib/utils': { cn: (...values: unknown[]) => values.filter(Boolean).join(' ') },
};
const load = (code: string) => { const exports: any = {}; new Function('require', 'exports', code)((id: string) => (id in dependencies ? dependencies[id] : require(id)), exports); return exports; };
const { OpportunityChat, readableQuote } = load(await compile('./OpportunityChat.tsx'));
const { TeamOffice, TeamPicker, toggleTeamMember } = load(await compile('./TeamOffice.tsx'));
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/<!-- -->/g, '').replace(/\s+/g, ' ');
const chat = (props: Record<string, unknown>) => renderToStaticMarkup(React.createElement(OpportunityChat, {
  messages: [], pending: null, suggestions: ['¿Cuándo cierra?', '¿Qué garantías piden?'], documentCount: 4, busy: false, placeholder: 'Pregunta', onAsk: () => {}, ...props,
}));

test('an empty chat invites a first question with suggestions, and the composer says how to send', () => {
  const html = chat({});
  assert.match(text(html), /¿En qué te ayudo con esta oportunidad\?/);
  assert.match(html, /<button type="button"[^>]*>¿Cuándo cierra\?<\/button>/);
  assert.match(text(html), /Lee los 4 documentos del expediente/);
  assert.match(html, /role="log" aria-live="polite" aria-busy="false"/);
  assert.match(html, /<label for="op-question" class="sr-only">Escribe tu pregunta<\/label>/);
  assert.match(html, /aria-label="Enviar pregunta"[^>]*disabled=""|disabled=""[^>]*aria-label="Enviar pregunta"/, 'nothing to send yet');
  assert.match(text(chat({ documentCount: 0 })), /Aún no hay documentos/);
});

test('the question shows at once, then the answer with its sources and what to confirm', () => {
  const waiting = chat({ pending: '¿Y el plazo de consultas?' });
  assert.match(waiting, /bg-primary[^"]*">¿Y el plazo de consultas\?<\/p>/);
  assert.match(waiting, /role="status"/);
  assert.match(text(waiting), /Leyendo el expediente…/);
  assert.match(waiting, /aria-busy="true"/);
  assert.doesNotMatch(waiting, /¿En qué te ayudo/);

  const answered = chat({ messages: [{ id: 'm1', question: '¿Qué garantías piden?', answer: {
    answer: 'Piden **garantía de seriedad** por $500.000.', citations: [{ chunkId: 'c1', quote: 'Garantía de seriedad de la oferta' }, { chunkId: 'c2', quote: 'monto' }],
    missing: ['Confirma el monto en las bases'], mode: 'expedient',
  } }] });
  assert.match(answered, /data-markdown="">Piden \*\*garantía de seriedad\*\* por \$500\.000\.<\/div>/);
  assert.match(text(answered), /Para confirmar Confirma el monto en las bases/);
  assert.match(text(answered), /2 fuentes del expediente/);
  assert.match(answered, /aria-expanded="false"/, 'sources open on demand');
  assert.match(text(answered), /Copiar/);
  assert.doesNotMatch(answered, /role="status"/);
});

test('a quote taken from the record data reads as words, and plain quotes are left alone', () => {
  assert.equal(readableQuote('"deadline":"2026-06-18T15:01:00+00:00"'), 'deadline: 2026-06-18 15:01');
  assert.equal(readableQuote('{"buyer":"Municipalidad de Lo Prado","region":"RM"}'), 'buyer: Municipalidad de Lo Prado · region: RM');
  assert.equal(readableQuote('Las ofertas cierran el 16 de octubre: "a las 10:00".'), 'Las ofertas cierran el 16 de octubre: "a las 10:00".');
});

test('picking people: the first is responsible, the star moves it, and unpicking the responsible passes it on', () => {
  let team = { selected: [] as string[], responsibleId: '' };
  team = toggleTeamMember(team, 'ana');
  assert.deepEqual(team, { selected: ['ana'], responsibleId: 'ana' });
  team = toggleTeamMember(team, 'beto');
  assert.deepEqual(team, { selected: ['ana', 'beto'], responsibleId: 'ana' });
  team = toggleTeamMember(team, 'ana');
  assert.deepEqual(team, { selected: ['beto'], responsibleId: 'beto' });
  team = toggleTeamMember(team, 'beto');
  assert.deepEqual(team, { selected: [], responsibleId: '' });

  const members = [{ user_id: 'ana', name: 'Ana Pérez', role: 'admin' }, { user_id: 'beto', name: 'Beto Soto', role: 'member' }, { user_id: 'caro', name: 'Caro Díaz' }];
  const html = renderToStaticMarkup(React.createElement(TeamPicker, { members, selected: ['ana', 'beto'], responsibleId: 'beto', onChange: () => {} }));
  assert.equal((html.match(/aria-pressed="true"/g) || []).length, 3, 'two people picked and one star on');
  assert.match(html, /aria-label="Beto Soto es responsable"/);
  assert.match(html, /aria-label="Hacer responsable a Ana Pérez"/);
  assert.doesNotMatch(html, /Hacer responsable a Caro Díaz/, 'only a picked person can be responsible');
  assert.match(text(html), /Caro Díaz Miembro/);
});

test('the office seats the responsible first and says who does what in words', () => {
  const people = [{ user_id: 'ana', name: 'Ana Pérez' }, { user_id: 'beto', name: 'Beto Soto' }];
  const html = renderToStaticMarkup(React.createElement(TeamOffice, { people, responsibleId: 'beto' }));
  assert.match(text(html), /Beto Soto Responsable Ana Pérez Participa/);
  assert.match(html, /aria-label="Equipo de la oportunidad"/);
  assert.ok((html.match(/<svg[^>]*aria-hidden="true"/g) || []).length >= 2, 'the desks are decoration');
  assert.match(html, /motion-safe:animate-ghost-float/, 'it only floats when motion is allowed');
  assert.match(text(renderToStaticMarkup(React.createElement(TeamOffice, { people: [], empty: 'Sin equipo aún.' }))), /Sin equipo aún\./);
});

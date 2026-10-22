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
  '@/components/ui/button': { Button: ({ variant, size, ...props }: any) => React.createElement('button', props) },
};
const load = (code: string) => { const exports: any = {}; new Function('require', 'exports', code)((id: string) => (id in dependencies ? dependencies[id] : require(id)), exports); return exports; };
const { FitProposals } = load(await compile('./FitProposals.tsx'));
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/<!-- -->/g, '').replace(/\s+/g, ' ');
const proposals = [
  { id: 'a1', question: '¿Tienen certificación ISO 9001?', answer: 'Sí, vigente hasta 2027', actorId: 'u1', at: '2026-10-22T09:00:00Z' },
  { id: 'a2', question: '¿Una mujer ejerce la gerencia general?', answer: 'No', actorId: 'u2', at: '2026-10-22T10:00:00Z' },
];
const render = (props: Record<string, unknown> = {}) => renderToStaticMarkup(React.createElement(FitProposals, {
  proposals, admin: false, busy: false, nameOf: (id: string | null) => ({ u1: 'Luis Soto', u2: 'Ana Pérez' } as Record<string, string>)[String(id)] ?? 'Alguien', onResolve: () => undefined, ...props }));

test('nothing is shown when no answer is waiting', () => {
  assert.equal(render({ proposals: [] }), '');
});

test('the team sees what waits for an administrator and who answered, without buttons', () => {
  const html = render();
  const words = text(html);
  assert.match(html, /aria-label="Respuestas para la ficha"/);
  assert.match(words, /Tu respuesta espera a un administrador/);
  assert.match(words, /¿Tienen certificación ISO 9001\? Sí, vigente hasta 2027 Luis Soto/);
  assert.match(words, /Ana Pérez/);
  assert.doesNotMatch(words, /Confirmar|Descartar/);
});

test('an administrator gets a Confirm and a Drop for each answer, and the buttons say which one they act on', () => {
  const calls: Array<[string, boolean]> = [];
  const html = render({ admin: true, onResolve: (id: string, accept: boolean) => calls.push([id, accept]) });
  const words = text(html);
  assert.match(words, /Respuestas para la ficha por confirmar/);
  assert.match(words, /Si es cierto, confírmala y pasa a la ficha/);
  assert.equal((words.match(/Confirmar/g) || []).length, 2); assert.equal((words.match(/Descartar/g) || []).length, 2);
  assert.match(render({ admin: true, busy: true }), /<button[^>]*disabled=""/);
});

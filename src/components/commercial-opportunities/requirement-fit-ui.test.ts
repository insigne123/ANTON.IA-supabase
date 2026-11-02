import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as fits from '../../lib/commercial-opportunities/requirement-fit';

const require = createRequire(import.meta.url);
const compile = async (file: string) => ts.transpileModule(await readFile(new URL(file, import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const dependencies: Record<string, unknown> = {
  'lucide-react': new Proxy({}, { get: () => 'svg' }),
  '@/lib/utils': { cn: (...names: unknown[]) => names.filter(Boolean).join(' ') },
  '@/lib/commercial-opportunities/requirement-fit': fits,
  '@/components/ui/button': { Button: ({ asChild, variant, size, children, ...props }: any) => React.createElement('button', props, children) },
  '@/components/ui/input': { Input: (props: any) => React.createElement('input', props) },
  '@/components/ui/textarea': { Textarea: (props: any) => React.createElement('textarea', props) },
};
const load = (code: string) => { const exports: any = {}; new Function('require', 'exports', code)((id: string) => (id in dependencies ? dependencies[id] : require(id)), exports); return exports; };
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/<!-- -->/g, '').replace(/\s+/g, ' ').trim();

const { FitBar } = load(await compile('./RequirementFit.tsx'));
const items = Object.fromEntries(Array.from({ length: 19 }, (_, i) => [`req:${i}`, { fit: 'missing', basis: '', question: '¿?' }]));
const latest = { items, noRestsOnRequirements: false, profileRevision: 2, createdAt: '2026-10-28T15:53:34Z' };
const view = (fit: Record<string, unknown>, props: Record<string, unknown> = {}) =>
  renderToStaticMarkup(React.createElement(FitBar, { fit: { available: true, latest, profileRevision: 2, seal: null, ...fit }, busy: false, ...props }));

test('a nearly empty profile is asked for once, with the button for an administrator (19 «falta un dato» of the ESVAL report)', () => {
  const admin = view({ progress: { answered: 0, total: 19 } }, { onProfile: () => undefined });
  assert.match(text(admin), /0 cumples · 19 faltan un dato · 0 no cumples Tu ficha para licitaciones tiene 0 de 19 datos: por eso falta un dato en casi todos los requisitos\. Complétala una vez y sirve para todas las licitaciones\. Completar ficha$/);
  const member = text(view({ progress: { answered: 3, total: 19 } }));
  assert.match(member, /tiene 3 de 19 datos: .* Pídele a un administrador que la complete en Oportunidades\.$/);
  assert.doesNotMatch(member, /Completar ficha/);
});

test('a profile mostly answered says only the count; no profile yet offers it to an administrator', () => {
  assert.doesNotMatch(text(view({ progress: { answered: 12, total: 19 } }, { onProfile: () => undefined })), /Tu ficha para licitaciones tiene|Completar ficha/);
  const none = text(view({ profileRevision: null, latest: null, progress: null }, { onProfile: () => undefined }));
  assert.equal(none, 'Con la «Ficha para licitaciones» de tu empresa, la IA te dice qué requisitos cumples y cuáles faltan. Se completa una vez y sirve para todas. Completar ficha');
  assert.match(text(view({ profileRevision: null, latest: null })), /Un administrador la completa en Oportunidades\.$/);
  assert.equal(fits.tenderProfileThin({ answered: 9, total: 19 }), true);
  assert.equal(fits.tenderProfileThin({ answered: 10, total: 19 }), false);
});

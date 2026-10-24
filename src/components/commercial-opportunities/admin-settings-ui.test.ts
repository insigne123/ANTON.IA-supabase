import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as adminSettings from '../../lib/commercial-opportunities/admin-settings';
import * as companySetup from '../../lib/commercial-opportunities/company-setup';
import * as radar from '../../lib/commercial-opportunities/workspace-radar';

const require = createRequire(import.meta.url);
const compile = async (file: string) => ts.transpileModule(await readFile(new URL(file, import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const h = React.createElement;
const pass = (tag: string) => ({ children }: { children?: React.ReactNode }) => h(tag, null, children);
const dependencies: Record<string, unknown> = {
  'next/link': ({ href, children, ...props }: any) => h('a', { href, ...props }, children),
  'lucide-react': new Proxy({}, { get: () => () => null }),
  '@/components/ui/button': { Button: ({ asChild, variant, size, children, ...props }: any) => (asChild ? children : h('button', { 'data-variant': variant, ...props }, children)) },
  '@/components/ui/input': { Input: (props: any) => h('input', props) },
  '@/components/ui/dialog': {
    Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => (open ? h('div', null, children) : null),
    DialogContent: ({ children }: { children: React.ReactNode }) => h('div', { role: 'dialog' }, children),
    DialogHeader: pass('div'), DialogTitle: pass('h2'), DialogDescription: pass('p'),
  },
  '@/lib/utils': { cn: (...values: unknown[]) => values.filter(Boolean).join(' ') },
  '@/lib/commercial-opportunities/admin-settings': adminSettings,
  '@/lib/commercial-opportunities/company-setup': companySetup,
  '@/lib/commercial-opportunities/workspace-radar': radar,
  './OpportunityFilters': { filterChip: (on: boolean) => (on ? 'chip chip-on' : 'chip') },
};
const load = (code: string) => { const exports: any = {}; new Function('require', 'exports', code)((id: string) => (id in dependencies ? dependencies[id] : require(id)), exports); return exports; };
const { AssignmentRulesDialog, RuleAssignDialog, rowsOf, rulesOf } = load(await compile('./AssignmentRules.tsx'));
const { SavedSearches } = load(await compile('./SavedSearches.tsx'));
const { CompanySetup } = load(await compile('./CompanySetup.tsx'));
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/<!-- -->/g, '').replace(/\s+/g, ' ').trim();

const ANA = '00000000-0000-4000-8000-0000000000a1', DIEGO = '00000000-0000-4000-8000-0000000000d1';
const members = [{ user_id: ANA, name: 'Ana Soto', open: 0 }, { user_id: DIEGO, name: 'Diego Paz', open: 3 }];

test('a rule reads as the dialog edits it and back: the amount as people write it, a row without a person is not a rule', () => {
  const rules = [{ id: 'r1', category: 'seguridad', minAmount: 50_000_000, userId: DIEGO }];
  assert.deepEqual(rowsOf(rules), [{ id: 'r1', category: 'seguridad', minAmount: '50.000.000', userId: DIEGO }]);
  assert.deepEqual(rulesOf([...rowsOf(rules), { category: 'aseo', minAmount: '', userId: '' }]), rules);
  assert.deepEqual(rulesOf([{ category: '', minAmount: '$ 5.000.000', userId: ANA }]), [{ category: null, minAmount: 5_000_000, userId: ANA }]);
});

test('«Asignarlas» shows what goes to each person before anyone is told', () => {
  const groups = [{ userId: DIEGO, name: 'Diego Paz', rule: { id: 'r1', category: 'seguridad', minAmount: null, userId: DIEGO }, ids: ['a', 'b'] }];
  const html = renderToStaticMarkup(h(RuleAssignDialog, { groups, titles: { a: 'Guardias para bodegas', b: 'Vigilancia del hospital' }, busy: false, onConfirm: () => {}, onCancel: () => {} }));
  assert.equal(text(html), 'Asignar 2 según tus reglas Cada persona queda como responsable de las suyas y le avisamos por correo. Diego Paz 2 Seguridad → Diego Guardias para bodegas Vigilancia del hospital Cancelar Asignar y avisar');
  assert.equal(renderToStaticMarkup(h(RuleAssignDialog, { groups: null, titles: {}, busy: false, onConfirm: () => {}, onCancel: () => {} })), '');
});

test('the rules dialog lists each person with how much they already work, and explains that nothing is assigned without confirming', () => {
  const html = renderToStaticMarkup(h(AssignmentRulesDialog, { open: true, rules: [], members, busy: false, onSave: () => {}, onCancel: () => {} }));
  assert.match(text(html), /^Reglas de asignación Quién trabaja cada rubro\. La primera regla que calce decide, y nada se asigna sin que lo confirmes con «Asignarlas»\./);
  assert.match(html, /<option value="00000000-0000-4000-8000-0000000000d1">Diego Paz · 3 en curso<\/option>/);
  assert.match(html, /<option value="seguridad">Seguridad<\/option>/);
});

const plain = { filter: 'recommended', source: 'all', query: '', categories: [] };
const searches = [{ id: 's1', name: '“guardias” · Seguridad', filter: 'recommended', source: 'all', query: 'guardias', categories: ['seguridad'], notify: [ANA], createdBy: ANA },
  { id: 's2', name: 'Hospital Regional', filter: 'all', source: 'all', query: 'Hospital Regional', categories: [], notify: [], createdBy: DIEGO }];
const saved = (props: Record<string, unknown>) => renderToStaticMarkup(h(SavedSearches, { searches: [], current: plain, userId: ANA, busy: false, onApply: () => {}, onSave: () => {}, onNotify: () => {}, onRemove: () => {}, ...props }));

test('the saved searches stay quiet on the plain list, offer to keep the filters on screen, and say which one is on', () => {
  assert.equal(saved({}), '');
  assert.match(text(saved({ current: { ...plain, query: 'guardias' } })), /^Guardar esta búsqueda$/);
  const html = saved({ searches, current: { ...plain, query: 'GUARDIAS', categories: ['seguridad'] } });
  assert.match(html, /aria-pressed="true" class="chip chip-on shrink-0"><span class="sr-only">Con aviso: <\/span>“guardias” · Seguridad<\/button>/);
  assert.match(text(html), /Te avisamos de las nuevas Quitar$/);
  assert.match(text(saved({ searches, current: { ...plain, filter: 'all', query: 'Hospital Regional' } })), /Avisarme de las nuevas Quitar$/, 'saved by someone else: Ana is not told until she asks');
});

test('«Prepara tu empresa» shows what is missing, with the only filled action on the next step, and the ticket connected in «Conexiones»', () => {
  const html = renderToStaticMarkup(h(CompanySetup, { facts: { documentKinds: ['f30', 'f30_1', 'vigencia', 'poder', 'estados_financieros'], competitors: 0, assigned: false, ticket: 'shared' }, onStep: () => {}, onHide: () => {} }));
  assert.match(text(html), /^Prepara tu empresa · 1 de 4 Ocultar Sube los documentos que piden casi todas las bases \(listo\)/);
  assert.match(html, /<a href="\/connections">Conectar el ticket<\/a>/);
  assert.equal((html.match(/data-variant="secondary"/g) || []).length, 0, 'the link of the next step is the ticket: the buttons after it stay quiet');
  const next = renderToStaticMarkup(h(CompanySetup, { facts: { documentKinds: [], competitors: 0, assigned: false, ticket: 'own' }, onStep: () => {}, onHide: () => {} }));
  assert.equal((next.match(/data-variant="secondary"/g) || []).length, 1);
  assert.match(next, /data-variant="secondary"[^>]*>Subir documentos<\/button>/);
  assert.equal(renderToStaticMarkup(h(CompanySetup, { facts: { documentKinds: ['f30', 'f30_1', 'vigencia', 'poder', 'estados_financieros'], competitors: 2, assigned: true, ticket: 'own' }, onStep: () => {}, onHide: () => {} })), '', 'all done: it goes away');
});

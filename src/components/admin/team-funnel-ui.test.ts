import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as funnels from '../../lib/team-funnel';

const require = createRequire(import.meta.url);
const compile = async (file: string) => ts.transpileModule(await readFile(new URL(file, import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const passthrough = (tag: string) => { const Plain = ({ children, ...props }: any) => React.createElement(tag, props, children); Plain.displayName = tag; return Plain; };
const dependencies: Record<string, unknown> = {
  'lucide-react': new Proxy({}, { get: () => 'svg' }),
  '@/lib/team-funnel': funnels,
  '@/lib/utils': { cn: (...names: unknown[]) => names.filter(Boolean).join(' ') },
  '@/components/ui/button': { Button: ({ asChild, variant, size, children, ...props }: any) => React.createElement('button', props, children) },
  '@/components/ui/card': { Card: passthrough('section'), CardContent: passthrough('div'), CardHeader: passthrough('div') },
  '@/components/ui/skeleton': { Skeleton: () => React.createElement('div', { 'data-skeleton': true }) },
  '@/components/ui/table': { Table: passthrough('table'), TableBody: passthrough('tbody'), TableCell: passthrough('td'), TableHead: passthrough('th'), TableHeader: passthrough('thead'), TableRow: passthrough('tr') },
};
const load = (code: string) => { const exports: any = {}; new Function('require', 'exports', code)((id: string) => (id in dependencies ? dependencies[id] : require(id)), exports); return exports; };
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/<!-- -->/g, '').replace(/\s+/g, ' ').trim();

const { TeamFunnelView } = load(await compile('./TeamFunnelCard.tsx'));
const people = [
  { userId: 'u1', name: 'Ana Rojas', funnel: { saved: 10, withEmail: 9, researched: 9, drafts: 9, contacted: 2, conversations: 1 } },
  { userId: 'u2', name: 'Leo Soto', funnel: { saved: 8, withEmail: 8, researched: 8, drafts: 8, contacted: 1, conversations: 0 } },
  { userId: 'u3', name: 'Pía Mella', funnel: { ...funnels.EMPTY_FUNNEL } },
];
const total = people.reduce((sum, person) => funnels.addFunnels(sum, person.funnel), { ...funnels.EMPTY_FUNNEL });
const view = (props: Record<string, unknown>) => renderToStaticMarkup(React.createElement(TeamFunnelView, { data: { from: '2026-10-01', to: '2026-10-31', total, people }, loading: false, error: '', single: false, onRetry: () => undefined, ...props }));

test('Administración shows the team\'s steps, where most of it stops and each person, with who did nothing', () => {
  const html = view({});
  const words = text(html);
  assert.match(words, /^El trabajo, paso a paso 2 de 2 personas se frenan al enviar: tienen borradores, pero no los envían\./);
  assert.match(words, /18 Guardados 17 Con correo 17 Investigados 17 Borradores 3 Contactados \(aquí se frena\) 1 Conversaciones/);
  assert.match(words, /Persona Guardados Con correo Investigados Borradores Contactados Conversaciones Dónde se frena Ana Rojas 10 9 9 9 2 1 Al enviar \(7\) Leo Soto 8 8 8 8 1 0 Al enviar \(7\) Pía Mella 0 0 0 0 0 0 Sin actividad/);
  assert.match(html, /aria-labelledby="team-funnel-title"/);
  assert.match(html, /bg-cw-warning-soft/);
});

test('one person shows no table, a period with no work says so, and an error offers to retry', () => {
  const single = view({ single: true, data: { from: 'a', to: 'b', total: people[0].funnel, people: [people[0]] } });
  assert.doesNotMatch(single, /<table/);
  assert.match(text(single), /Se frena al enviar: 7 borradores sin enviar\./);
  const empty = text(view({ data: { from: 'a', to: 'b', total: funnels.EMPTY_FUNNEL, people: [people[2]] } }));
  assert.equal(empty, 'El trabajo, paso a paso En este período nadie guardó, escribió ni llamó a un contacto.');
  const failed = text(view({ data: null, error: 'No pudimos leer.' }));
  assert.equal(failed, 'No pudimos leer. Reintentar');
});

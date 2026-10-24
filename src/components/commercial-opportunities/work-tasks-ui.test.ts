import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import * as workTasks from '@/lib/commercial-opportunities/work-tasks';

// «Plan y tareas», «Mis tareas» and «Convertir el plan en tareas» (OPP-21, OPP-27), with the design system reduced to plain elements.
const require = createRequire(import.meta.url);
const h = React.createElement;
const RadioChange = React.createContext<((value: string) => void) | null>(null);
const dependencies: Record<string, unknown> = {
  'lucide-react': new Proxy({}, { get: () => () => null }),
  '@/lib/utils': { cn: (...values: unknown[]) => values.filter(Boolean).join(' ') },
  '@/lib/commercial-opportunities/work-tasks': workTasks,
  '@/components/ui/button': { Button: ({ variant, size: _size, ...props }: any) => h('button', { ...props, 'data-variant': variant ?? 'default' }) },
  '@/components/ui/input': { Input: (props: any) => h('input', props) },
  '@/components/ui/checkbox': { Checkbox: ({ checked, onCheckedChange, className: _className, ...props }: any) =>
    h('input', { type: 'checkbox', checked: Boolean(checked), onChange: (event: any) => onCheckedChange?.(event.target.checked), ...props }) },
  '@/components/ui/empty-state': { EmptyState: ({ title, description }: any) => h('div', { 'data-empty': true }, h('h2', null, title), h('p', null, description)) },
  '@/components/ui/dropdown-menu': {
    DropdownMenu: ({ children }: any) => h(React.Fragment, null, children), DropdownMenuTrigger: ({ children }: any) => children,
    DropdownMenuContent: ({ children }: any) => h('div', { role: 'menu' }, children), DropdownMenuSeparator: () => h('hr'),
    DropdownMenuItem: ({ children, onSelect }: any) => h('button', { type: 'button', role: 'menuitem', onClick: () => onSelect?.() }, children),
    DropdownMenuRadioGroup: ({ children, onValueChange }: any) => h(RadioChange.Provider, { value: onValueChange }, h('div', { role: 'radiogroup' }, children)),
    DropdownMenuRadioItem: ({ children, value }: any) => { const change = React.useContext(RadioChange); return h('button', { type: 'button', role: 'menuitemradio', onClick: () => change?.(value) }, children); },
  },
  '@/components/ui/dialog': {
    Dialog: ({ open, children }: any) => (open ? h('div', null, children) : null), DialogContent: ({ children }: any) => h('div', { role: 'dialog' }, children),
    DialogHeader: ({ children }: any) => h('div', null, children), DialogTitle: ({ children }: any) => h('h2', null, children), DialogDescription: ({ children }: any) => h('p', null, children),
  },
};
async function load(file: string) {
  const code = ts.transpileModule(await readFile(new URL(file, import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const exports: any = {};
  new Function('require', 'exports', code)((id: string) => (id in dependencies ? dependencies[id] : require(id)), exports);
  return exports;
}
const { OpportunityTasks } = await load('./OpportunityTasks.tsx');
const { MyTasks } = await load('./MyTasks.tsx');
const { PlanTasksDialog } = await load('./PlanTasksDialog.tsx');
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

const NOW = new Date('2026-10-24T12:00:00.000Z');
const PEOPLE = [{ user_id: 'diego', name: 'Diego Fuentes' }, { user_id: 'maria', name: 'María José Pérez' }];
const task = (id: string, title: string, due: string | null, status = 'pending', owner: string | null = 'diego') =>
  ({ id, title, owner_id: owner, due_at: due, status, evidence: '', created_by: 'admin', updated_at: '2026-10-23T12:00:00.000Z' });
const TASKS = [task('t1', 'Firmar la declaración', workTasks.dueAtOfDay('2026-10-30')), task('t2', 'Pedir referencias', workTasks.dueAtOfDay('2026-10-22'), 'working', 'maria'),
  task('t3', 'Revisar las bases', null, 'blocked', null), task('t4', 'Pedir el certificado', workTasks.dueAtOfDay('2026-10-20'), 'done')];
const noop = async () => undefined;
const tasksProps = (props: Record<string, unknown> = {}) => ({ tasks: TASKS, people: PEOPLE, busy: false, planLeft: 0, canDelete: () => true, now: NOW,
  onPlan: () => {}, onCreate: () => {}, onEdit: () => {}, onStatus: noop, onOwner: () => {}, onDelete: () => {}, ...props });

async function mount(element: React.ReactElement) {
  const dom = new JSDOM('<div id="root"></div>');
  const previous = { window: globalThis.window, document: globalThis.document };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(dom.window.document.getElementById('root')!);
  await act(async () => root.render(element));
  const doc = dom.window.document;
  const click = (element: Element) => act(async () => { element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  const byLabel = (label: string) => doc.querySelector(`[aria-label="${label}"]`) as HTMLInputElement;
  const fill = (field: HTMLInputElement, value: string) => act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
  const done = async () => { await act(async () => root.unmount()); Object.assign(globalThis, previous); };
  return { doc, click, byLabel, fill, render: (next: React.ReactElement) => act(async () => root.render(next)), done };
}

test('«Plan y tareas»: what is to do by its day, a late one in red, the stage when it is not pending, and what is done folded apart', () => {
  const html = renderToStaticMarkup(h(OpportunityTasks, tasksProps()));
  assert.match(text(html), /^Plan de trabajo 3 por hacer Crear tarea/);
  const rows = [...html.matchAll(/<li[^>]*>.*?<\/li>/g)].map(match => text(match[0]));
  assert.deepEqual(rows.map(row => row.split(' Venció')[0].split(' Vence')[0].split(' Bloqueada')[0]), ['Pedir referencias', 'Firmar la declaración', 'Revisar las bases']);
  assert.match(rows[0], /Venció el 22 de octubre En curso María José Pérez/);
  assert.match(html, /class="font-medium text-destructive">Venció el 22 de octubre</);
  assert.match(rows[1], /Vence el 30 de octubre Diego Fuentes/);
  assert.match(rows[2], /Bloqueada Sin responsable/);
  assert.match(text(html), /Hechas · 1$/, 'the done one is folded');
  assert.doesNotMatch(text(html), /Pedir el certificado/);
});

test('with a report and no tasks, turning the plan into tasks is the one main action; after, the plan steps left are a second one', () => {
  const empty = renderToStaticMarkup(h(OpportunityTasks, tasksProps({ tasks: [], planLeft: 4 })));
  assert.match(empty, /data-variant="default"[^>]*>Convertir el plan en tareas</);
  assert.match(empty, /data-variant="ghost"[^>]*>Crear tarea</);
  assert.match(text(empty), /El informe trae un plan de trabajo: conviértelo en tareas/);
  const some = renderToStaticMarkup(h(OpportunityTasks, tasksProps({ planLeft: 2 })));
  assert.match(some, /data-variant="outline"[^>]*>Agregar 2 pasos del plan</);
  assert.match(some, /data-variant="outline"[^>]*>Crear tarea</);
  const none = renderToStaticMarkup(h(OpportunityTasks, tasksProps({ tasks: [] })));
  assert.match(text(none), /Crea la primera tarea\. Cuando generes el informe/);
  assert.doesNotMatch(none, /Convertir el plan/);
});

test('a tick marks it done at once, the owner changes from the row, and deleting shows only to whoever may', async () => {
  const calls: unknown[] = [];
  const view = await mount(h(OpportunityTasks, tasksProps({ canDelete: (item: { id: string }) => item.id !== 't2',
    onStatus: async (item: { id: string }, status: string) => { calls.push(['status', item.id, status]); }, onOwner: (item: { id: string }, owner: string | null) => calls.push(['owner', item.id, owner]),
    onEdit: (item: { id: string }) => calls.push(['edit', item.id]) })));
  try {
    await view.click(view.byLabel('Marcar «Firmar la declaración» como hecha'));
    assert.deepEqual(calls, [['status', 't1', 'done']]);
    assert.match(view.doc.body.textContent || '', /Hechas · 2/, 'it moves to the done ones before the list is read again');
    const row = [...view.doc.querySelectorAll('li')].find(item => item.textContent?.startsWith('Pedir referencias'))!;
    await view.click([...row.querySelectorAll('[role="menuitemradio"]')].find(item => item.textContent === 'Diego Fuentes')!);
    await view.click([...row.querySelectorAll('[role="menuitem"]')].find(item => item.textContent === 'Volver a pendiente')!);
    await view.click([...row.querySelectorAll('[role="menuitem"]')].find(item => item.textContent === 'Editar')!);
    assert.deepEqual(calls.slice(1), [['owner', 't2', 'diego'], ['status', 't2', 'pending'], ['edit', 't2']]);
    assert.equal([...row.querySelectorAll('[role="menuitem"]')].some(item => item.textContent === 'Eliminar'), false, 'not theirs to delete');
  } finally { await view.done(); }
});

test('«Mis tareas»: loading, a failure with retry, nothing to do, and the groups with their opportunity one click away', async () => {
  assert.match(text(renderToStaticMarkup(h(MyTasks, { tasks: null, error: '', busy: false, onOpen: () => {}, onDone: noop, onRetry: () => {} }))), /Cargando tus tareas…/);
  assert.match(renderToStaticMarkup(h(MyTasks, { tasks: null, error: 'Sin conexión.', busy: false, onOpen: () => {}, onDone: noop, onRetry: () => {} })), /role="alert".*Sin conexión\..*Reintentar/);
  assert.match(text(renderToStaticMarkup(h(MyTasks, { tasks: [], error: '', busy: false, onOpen: () => {}, onDone: noop, onRetry: () => {} }))), /No tienes tareas pendientes/);
  const mine = TASKS.slice(0, 3).map(item => ({ ...item, opportunity: { id: `o-${item.id}`, title: `Licitación ${item.id}`, kind: 'tender', deadline_at: null } }));
  const calls: unknown[] = [];
  const view = await mount(h(MyTasks, { tasks: mine, error: '', busy: false, now: NOW, onOpen: (id: string) => calls.push(['open', id]), onDone: async (item: { id: string }) => { calls.push(['done', item.id]); }, onRetry: () => {} }));
  try {
    assert.deepEqual([...view.doc.querySelectorAll('h2')].map(item => item.textContent), ['Vencidas 1', 'Próximos 7 días 1', 'Sin fecha 1']);
    await view.click([...view.doc.querySelectorAll('button')].find(item => item.textContent === 'Licitación t1')!);
    await view.click(view.byLabel('Marcar «Pedir referencias» como hecha'));
    assert.deepEqual(calls, [['open', 'o-t1'], ['done', 't2']]);
    assert.deepEqual([...view.doc.querySelectorAll('h2')].map(item => item.textContent), ['Próximos 7 días 1', 'Sin fecha 1'], 'the one done leaves the list');
  } finally { await view.done(); }
});

test('the plan preview: the steps already in the list come unticked, every field can be corrected, and only the ticked ones are created', async () => {
  const drafts = workTasks.planTaskDrafts([{ title: 'Pedir referencias', due: '27-10-2026' }, { title: 'Calcular el precio' }, { title: 'Firmar la declaración', role: 'María' }],
    { deadline: '2026-11-06T15:00:00.000Z', now: NOW, responsibleId: 'diego', people: PEOPLE, existing: ['Firmar la declaración'] });
  const confirmed: unknown[] = [];
  const view = await mount(h(PlanTasksDialog, { open: true, drafts, people: PEOPLE, closeLabel: '6 de noviembre', busy: false, onConfirm: (tasks: unknown) => confirmed.push(tasks), onCancel: () => {} }));
  try {
    assert.match(view.doc.body.textContent || '', /las fechas llegan hasta el cierre, el 6 de noviembre\./);
    assert.equal(view.byLabel('Incluir «Firmar la declaración»').checked, false);
    assert.match(view.doc.body.textContent || '', /Ya está en la lista de tareas\./);
    const submit = () => [...view.doc.querySelectorAll('button[type="submit"]')][0] as HTMLButtonElement;
    assert.equal(submit().textContent, 'Crear 2 tareas');
    await view.fill(view.byLabel('Paso 2'), 'Calcular el precio por persona');
    await view.click(view.byLabel('Incluir «Pedir referencias»'));
    assert.equal(submit().textContent, 'Crear 1 tarea');
    await act(async () => { view.doc.querySelector('form')!.dispatchEvent(new view.doc.defaultView!.Event('submit', { bubbles: true, cancelable: true })); });
    assert.deepEqual(confirmed, [[{ title: 'Calcular el precio por persona', ownerId: 'diego', dueAt: workTasks.dueAtOfDay(drafts[1].day), evidence: '' }]]);
  } finally { await view.done(); }
});

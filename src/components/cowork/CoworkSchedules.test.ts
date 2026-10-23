import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import * as presentation from '@/lib/cowork/presentation';
import * as schedules from '@/lib/cowork/schedules';
import * as hint from '@/lib/cowork/schedule-hint';

const require = createRequire(import.meta.url);
const source = await readFile(new URL('./CoworkSchedules.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
} }).outputText;

const h = React.createElement;
const pass = (tag: string) => ({ children, ...props }: Record<string, unknown>) => h(tag, props.className ? { className: props.className } : {}, children as React.ReactNode);
const dependencies: Record<string, unknown> = {
  'lucide-react': new Proxy({}, { get: () => () => null }),
  '@/lib/cowork/presentation': presentation,
  '@/lib/cowork/schedules': schedules,
  '@/lib/cowork/schedule-hint': hint,
  '@/lib/utils': { cn: (...values: unknown[]) => values.filter(Boolean).join(' ') },
  // The dialog and the menu without portals: what matters here is what they hold.
  '@/components/ui/dialog': {
    Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? h('div', null, children) : null,
    DialogContent: ({ children }: { children: React.ReactNode }) => h('div', { role: 'dialog' }, children),
    DialogTitle: pass('h2'), DialogDescription: pass('p'),
  },
  '@/components/ui/dropdown-menu': {
    DropdownMenu: ({ children }: { children: React.ReactNode }) => h('div', null, children),
    DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => children,
    DropdownMenuContent: ({ children }: { children: React.ReactNode }) => h('div', { role: 'menu' }, children),
    DropdownMenuItem: ({ children, onSelect, disabled }: { children: React.ReactNode; onSelect?: () => void; disabled?: boolean }) =>
      h('button', { type: 'button', role: 'menuitem', disabled, onClick: onSelect }, children),
  },
  './ui': { CwButton: ({ variant: _variant, size: _size, ...props }: Record<string, unknown>) => h('button', { type: 'button', ...props }) },
};
const exports: any = {};
new Function('require', 'exports', code)((id: string) => id in dependencies ? dependencies[id] : require(id), exports);
const { CoworkSchedules, coworkScheduleLastRun, coworkScheduleStatusLine } = exports as {
  CoworkSchedules: React.ComponentType<Record<string, unknown>>;
  coworkScheduleLastRun: (iso: string, now?: Date) => string;
  coworkScheduleStatusLine: (task: Record<string, unknown>, now?: Date) => string;
};

const task = (overrides: Record<string, unknown> = {}) => ({
  id: '00000000-0000-4000-8000-000000000101', title: 'Resumen del lunes', prompt: 'Dime quién respondió esta semana y a quién escribir hoy.',
  frequency: 'weekly', time: '09:00', weekday: 1, monthDay: null, timeZone: 'America/Santiago', description: 'Los lunes a las 09:00', status: 'active',
  nextRunAt: '2026-11-02T12:00:00.000Z', lastRunAt: null, lastStatus: null, runCount: 0, ...overrides,
});
const NOW = new Date('2026-10-26T15:00:00Z');

test('the line under a task says when it fires next, or why it does not, and what happened last time', () => {
  assert.equal(coworkScheduleStatusLine(task(), NOW), 'Próxima: lunes 2 de noviembre, 09:00');
  // «Última vez» is in the clock of whoever reads it (the browser's).
  assert.equal(coworkScheduleStatusLine(task({ lastStatus: 'admitted', lastRunAt: '2026-10-26T12:00:05.000Z' }), new Date('2026-10-26T12:30:00Z')),
    `Próxima: lunes 2 de noviembre, 09:00 · Última vez: hoy a las ${new Date('2026-10-26T12:00:05.000Z').toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hour12: false })}`);
  assert.equal(coworkScheduleStatusLine(task({ status: 'paused', nextRunAt: null }), NOW), 'Pausada');
  assert.equal(coworkScheduleStatusLine(task({ lastStatus: 'skipped' }), NOW), 'Próxima: lunes 2 de noviembre, 09:00 · La última vez se omitió: el sistema estaba detenido');
  assert.equal(coworkScheduleStatusLine(task({ status: 'paused', nextRunAt: null, lastStatus: 'failed' }), NOW), 'Pausada porque no pudo iniciarse tres veces seguidas');
});

test('the last run is told as a person counts it: today, yesterday, days ago, or the date', () => {
  const now = new Date('2026-10-26T12:30:00Z');
  const ago = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
  assert.match(coworkScheduleLastRun('2026-10-26T12:00:05.000Z', now), /^hoy a las \d\d:\d\d$/);
  assert.equal(coworkScheduleLastRun(ago(1), now), 'ayer');
  assert.equal(coworkScheduleLastRun(ago(4), now), 'hace 4 días');
  assert.equal(coworkScheduleLastRun(ago(6), now), 'hace 6 días');
  assert.equal(coworkScheduleLastRun(ago(20), now), 'el 6 de octubre');
});

type Call = { url: string; method: string; body: any };
async function mount(options: { initialPrompt?: string; list?: unknown; failList?: boolean; respond?: (call: Call) => { status?: number; body: unknown } } = {}) {
  const dom = new JSDOM('<div id="root"></div>');
  const previous = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch };
  const calls: Call[] = [];
  Object.assign(globalThis, {
    window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (url: string, init: RequestInit = {}) => {
      const call = { url, method: init.method || 'GET', body: init.body ? JSON.parse(String(init.body)) : undefined };
      calls.push(call);
      const answer = call.method === 'GET' && url === '/api/cowork/schedules'
        ? (options.failList ? { status: 503, body: { error: 'No pudimos leer tus tareas programadas.' } } : { body: { enabled: true, tasks: options.list ?? [], limits: { active: 5 } } })
        : options.respond?.(call) ?? { body: {} };
      return { ok: (answer.status ?? 200) < 400, status: answer.status ?? 200, json: async () => answer.body };
    },
  });
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(dom.window.document.getElementById('root')!);
  const started: string[] = [];
  await act(async () => root.render(h(CoworkSchedules, { open: true, onOpenChange: () => {}, onStarted: () => started.push('started'), initialPrompt: options.initialPrompt })));
  const doc = dom.window.document;
  const text = () => doc.body.textContent || '';
  const button = (label: string | RegExp) => Array.from(doc.querySelectorAll('button')).find(item => typeof label === 'string' ? item.textContent === label : label.test(item.textContent || ''))!;
  const type = async (element: Element, value: string) => act(async () => {
    const prototype = element instanceof dom.window.HTMLTextAreaElement ? dom.window.HTMLTextAreaElement.prototype : element instanceof dom.window.HTMLSelectElement ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new dom.window.Event(element instanceof dom.window.HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
  const done = async () => { await act(async () => root.unmount()); Object.assign(globalThis, previous); };
  return { doc, text, button, type, calls, started, done };
}

test('without tasks the panel explains what they are and offers the one thing to do', async () => {
  const view = await mount();
  try {
    assert.match(view.text(), /Todavía no programaste nada/);
    assert.match(view.text(), /nada se envía sin tu aprobación/);
    assert.ok(view.button('Nueva tarea'));
    assert.doesNotMatch(view.text(), /activas/);
  } finally { await view.done(); }
});

test('a list that could not be read says so, with «Reintentar»', async () => {
  const view = await mount({ failList: true });
  try {
    assert.match(view.text(), /No pudimos leer tus tareas programadas\./);
    assert.ok(view.button(/Reintentar/));
    assert.doesNotMatch(view.text(), /Todavía no programaste nada/);
  } finally { await view.done(); }
});

test('each task shows its name, its schedule and when it fires next; the count of active ones is told', async () => {
  const view = await mount({ list: [task(), task({ id: '00000000-0000-4000-8000-000000000102', title: 'Respuestas de la mañana', description: 'De lunes a viernes a las 08:30', status: 'paused', nextRunAt: null })] });
  try {
    assert.match(view.text(), /Resumen del lunes/);
    assert.match(view.text(), /Los lunes a las 09:00/);
    assert.match(view.text(), /Próxima: lunes 2 de noviembre, 09:00/);
    assert.match(view.text(), /Respuestas de la mañana/);
    assert.match(view.text(), /1 de 5 activas/);
    assert.match(view.text(), /Pausada/);
  } finally { await view.done(); }
});

test('a new task is checked, sent without the day that does not belong to its frequency, and listed with what was understood', async () => {
  const view = await mount({ respond: call => call.method === 'POST' ? { status: 201, body: { task: task({ id: '00000000-0000-4000-8000-000000000103', title: 'Resumen del lunes' }) } } : { body: {} } });
  try {
    await act(async () => view.button('Nueva tarea').click());
    const title = view.doc.querySelector<HTMLInputElement>('input[maxlength="80"]')!;
    const prompt = view.doc.querySelector<HTMLTextAreaElement>('textarea')!;
    await act(async () => view.button('Programar').click());
    assert.match(view.text(), /Ponle un nombre de al menos 3 letras\./);
    await view.type(title, 'Resumen del lunes');
    await act(async () => view.button('Programar').click());
    assert.match(view.text(), /Escribe el pedido completo/);
    await view.type(prompt, 'Dime quién respondió esta semana y a quién escribir hoy.');
    const frequency = view.doc.querySelector<HTMLSelectElement>('select')!;
    await view.type(frequency, 'daily');
    assert.equal(view.doc.querySelectorAll('select').length, 1, 'a daily task asks for no day');
    await view.type(frequency, 'weekly');
    assert.equal(view.doc.querySelectorAll('select').length, 2, 'a weekly one asks for the day');
    await act(async () => view.button('Programar').click());
    const post = view.calls.find(call => call.method === 'POST')!;
    assert.equal(post.url, '/api/cowork/schedules');
    assert.deepEqual(post.body, { title: 'Resumen del lunes', prompt: 'Dime quién respondió esta semana y a quién escribir hoy.', frequency: 'weekly', time: '09:00', weekday: 1 });
    assert.match(view.text(), /Programada: los lunes a las 09:00\./);
    assert.match(view.text(), /Resumen del lunes/);
    assert.ok(view.button('Nueva tarea'), 'back to the list');
  } finally { await view.done(); }
});

test('a refusal of the server stays in the form with its reason', async () => {
  const view = await mount({ respond: call => call.method === 'POST' ? { status: 409, body: { error: 'Ya tienes 5 tareas programadas activas. Pausa o elimina una para activar otra.' } } : { body: {} } });
  try {
    await act(async () => view.button('Nueva tarea').click());
    await view.type(view.doc.querySelector('input[maxlength="80"]')!, 'Resumen');
    await view.type(view.doc.querySelector('textarea')!, 'Dime quién respondió esta semana.');
    await act(async () => view.button('Programar').click());
    assert.match(view.text(), /Ya tienes 5 tareas programadas activas/);
    assert.ok(view.button('Programar'), 'the form is still there to fix or cancel');
  } finally { await view.done(); }
});

test('with the five active tasks the panel says so and does not offer a sixth', async () => {
  const list = [1, 2, 3, 4, 5].map(n => task({ id: `00000000-0000-4000-8000-0000000002${n}0`, title: `Tarea ${n}` }));
  const view = await mount({ list });
  try {
    assert.match(view.text(), /Tienes 5 tareas activas, el máximo/);
    assert.equal((view.button('Nueva tarea') as HTMLButtonElement).disabled, true);
  } finally { await view.done(); }
});

test('pause, run now and delete act on the task of the row', async () => {
  const id = '00000000-0000-4000-8000-000000000101';
  const view = await mount({
    list: [task()],
    respond: call => call.method === 'PATCH' ? { body: { task: task({ status: 'paused', nextRunAt: null }) } } : call.method === 'POST' ? { status: 202, body: { runId: 'run-1' } } : { body: { deleted: true } },
  });
  try {
    await act(async () => view.button('Pausar').click());
    assert.deepEqual(view.calls.find(call => call.method === 'PATCH'), { url: `/api/cowork/schedules/${id}`, method: 'PATCH', body: { enabled: false } });
    assert.match(view.text(), /En pausa: no se ejecutará hasta que la reanudes\./);
    await act(async () => view.button('Ejecutar ahora').click());
    assert.equal(view.calls.find(call => call.method === 'POST')!.url, `/api/cowork/schedules/${id}/run`);
    assert.deepEqual(view.started, ['started'], 'the list of conversations is told to refresh');
    assert.match(view.text(), /Empezó: la conversación aparece en tu lista/);
    await act(async () => view.button('Eliminar').click());
    assert.match(view.text(), /Sí, eliminar/);
    assert.equal(view.calls.some(call => call.method === 'DELETE'), false, 'asks first');
    await act(async () => view.button('Sí, eliminar').click());
    assert.equal(view.calls.find(call => call.method === 'DELETE')!.url, `/api/cowork/schedules/${id}`);
    assert.match(view.text(), /Eliminada\./);
  } finally { await view.done(); }
});

test('editing opens the form with the task and saves only through PATCH', async () => {
  const id = '00000000-0000-4000-8000-000000000101';
  const view = await mount({ list: [task()], respond: call => call.method === 'PATCH' ? { body: { task: task({ title: 'Otro nombre' }) } } : { body: {} } });
  try {
    await act(async () => view.button('Editar').click());
    const title = view.doc.querySelector<HTMLInputElement>('input[maxlength="80"]')!;
    assert.equal(title.value, 'Resumen del lunes');
    await view.type(title, 'Otro nombre');
    await act(async () => view.button('Guardar cambios').click());
    const patch = view.calls.find(call => call.method === 'PATCH')!;
    assert.equal(patch.url, `/api/cowork/schedules/${id}`);
    assert.equal(patch.body.title, 'Otro nombre');
    assert.equal(patch.body.weekday, 1);
    assert.match(view.text(), /Listo, guardé los cambios\./);
    assert.match(view.text(), /Otro nombre/);
  } finally { await view.done(); }
});

test('«Programar este pedido» opens the form with the request and the when it already says, ready to confirm', async () => {
  const view = await mount({ initialPrompt: 'Cada lunes a las 9, dime a quién escribir hoy',
    respond: call => call.method === 'POST' ? { status: 201, body: { task: task({ title: 'Dime a quién escribir hoy' }) } } : { body: {} } });
  try {
    assert.equal(view.doc.querySelector<HTMLInputElement>('input[maxlength="80"]')!.value, 'Dime a quién escribir hoy');
    assert.equal(view.doc.querySelector<HTMLTextAreaElement>('textarea')!.value, 'Cada lunes a las 9, dime a quién escribir hoy', 'the request as it was typed');
    assert.equal(view.doc.querySelector<HTMLSelectElement>('select')!.value, 'weekly');
    assert.equal(view.doc.querySelector<HTMLInputElement>('input[type="time"]')!.value, '09:00');
    assert.match(view.text(), /Nueva tarea programada|Qué debe hacer/);
    await act(async () => view.button('Programar').click());
    assert.deepEqual(view.calls.find(call => call.method === 'POST')!.body, {
      title: 'Dime a quién escribir hoy', prompt: 'Cada lunes a las 9, dime a quién escribir hoy', frequency: 'weekly', time: '09:00', weekday: 1,
    });
  } finally { await view.done(); }
});

test('a request that does not say when opens the form on Mondays at nine, and a request too short to do anything with is asked for again', async () => {
  const view = await mount({ initialPrompt: 'Revisa' });
  try {
    assert.equal(view.doc.querySelector<HTMLSelectElement>('select')!.value, 'weekly');
    assert.equal(view.doc.querySelector<HTMLInputElement>('input[type="time"]')!.value, '09:00');
    await act(async () => view.button('Programar').click());
    assert.match(view.text(), /Escribe el pedido completo/, 'ten characters or more, as the server asks');
    assert.equal(view.calls.some(call => call.method === 'POST'), false);
  } finally { await view.done(); }
});

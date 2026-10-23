import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

// The routes of scheduled tasks with Cowork's access and the tasks in memory: who they act for, what they answer while the feature is off and what each failure says.
const require = createRequire(import.meta.url);
// The routes are bundled as CommonJS, so the error they check with instanceof has to come from the same copy of zod.
const { ZodError } = require('zod') as typeof import('zod');

class FakeScheduleError extends Error { constructor(readonly code: string, message: string) { super(message); } }
class FakeAuthError extends Error {}
Object.assign(globalThis, { __CoworkScheduleError: FakeScheduleError, __AuthError: FakeAuthError });

const SCHEDULES_STUB = `
export const CoworkScheduleError = globalThis.__CoworkScheduleError;
export const coworkSchedulesEnabled = () => globalThis.__enabled;
export const listCoworkSchedules = (...args) => globalThis.__do('list', args);
export const createCoworkSchedule = (...args) => globalThis.__do('create', args);
export const updateCoworkSchedule = (...args) => globalThis.__do('update', args);
export const deleteCoworkSchedule = (...args) => globalThis.__do('delete', args);
export const runCoworkScheduleNow = (...args) => globalThis.__do('run', args);`;

const stubs: Record<string, string> = {
  'next/server': 'export const NextResponse = { json: (body, init = {}) => ({ body, status: init.status ?? 200 }) };',
  '@/lib/server/cowork/access': 'export async function requireCoworkAccess(){ if (globalThis.__auth) throw globalThis.__auth; return { user: { id: "user-1" }, organizationId: "org-1", supabase: { session: true } } }',
  '@/lib/server/auth-utils': 'export const AuthError = globalThis.__AuthError; export function handleAuthError(){ return { body: { error: "auth" }, status: 401 } }',
  '@/lib/server/supabase-admin': 'export function getSupabaseAdminClient(){ return { admin: true } }',
  '@/lib/server/cowork/schedules': SCHEDULES_STUB,
  './schedules': SCHEDULES_STUB,
};

async function entry(name: string) {
  const bundle = await build({
    stdin: { contents: `export * from './src/app/api/cowork/schedules/${name}';`, loader: 'ts', resolveDir: process.cwd() },
    bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external',
    plugins: [{ name: 'stubs', setup(builder) {
      builder.onResolve({ filter: /^(next\/server|@\/lib\/server\/(cowork\/access|auth-utils|supabase-admin|cowork\/schedules)|\.\/schedules)$/ }, args => ({ path: args.path, namespace: 'stub' }));
      builder.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ loader: 'js', contents: stubs[args.path] }));
    } }],
  });
  const compiled: { exports: any } = { exports: {} };
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, compiled, compiled.exports);
  return compiled.exports;
}
const load = async () => ({ collection: await entry('route'), item: await entry('[id]/route'), run: await entry('[id]/run/route') });

const request = (body: unknown) => ({ json: async () => { if (body === undefined) throw new Error('no body'); return body; } }) as never;
const params = (id = 'task-1') => ({ params: Promise.resolve({ id }) });
const calls: Array<{ op: string; args: unknown[] }> = [];
const state = globalThis as unknown as { __enabled: boolean; __auth: unknown; __do: (op: string, args: unknown[]) => unknown; __next: () => unknown };

function reset(enabled = true) {
  calls.length = 0;
  state.__enabled = enabled;
  state.__auth = null;
  state.__next = () => ({});
  state.__do = (op, args) => { calls.push({ op, args }); return Promise.resolve(state.__next()); };
}

test('while the feature is off the list answers that and the rest answer «not available», without touching the tasks', async () => {
  reset(false);
  const { collection, item, run } = await load();
  assert.deepEqual(await collection.GET(), { body: { enabled: false, tasks: [], limits: { active: 5 } }, status: 200 });
  assert.equal((await collection.POST(request({}))).status, 404);
  assert.equal((await item.PATCH(request({}), params())).status, 404);
  assert.equal((await item.DELETE(request({}), params())).status, 404);
  assert.equal((await run.POST(request({}), params())).status, 404);
  assert.deepEqual(calls, []);
});

test('the list is read with the person\'s own session and the task is written by the server for them, whatever the body says', async () => {
  reset();
  const { collection } = await load();
  state.__next = () => ({ available: true, tasks: [{ id: 'task-1' }] });
  assert.deepEqual(await collection.GET(), { body: { enabled: true, tasks: [{ id: 'task-1' }], limits: { active: 5 } }, status: 200 });
  assert.deepEqual(calls[0].args, [{ session: true }, { userId: 'user-1', organizationId: 'org-1' }]);
  state.__next = () => ({ id: 'task-2' });
  const created = await collection.POST(request({ title: 'x', userId: 'someone-else', organizationId: 'other-org' }));
  assert.deepEqual(created, { body: { task: { id: 'task-2' } }, status: 201 });
  assert.deepEqual(calls[1].args, [{ admin: true }, { userId: 'user-1', organizationId: 'org-1' }, { title: 'x', userId: 'someone-else', organizationId: 'other-org' }],
    'the scope is the session\'s; the module refuses the fields it does not know');
  await collection.POST(request(undefined));
  assert.equal(calls[2].args[2], null, 'a body that is not JSON reaches the module as null, which it refuses');
});

test('update, delete and run act on the task of the URL for the signed-in person', async () => {
  reset();
  const { item, run } = await load();
  state.__next = () => ({ id: 'task-9', status: 'paused' });
  assert.deepEqual(await item.PATCH(request({ enabled: false }), params('task-9')), { body: { task: { id: 'task-9', status: 'paused' } }, status: 200 });
  assert.deepEqual(calls[0], { op: 'update', args: [{ admin: true }, { userId: 'user-1', organizationId: 'org-1' }, 'task-9', { enabled: false }] });
  state.__next = () => undefined;
  assert.deepEqual(await item.DELETE(request({}), params('task-9')), { body: { deleted: true }, status: 200 });
  assert.deepEqual(calls[1].args.slice(1), [{ userId: 'user-1', organizationId: 'org-1' }, 'task-9']);
  state.__next = () => ({ runId: 'run-7' });
  assert.deepEqual(await run.POST(request({}), params('task-9')), { body: { runId: 'run-7' }, status: 202 });
});

test('each failure says what the person can do about it', async () => {
  reset();
  const { collection, item } = await load();
  const fails = (error: unknown) => { state.__do = () => Promise.reject(error); };
  fails(new ZodError([{ code: 'custom', path: ['weekday'], message: 'Una tarea semanal necesita el día de la semana' }]));
  assert.deepEqual(await collection.POST(request({})), { body: { error: 'Una tarea semanal necesita el día de la semana' }, status: 400 });
  fails(new FakeScheduleError('LIMIT', 'Ya tienes 5 tareas programadas activas.'));
  assert.deepEqual(await collection.POST(request({})), { body: { error: 'Ya tienes 5 tareas programadas activas.' }, status: 409 });
  fails(new FakeScheduleError('NOT_FOUND', 'Esa tarea programada no existe.'));
  assert.deepEqual(await item.PATCH(request({ enabled: false }), params()), { body: { error: 'Esa tarea programada no existe.' }, status: 404 });
  fails(new FakeScheduleError('UNAVAILABLE', 'Las tareas programadas todavía no están disponibles.'));
  assert.equal((await collection.GET()).status, 503);
  fails(new Error('boom'));
  assert.deepEqual(await collection.POST(request({})), { body: { error: 'No pudimos atender las tareas programadas. Inténtalo de nuevo.' }, status: 503 }, 'nothing of the failure leaks');
  state.__auth = new FakeAuthError('Cowork no está disponible');
  assert.equal((await collection.GET()).status, 401, 'without access to Cowork the answer is the one of every Cowork route');
});

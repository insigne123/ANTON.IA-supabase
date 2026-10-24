import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

// The tasks of an opportunity (workspace-tasks.ts) with the database in memory: who can have them, who hears, who can delete them, and «Mis tareas».
const bundle = await build({
  stdin: { contents: `export * from './src/lib/server/commercial-opportunities/workspace-tasks';`, loader: 'ts', resolveDir: process.cwd() },
  bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external',
  plugins: [{ name: 'stubs', setup(builder) {
    builder.onResolve({ filter: /auth-utils$|\/workspace-access$/ }, args => ({ path: args.path, namespace: 'stub' }));
    builder.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ loader: 'js', contents: args.path.endsWith('auth-utils')
      ? 'export class AuthError extends Error {constructor(message,status){super(message);this.status=status}}'
      : 'export async function assertOpportunityRead(){} export function assertOpportunityAdmin(){} export async function readableOpportunityIds(client, scope){ return scope.role === "owner" ? null : globalThis.__readable }' }));
  } }],
});
const compiled: { exports: any } = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);
const { saveOpportunityTask, createOpportunityTasks, setOpportunityTaskStatus, deleteOpportunityTask, readMyOpportunityTasks, countMyOpportunityTasks } = compiled.exports;

type Row = Record<string, any>;
/** Enough of supabase-js for these reads and writes: filters, insert (and what it returns), update, delete, upsert. */
function memory(tables: Record<string, Row[]>) {
  return {
    tables,
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = [];
      let op: 'select' | 'insert' | 'update' | 'delete' = 'select'; let values: Row | Row[] | null = null; let returning = false; let limit = Infinity;
      const list = () => (tables[table] ||= []);
      const matching = () => list().filter(row => filters.every(keep => keep(row)));
      const run = () => {
        if (op === 'insert') {
          const added = [values].flat().map(value => ({ id: randomUUID(), created_at: new Date().toISOString(), ...value }));
          list().push(...added); return returning ? added : null;
        }
        if (op === 'update') { const rows = matching(); rows.forEach(row => Object.assign(row, values)); return rows; }
        if (op === 'delete') { const rows = matching(); tables[table] = list().filter(row => !rows.includes(row)); return rows; }
        return matching().slice(0, limit).map(row => ({ ...row }));
      };
      const chain: any = {
        select: () => { returning = true; return chain; }, order: () => chain, limit: (count: number) => { limit = count; return chain; },
        eq: (column: string, value: unknown) => { filters.push(row => row[column] === value); return chain; },
        neq: (column: string, value: unknown) => { filters.push(row => row[column] !== value); return chain; },
        in: (column: string, items: unknown[]) => { filters.push(row => items.includes(row[column])); return chain; },
        insert: (rows: Row | Row[]) => { op = 'insert'; values = rows; return chain; },
        update: (change: Row) => { op = 'update'; values = change; return chain; },
        delete: () => { op = 'delete'; return chain; },
        upsert: (rows: Row | Row[], options: { onConflict: string }) => {
          const keys = options.onConflict.split(',');
          for (const value of [rows].flat()) if (!list().some(row => keys.every(key => row[key] === value[key]))) list().push({ id: randomUUID(), created_at: new Date().toISOString(), ...value });
          return Promise.resolve({ data: null, error: null });
        },
        maybeSingle: async () => ({ data: run()?.[0] ?? null, error: null }),
        single: async () => { const rows = run(); return rows?.length ? { data: rows[0], error: null } : { data: null, error: { code: 'PGRST116' } }; },
        then: (resolve: any, reject: any) => Promise.resolve({ data: run(), error: null }).then(resolve, reject),
      };
      return chain;
    },
  };
}

const ORG = 'org', OPP = 'opp', OTHER = 'otra';
const ADMIN = 'admin', DIEGO = 'diego', MARIA = 'maria', LUIS = 'luis';
const scope = (userId: string, role = 'member') => ({ organizationId: ORG, userId, role });
const world = () => memory({
  commercial_opportunities: [{ organization_id: ORG, id: OPP, title: 'Servicio de guardias', kind: 'tender', deadline_at: '2026-11-06T15:00:00.000Z' },
    { organization_id: ORG, id: OTHER, title: 'Aseo del museo', kind: 'tender', deadline_at: null }],
  opportunity_participants: [{ organization_id: ORG, opportunity_id: OPP, user_id: DIEGO }, { organization_id: ORG, opportunity_id: OPP, user_id: MARIA },
    { organization_id: ORG, opportunity_id: OTHER, user_id: DIEGO }],
  opportunity_work: [{ organization_id: ORG, opportunity_id: OPP, state: 'working', responsible_id: MARIA }, { organization_id: ORG, opportunity_id: OTHER, state: 'lost', responsible_id: DIEGO }],
  opportunity_tasks: [], opportunity_activity: [], opportunity_notifications: [],
});

test('a task goes to someone of the team, who hears about it once; an edit keeps its stage and tells only a new owner', async () => {
  const db = world();
  await assert.rejects(saveOpportunityTask(db, scope(DIEGO), OPP, { title: 'Pedir referencias', ownerId: LUIS, dueAt: null, evidence: '' }), { status: 400 });
  const created = await saveOpportunityTask(db, scope(DIEGO), OPP, { title: 'Pedir referencias', ownerId: MARIA, dueAt: '2026-10-28T15:00:00.000Z', evidence: '' });
  assert.equal(created.status, 'pending');
  assert.deepEqual(created.told.map((notice: Row) => [notice.user, notice.titles, notice.dueAt]), [[MARIA, ['Pedir referencias'], '2026-10-28T15:00:00.000Z']]);
  assert.deepEqual(db.tables.opportunity_notifications.map(row => [row.user_id, row.title, row.kind, row.event_key]), [[MARIA, 'Tarea para ti: Servicio de guardias', 'task', `task:${created.id}:${MARIA}`]]);
  db.tables.opportunity_tasks[0].status = 'working';
  // Moved to another day, same owner: nobody is told again and the stage stays.
  const edited = await saveOpportunityTask(db, scope(DIEGO), OPP, { id: created.id, title: 'Pedir las referencias', ownerId: MARIA, dueAt: '2026-10-29T15:00:00.000Z', evidence: '' });
  assert.deepEqual([edited.status, edited.moved, edited.told], ['working', false, []]);
  assert.equal(db.tables.opportunity_notifications.length, 1);
  // Given to oneself: nobody to tell.
  const mine = await saveOpportunityTask(db, scope(DIEGO), OPP, { id: created.id, title: 'Pedir las referencias', ownerId: DIEGO, dueAt: null, evidence: '' });
  assert.deepEqual(mine.told, []);
  assert.deepEqual(db.tables.opportunity_activity.map(row => row.body), ['Tarea creada: Pedir referencias', 'Tarea actualizada: Pedir las referencias', 'Tarea actualizada: Pedir las referencias']);
  await assert.rejects(saveOpportunityTask(db, scope(DIEGO), OPP, { id: randomUUID(), title: 'No existe', ownerId: null, dueAt: null, evidence: '' }), { status: 404 });
});

test('the plan becomes tasks at once: one line in the activity, and each owner told once of all theirs', async () => {
  const db = world();
  const result = await createOpportunityTasks(db, scope(ADMIN, 'owner'), OPP, [
    { title: 'Pedir referencias', ownerId: MARIA, dueAt: '2026-10-28T15:00:00.000Z', evidence: '' },
    { title: 'Calcular el precio', ownerId: MARIA, dueAt: '2026-10-27T15:00:00.000Z', evidence: 'Antes: Referencias' },
    { title: 'Firmar la declaración', ownerId: DIEGO, dueAt: null, evidence: '' },
    { title: 'Revisar las bases', ownerId: null, dueAt: null, evidence: '' },
  ]);
  assert.equal(result.created, 4);
  assert.deepEqual(result.told.map((notice: Row) => [notice.user, notice.titles.length, notice.dueAt]), [[MARIA, 2, '2026-10-27T15:00:00.000Z'], [DIEGO, 1, null]]);
  assert.deepEqual(db.tables.opportunity_notifications.map(row => [row.user_id, row.title]).sort(), [[DIEGO, 'Tarea para ti: Servicio de guardias'], [MARIA, '2 tareas para ti: Servicio de guardias']]);
  assert.deepEqual(db.tables.opportunity_activity.map(row => row.body), ['Plan convertido en 4 tareas.']);
  assert.deepEqual(db.tables.opportunity_tasks.map(row => [row.status, row.created_by]), Array(4).fill(['pending', ADMIN]));
  await assert.rejects(createOpportunityTasks(db, scope(ADMIN, 'owner'), OPP, [{ title: 'Ajena', ownerId: LUIS, dueAt: null, evidence: '' }]), { status: 400 });
});

test('a tick changes only the stage and says so in the activity; deleting is for whoever created it, is in charge or administers', async () => {
  const db = world();
  const { id } = await saveOpportunityTask(db, scope(ADMIN, 'owner'), OPP, { title: 'Firmar', ownerId: DIEGO, dueAt: null, evidence: '' });
  db.tables.opportunity_activity.length = 0;
  assert.deepEqual(await setOpportunityTaskStatus(db, scope(DIEGO), OPP, { id, status: 'done' }), { status: 'done', moved: true });
  assert.deepEqual(await setOpportunityTaskStatus(db, scope(DIEGO), OPP, { id, status: 'done' }), { status: 'done', moved: false }, 'twice is once');
  assert.deepEqual(db.tables.opportunity_activity.map(row => row.body), ['Tarea hecha: Firmar']);
  // Diego has it but did not create it, nor is he in charge: he marks it done instead.
  await assert.rejects(deleteOpportunityTask(db, scope(DIEGO), OPP, id), { status: 403 });
  // María is in charge of the opportunity.
  assert.deepEqual(await deleteOpportunityTask(db, scope(MARIA), OPP, id), { deleted: true });
  assert.equal(db.tables.opportunity_tasks.length, 0);
  assert.equal(db.tables.opportunity_activity.at(-1)!.body, 'Tarea eliminada: Firmar');
  assert.deepEqual(await deleteOpportunityTask(db, scope(MARIA), OPP, id), { deleted: false }, 'already gone');
  const own = await saveOpportunityTask(db, scope(DIEGO), OPP, { title: 'Mía', ownerId: null, dueAt: null, evidence: '' });
  assert.deepEqual(await deleteOpportunityTask(db, scope(DIEGO), OPP, own.id), { deleted: true }, 'whoever created it');
});

test('«Mis tareas»: what is still to do in the opportunities this person reads and are in play, with how many are late', async () => {
  const db = world();
  (globalThis as any).__readable = [OPP, OTHER];
  db.tables.opportunity_tasks.push(
    { id: 't1', organization_id: ORG, opportunity_id: OPP, title: 'Vencida', owner_id: DIEGO, due_at: '2026-10-22T15:00:00.000Z', status: 'pending', evidence: '' },
    { id: 't2', organization_id: ORG, opportunity_id: OPP, title: 'Próxima', owner_id: DIEGO, due_at: '2026-10-28T15:00:00.000Z', status: 'working', evidence: '' },
    { id: 't3', organization_id: ORG, opportunity_id: OPP, title: 'Hecha', owner_id: DIEGO, due_at: '2026-10-20T15:00:00.000Z', status: 'done', evidence: '' },
    { id: 't4', organization_id: ORG, opportunity_id: OPP, title: 'De María', owner_id: MARIA, due_at: null, status: 'pending', evidence: '' },
    // Of an opportunity already lost.
    { id: 't5', organization_id: ORG, opportunity_id: OTHER, title: 'Perdida', owner_id: DIEGO, due_at: null, status: 'pending', evidence: '' });
  const tasks = await readMyOpportunityTasks(db, scope(DIEGO));
  assert.deepEqual(tasks.map((task: Row) => [task.id, task.opportunity.title]), [['t1', 'Servicio de guardias'], ['t2', 'Servicio de guardias']]);
  assert.deepEqual(await countMyOpportunityTasks(db, scope(DIEGO), new Date('2026-10-24T12:00:00.000Z')), { open: 2, late: 1 });
  // Taken off the team: their tasks there are no longer theirs to read.
  (globalThis as any).__readable = [OTHER];
  assert.deepEqual(await readMyOpportunityTasks(db, scope(DIEGO)), []);
});

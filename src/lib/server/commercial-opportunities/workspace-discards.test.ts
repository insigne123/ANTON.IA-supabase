import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

// «No es para nosotros» and the list's actions on several at once, with the database in memory.
const bundle = await build({
  stdin: { contents: `export * from './src/lib/server/commercial-opportunities/workspace-discards';`, loader: 'ts', resolveDir: process.cwd() },
  bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external',
  plugins: [{ name: 'stubs', setup(builder) {
    builder.onResolve({ filter: /^\.\/(workspace-store|workspace-access)$|auth-utils$/ }, args => ({ path: args.path, namespace: 'stub' }));
    builder.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ loader: 'js', contents: args.path.includes('auth-utils')
      ? 'export class AuthError extends Error { constructor(message, status) { super(message); this.status = status; } }'
      : args.path === './workspace-access'
        ? 'export function assertOpportunityAdmin(scope) { if (!["owner","admin"].includes(scope.role)) { const e = new Error("Esta acción corresponde a un administrador."); e.status = 403; throw e; } }'
        : `export function opportunityDb(r) { if (r && r.error) throw r.error; return r ? r.data : null }
           export async function assignOpportunity(client, scope, id, input) { globalThis.__assigned.push({ id, input }); if (id === globalThis.__conflict) throw new Error('changed'); return 1 }` }));
  } }],
});
const compiled: { exports: any } = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);
const { discardOpportunities, moveOpportunities, assignOpportunities, bulkSchema } = compiled.exports;

type Row = Record<string, any>;
function memory(tables: Record<string, Row[]>) {
  const from = (table: string) => {
    const rows = (tables[table] ||= []);
    let filters: Array<(row: Row) => boolean> = []; let action: { kind: string; values?: any; ignore?: boolean } | null = null; let returning = false;
    const matched = () => rows.filter(row => filters.every(filter => filter(row)));
    const run = () => {
      if (action?.kind === 'upsert') {
        const list = Array.isArray(action.values) ? action.values : [action.values];
        const key = table === 'opportunity_work' ? ['opportunity_id'] : ['organization_id', 'event_key'];
        const added = list.filter((value: Row) => !rows.some(row => key.every(column => row[column] === value[column])));
        rows.push(...added.map((value: Row) => ({ ...value })));
        return { data: returning ? added : null, error: null };
      }
      if (action?.kind === 'update') { const hit = matched(); hit.forEach(row => Object.assign(row, action!.values)); return { data: returning ? hit : null, error: null }; }
      return { data: matched(), error: null };
    };
    const chain: any = {
      select: () => { returning = true; return chain; }, eq: (column: string, value: unknown) => { filters.push(row => row[column] === value); return chain; },
      in: (column: string, values: unknown[]) => { filters.push(row => values.includes(row[column])); return chain; },
      upsert: (values: any, options: any) => { action = { kind: 'upsert', values, ignore: options?.ignoreDuplicates }; return chain; },
      update: (values: any) => { action = { kind: 'update', values }; return chain; },
      maybeSingle: async () => { const result = run(); return { data: Array.isArray(result.data) ? result.data[0] ?? null : result.data, error: null }; },
      then: (resolve: any, reject: any) => Promise.resolve(run()).then(resolve, reject),
    };
    return chain;
  };
  return { tables, client: { from } as any };
}
const ORG = 'org';
const admin = { organizationId: ORG, userId: 'admin', role: 'admin' };
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const world = () => memory({
  commercial_opportunities: [1, 2, 3, 4, 5].map(n => ({ organization_id: ORG, id: id(n), title: `Licitación ${n}` })),
  // 2 was left unassigned after an assignment, 3 is in preparation, 4 was put aside already.
  opportunity_work: [{ organization_id: ORG, opportunity_id: id(2), state: 'unassigned', revision: 2 }, { organization_id: ORG, opportunity_id: id(3), state: 'working', revision: 5 },
    { organization_id: ORG, opportunity_id: id(4), state: 'archived', revision: 1 }],
  opportunity_activity: [],
});

test('putting aside goes to «Archivadas» with the reason, leaves alone what a team works, and says how many', async () => {
  const { tables, client } = world();
  const result = await discardOpportunities(client, admin, [id(1), id(2), id(3), id(4), id(9)], { reason: 'zona', note: 'Solo la RM' });
  assert.deepEqual(result.done.sort(), [id(1), id(2)]);
  assert.equal(result.skipped, 2, 'the one in preparation and the one already archived (the unknown one is not counted)');
  const work = new Map(tables.opportunity_work.map(row => [row.opportunity_id, row]));
  assert.deepEqual([work.get(id(1))!.state, work.get(id(1))!.revision], ['archived', 1], 'a new work record');
  assert.deepEqual([work.get(id(2))!.state, work.get(id(2))!.revision], ['archived', 3], 'the record left unassigned, with its revision');
  assert.equal(work.get(id(3))!.state, 'working', 'a team\'s work is not touched');
  assert.equal(tables.opportunity_activity.length, 2);
  const line = tables.opportunity_activity.find(row => row.opportunity_id === id(1))!;
  assert.deepEqual([line.kind, line.body, line.data.reason, line.data.note, line.actor_id], ['discarded', 'No es para nosotros: fuera de nuestra zona. Solo la RM', 'zona', 'Solo la RM', 'admin']);
  // The same again is not a second line.
  await discardOpportunities(client, admin, [id(1)], { reason: 'zona' });
  assert.equal(tables.opportunity_activity.length, 2);
});

test('only an administrator puts aside, and «Otro motivo» needs its line', async () => {
  const { client } = world();
  await assert.rejects(discardOpportunities(client, { ...admin, role: 'member' }, [id(1)], { reason: 'zona' }), /administrador/);
  await assert.rejects(discardOpportunities(client, admin, [id(1)], { reason: 'otro', note: '' }), /Cuenta en una línea/);
  await assert.rejects(discardOpportunities(client, admin, [id(9)], { reason: 'zona' }), /No encontramos/);
});

test('moving several keeps each revision check, reopens what was put aside, and never moves what nobody works', async () => {
  const { tables, client } = world();
  const reopened = await moveOpportunities(client, admin, [id(4), id(1)], 'unassigned');
  assert.deepEqual(reopened, { done: [id(4)], skipped: 1 });
  assert.equal(tables.opportunity_work.find(row => row.opportunity_id === id(4))!.state, 'unassigned');
  assert.match(tables.opportunity_activity.at(-1)!.body, /^Reabierta/);
  const presented = await moveOpportunities(client, admin, [id(3), id(2)], 'submitted');
  assert.deepEqual(presented, { done: [id(3)], skipped: 1 }, 'the one nobody works is assigned or put aside, not moved');
  assert.deepEqual(await moveOpportunities(client, admin, [id(2)], 'archived'), { done: [], skipped: 1 }, 'archiving what nobody works asks for its reason');
  assert.deepEqual(await moveOpportunities(client, admin, [id(3)], 'unassigned'), { done: [], skipped: 1 }, 'a team\'s work is not reopened');
  assert.deepEqual(tables.opportunity_activity.at(-1)!.data, { from: 'working', to: 'submitted' });
  await assert.rejects(moveOpportunities(client, { ...admin, role: 'member' }, [id(3)], 'archived'), /administrador/);
});

test('the same team for several: each one assigned with its own revision; a closed or changed one is skipped and the others go on', async () => {
  (globalThis as any).__assigned = []; (globalThis as any).__conflict = id(2);
  const { client } = world();
  const result = await assignOpportunities(client, admin, [id(1), id(2), id(3), id(4)], { teamId: null, participantIds: ['ana'], responsibleId: 'ana', objective: '', dueAt: null });
  assert.deepEqual(result, { done: [id(1), id(3)], skipped: 2 });
  assert.deepEqual((globalThis as any).__assigned.map((call: any) => [call.id, call.input.expectedRevision]), [[id(1), 0], [id(2), 2], [id(3), 5]], 'the archived one is not even tried');
  await assert.rejects(assignOpportunities(client, admin, [id(1)], { teamId: null, participantIds: [], responsibleId: null, objective: '', dueAt: null }), /a quién/);
});

test('the list\'s actions take up to fifty at once and only the moves that need no reason', () => {
  assert.equal(bulkSchema.parse({ op: 'discard', ids: [id(1), id(1)], reason: 'monto' }).ids.length, 1);
  assert.throws(() => bulkSchema.parse({ op: 'discard', ids: Array.from({ length: 51 }, (_, n) => id(n)), reason: 'monto' }));
  assert.throws(() => bulkSchema.parse({ op: 'state', ids: [id(1)], state: 'won' }), 'won and lost ask for their own reason');
  assert.throws(() => bulkSchema.parse({ op: 'discard', ids: [], reason: 'monto' }));
  assert.deepEqual(bulkSchema.parse({ op: 'assign', ids: [id(1)], participantIds: [id(7)], responsibleId: id(7) }).teamId, null);
});

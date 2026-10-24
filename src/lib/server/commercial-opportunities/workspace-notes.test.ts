import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

// The notes of the activity (workspace-notes.ts) with the database in memory: who a note names and tells, and who can correct or delete it.
const bundle = await build({
  stdin: { contents: `export * from './src/lib/server/commercial-opportunities/workspace-notes';`, loader: 'ts', resolveDir: process.cwd() },
  bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external',
  plugins: [{ name: 'stubs', setup(builder) {
    builder.onResolve({ filter: /auth-utils$|\/workspace-access$/ }, args => ({ path: args.path, namespace: 'stub' }));
    builder.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ loader: 'js', contents: args.path.endsWith('auth-utils')
      ? 'export class AuthError extends Error {constructor(message,status){super(message);this.status=status}}'
      : 'export async function assertOpportunityRead(){} export function assertOpportunityAdmin(){} export async function readableOpportunityIds(){ return null }' }));
  } }],
});
const compiled: { exports: any } = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);
const { addOpportunityNote, editOpportunityNote, deleteOpportunityNote } = compiled.exports;

type Row = Record<string, any>;
function memory(tables: Record<string, Row[]>) {
  return {
    tables,
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = [];
      let op: 'select' | 'update' | 'delete' = 'select'; let change: Row | null = null; let limit = Infinity;
      const list = () => (tables[table] ||= []);
      const matching = () => list().filter(row => filters.every(keep => keep(row)));
      const run = () => {
        if (op === 'update') { const rows = matching(); rows.forEach(row => Object.assign(row, change)); return rows; }
        if (op === 'delete') { const rows = matching(); tables[table] = list().filter(row => !rows.includes(row)); return rows; }
        return matching().slice(0, limit).map(row => ({ ...row }));
      };
      const chain: any = {
        select: () => chain, order: () => chain, limit: (count: number) => { limit = count; return chain; },
        eq: (column: string, value: unknown) => { filters.push(row => row[column] === value); return chain; },
        in: (column: string, items: unknown[]) => { filters.push(row => items.includes(row[column])); return chain; },
        update: (values: Row) => { op = 'update'; change = values; return chain; },
        delete: () => { op = 'delete'; return chain; },
        upsert: (rows: Row | Row[], options: { onConflict: string }) => {
          const keys = options.onConflict.split(',');
          for (const value of [rows].flat()) if (!list().some(row => keys.every(key => row[key] === value[key]))) list().push({ id: randomUUID(), created_at: new Date().toISOString(), ...value });
          return Promise.resolve({ data: null, error: null });
        },
        maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
        then: (resolve: any, reject: any) => Promise.resolve({ data: run(), error: null }).then(resolve, reject),
      };
      return chain;
    },
  };
}

const ORG = 'org', OPP = 'opp';
const ADMIN = 'admin', DIEGO = 'diego', MARIA = 'maria', LUIS = 'luis';
const scope = (userId: string, role = 'member') => ({ organizationId: ORG, userId, role });
const world = () => memory({
  commercial_opportunities: [{ organization_id: ORG, id: OPP, title: 'Servicio de guardias' }],
  organization_members: [{ organization_id: ORG, user_id: ADMIN, role: 'owner' }, { organization_id: ORG, user_id: DIEGO, role: 'member' },
    { organization_id: ORG, user_id: MARIA, role: 'member' }, { organization_id: ORG, user_id: LUIS, role: 'member' }],
  profiles: [{ id: ADMIN, full_name: 'Camila Torres' }, { id: DIEGO, full_name: 'Diego Fuentes' }, { id: MARIA, full_name: 'María José Pérez' }, { id: LUIS, full_name: 'Luis Rojas' }],
  // Luis is not in the team of this opportunity: he cannot read it, so a note cannot name him.
  opportunity_participants: [{ organization_id: ORG, opportunity_id: OPP, user_id: DIEGO }, { organization_id: ORG, opportunity_id: OPP, user_id: MARIA }],
  opportunity_activity: [], opportunity_notifications: [],
});

test('a note tells the people it names who can read the opportunity, never its author, once', async () => {
  const db = world();
  const text = '@María José Pérez y @Camila Torres: revisen el anexo. @Luis Rojas no lo ve; @Diego Fuentes soy yo.';
  assert.deepEqual(await addOpportunityNote(db, scope(DIEGO), OPP, text), { mentioned: [MARIA, ADMIN] });
  const [note] = db.tables.opportunity_activity;
  assert.deepEqual([note.kind, note.body, note.actor_id, note.data], ['note', text, DIEGO, { mentions: [MARIA, ADMIN] }]);
  assert.deepEqual(db.tables.opportunity_notifications.map(row => [row.user_id, row.title, row.kind, row.event_key]).sort(),
    [[ADMIN, 'Diego Fuentes te mencionó: Servicio de guardias', 'task', `mention:${note.event_key}`], [MARIA, 'Diego Fuentes te mencionó: Servicio de guardias', 'task', `mention:${note.event_key}`]]);
  assert.deepEqual(await addOpportunityNote(db, scope(DIEGO), OPP, 'Sin menciones.'), { mentioned: [] });
  assert.deepEqual(db.tables.opportunity_activity[1].data, {});
});

test('whoever wrote a note corrects it (it says when) and only those named for the first time hear about it; nobody else can', async () => {
  const db = world();
  await addOpportunityNote(db, scope(DIEGO), OPP, 'Revisen el anexo, @María José Pérez.');
  const id = db.tables.opportunity_activity[0].id;
  assert.deepEqual(await editOpportunityNote(db, scope(DIEGO), OPP, { id, text: 'Revisen el anexo 3, @María José Pérez y @Camila Torres.' }), { mentioned: [ADMIN] });
  const note = db.tables.opportunity_activity[0];
  assert.equal(note.body, 'Revisen el anexo 3, @María José Pérez y @Camila Torres.');
  assert.deepEqual(note.data.mentions, [MARIA, ADMIN]);
  assert.match(note.data.editedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(db.tables.opportunity_notifications.length, 2, 'María was told once');
  await assert.rejects(editOpportunityNote(db, scope(MARIA), OPP, { id, text: 'Otra cosa' }), { status: 403 });
  await assert.rejects(deleteOpportunityNote(db, scope(ADMIN, 'owner'), OPP, id), { status: 403 }, 'not even an administrator deletes someone else\'s note');
  await assert.rejects(editOpportunityNote(db, scope(DIEGO), OPP, { id: randomUUID(), text: 'x' }), { status: 404 });
});

test('a person deletes their own note; what the app wrote cannot be deleted', async () => {
  const db = world();
  await addOpportunityNote(db, scope(DIEGO), OPP, 'Enviamos las consultas.');
  db.tables.opportunity_activity.push({ id: 'state', organization_id: ORG, opportunity_id: OPP, actor_id: DIEGO, kind: 'state', body: 'Estado: presentada', data: {}, event_key: 'k' });
  assert.deepEqual(await deleteOpportunityNote(db, scope(DIEGO), OPP, db.tables.opportunity_activity[0].id), { deleted: true });
  assert.deepEqual(db.tables.opportunity_activity.map(row => row.id), ['state']);
  await assert.rejects(deleteOpportunityNote(db, scope(DIEGO), OPP, 'state'), { status: 403 });
});

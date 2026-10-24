import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

// The daily check of the tenders presented (runResultChecks), with the database in memory and Mercado Público answering from fixtures.
const bundle = await build({
  stdin: { contents: `export { runResultChecks } from './src/lib/server/commercial-opportunities/workspace-results';`, loader: 'ts', resolveDir: process.cwd() },
  bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external',
  plugins: [{ name: 'stubs', setup(builder) {
    builder.onResolve({ filter: /auth-utils$|\/workspace-access$|\/tickets$/ }, args => ({ path: args.path, namespace: 'stub' }));
    builder.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ loader: 'js', contents: args.path.endsWith('auth-utils')
      ? 'export class AuthError extends Error {constructor(message,status){super(message);this.status=status}}'
      : args.path.endsWith('workspace-access')
        ? 'export async function assertOpportunityRead(){} export function assertOpportunityAdmin(){} export async function readableOpportunityIds(){ return null }'
        : 'export async function resolveTicketForOrganization(){ return globalThis.__ticket ? { ticket: "t", userId: "admin", source: "own" } : null }' }));
  } }],
});
const compiled: { exports: any } = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);
const { runResultChecks } = compiled.exports;

type Row = Record<string, any>;
function memory(tables: Record<string, Row[]>) {
  return {
    tables,
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = [];
      let change: Row | null = null;
      const rows = () => (tables[table] ||= []).filter(row => filters.every(keep => keep(row)));
      const chain: any = {
        select: () => chain, order: () => chain, limit: () => chain,
        eq: (column: string, value: unknown) => { filters.push(row => row[column] === value); return chain; },
        in: (column: string, values: unknown[]) => { filters.push(row => values.includes(row[column])); return chain; },
        update: (values: Row) => { change = values; return chain; },
        upsert: (values: Row | Row[], options: { onConflict: string }) => {
          const keys = options.onConflict.split(',');
          for (const value of [values].flat()) if (!(tables[table] ||= []).some(row => keys.every(key => row[key] === value[key]))) tables[table].push(value);
          return Promise.resolve({ data: null, error: null });
        },
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        then: (resolve: any) => { if (change) { for (const row of rows()) Object.assign(row, change); } return Promise.resolve({ data: rows(), error: null }).then(resolve); },
      };
      return chain;
    },
  };
}
const ORG = 'org', ADMIN = 'admin', DIEGO = 'diego';
const NOW = Date.parse('2026-10-24T12:00:00.000Z');
const job = { id: 'job', organization_id: ORG, requested_by: ADMIN, payload: { results: true } };
const tender = (id: string, code: string, extra: Row = {}) => ({ id, organization_id: ORG, kind: 'tender', title: `Licitación ${id}`, data: { observed: { code }, ...extra } });
const world = () => memory({
  opportunity_work: [{ organization_id: ORG, opportunity_id: 'a', state: 'submitted', responsible_id: DIEGO }, { organization_id: ORG, opportunity_id: 'b', state: 'submitted', responsible_id: DIEGO },
    { organization_id: ORG, opportunity_id: 'c', state: 'submitted', responsible_id: DIEGO }, { organization_id: ORG, opportunity_id: 'd', state: 'working', responsible_id: DIEGO }],
  commercial_opportunities: [tender('a', 'A-1'),
    // Checked an hour ago: it waits for tomorrow.
    tender('b', 'B-1', { result: { status: 'cerrada', checkedAt: new Date(NOW - 3_600_000).toISOString(), winners: [] } }),
    tender('c', 'C-1'), tender('d', 'D-1')],
  opportunity_participants: [{ organization_id: ORG, opportunity_id: 'a', user_id: DIEGO }, { organization_id: ORG, opportunity_id: 'a', user_id: 'maria' }],
  organization_members: [{ organization_id: ORG, user_id: ADMIN, role: 'owner' }, { organization_id: ORG, user_id: DIEGO, role: 'member' }],
  opportunity_tender_profile: [{ organization_id: ORG, answers: { rut: '77.111.222-6' } }],
});
const awarded = { status: 'adjudicada', awardedAt: '2026-10-20T20:27:00.000Z', expectedAt: null, bidders: 5, total: 85_000_000, currency: 'CLP', actUrl: null,
  winners: [{ rut: '76.543.210-3', name: 'Seguridad Sur SpA', amount: 85_000_000 }] };

test('each tender presented is asked once a day: a decided one is kept, told in its activity and to whoever worked it and the administrators', async () => {
  (globalThis as any).__ticket = true;
  const db = world();
  const asked: string[] = [];
  const result = async (code: string) => { asked.push(code); return code === 'A-1' ? awarded : { ...awarded, status: 'cerrada', awardedAt: null, winners: [], total: null, expectedAt: '2026-10-28T15:00:00.000Z' }; };
  assert.deepEqual(await runResultChecks(db, job, { result, wait: async () => undefined, now: () => NOW }), { checked: 2, decided: 1 });
  assert.deepEqual(asked, ['A-1', 'C-1'], 'one checked an hour ago and one not presented are not asked');
  const a = db.tables.commercial_opportunities.find(row => row.id === 'a')!;
  assert.deepEqual([a.data.result.status, a.data.result.ours, a.data.observed.code], ['adjudicada', false, 'A-1'], 'kept beside what the opportunity already had');
  assert.equal(db.tables.commercial_opportunities.find(row => row.id === 'c')!.data.result.status, 'cerrada');
  assert.deepEqual(db.tables.opportunity_activity.map(row => [row.kind, row.body, row.data.winner]),
    [['auto_result', 'Mercado Público: Adjudicada el 20 de octubre a Seguridad Sur SpA por $85.000.000, entre 5 ofertas.', 'Seguridad Sur SpA']]);
  assert.deepEqual(db.tables.opportunity_notifications.map(row => [row.user_id, row.title, row.kind]).sort(),
    [[ADMIN, 'Adjudicada: Licitación a', 'task'], [DIEGO, 'Adjudicada: Licitación a', 'task'], ['maria', 'Adjudicada: Licitación a', 'task']]);
  // The next morning the decided one is not asked again, nor told twice.
  asked.length = 0;
  await runResultChecks(db, job, { result, wait: async () => undefined, now: () => NOW + 86_400_000 });
  assert.deepEqual(asked, ['B-1', 'C-1']);
  assert.equal(db.tables.opportunity_activity.length, 1);
});

test('without a ticket nothing is asked, and a quota that runs out stops the turn', async () => {
  (globalThis as any).__ticket = false;
  const asked: string[] = [];
  assert.deepEqual(await runResultChecks(world(), job, { result: async (code: string) => { asked.push(code); return awarded; }, wait: async () => undefined, now: () => NOW }),
    { checked: 0, decided: 0, ticket: false });
  (globalThis as any).__ticket = true;
  const db = world();
  assert.deepEqual(await runResultChecks(db, job, { result: async (code: string) => { asked.push(code); throw new Error('Mercado Público: se acabó la cuota diaria del ticket.'); },
    wait: async () => undefined, now: () => NOW }), { checked: 0, decided: 0 });
  assert.deepEqual(asked, ['A-1'], 'the rest waits for tomorrow');
  assert.equal(db.tables.commercial_opportunities.find(row => row.id === 'a')!.data.result, undefined);
});

test('a tender the company won says so', async () => {
  (globalThis as any).__ticket = true;
  const db = world();
  db.tables.opportunity_tender_profile[0].answers.rut = '76543210-3';
  await runResultChecks(db, job, { result: async () => awarded, wait: async () => undefined, now: () => NOW });
  assert.equal(db.tables.commercial_opportunities.find(row => row.id === 'a')!.data.result.ours, true);
});

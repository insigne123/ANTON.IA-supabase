import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

// «Calcular el precio» on the server (OPP-23) with the database in memory: who works it out, the working session that goes over the
// same version, a teammate's version that is not overwritten, and the history.
const bundle = await build({
  stdin: { contents: `export * from './src/lib/server/commercial-opportunities/workspace-price';`, loader: 'ts', resolveDir: process.cwd() },
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
const { saveOpportunityPriceStudy, readOpportunityPriceStudy, readOpportunityPriceVersion, PRICE_SESSION_MS } = compiled.exports;

type Row = Record<string, any>;
/** Enough of supabase-js for these reads and writes: filters, newest first, insert and update with what they wrote. */
function memory(tables: Record<string, Row[]>, failing: string[] = []) {
  return {
    tables,
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = [];
      let op: 'select' | 'insert' | 'update' = 'select'; let values: Row | null = null; let newest = false; let limit = Infinity;
      const list = () => (tables[table] ||= []);
      const run = () => {
        if (op === 'insert') { const row = { id: randomUUID(), ...structuredClone(values) }; list().push(row); return [{ ...row }]; }
        const rows = list().filter(row => filters.every(keep => keep(row)));
        if (op === 'update') { rows.forEach(row => Object.assign(row, structuredClone(values))); return rows.map(row => ({ ...row })); }
        const sorted = newest ? [...rows].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))) : rows;
        return sorted.slice(0, limit).map(row => structuredClone(row));
      };
      const result = () => (failing.includes(table) ? { data: null, error: { code: '42P01', message: 'relation does not exist' } } : null);
      const chain: any = {
        select: () => chain, order: (_column: string, options?: { ascending?: boolean }) => { newest = options?.ascending === false; return chain; },
        limit: (count: number) => { limit = count; return chain; },
        eq: (column: string, value: unknown) => { filters.push(row => row[column] === value); return chain; },
        insert: (value: Row) => { op = 'insert'; values = value; return chain; },
        update: (change: Row) => { op = 'update'; values = change; return chain; },
        maybeSingle: async () => result() ?? { data: run()[0] ?? null, error: null },
        single: async () => result() ?? { data: run()[0] ?? null, error: null },
        then: (resolve: any, reject: any) => Promise.resolve(result() ?? { data: run(), error: null }).then(resolve, reject),
      };
      return chain;
    },
  };
}

const ORG = 'org', OPP = 'opp';
const ADMIN = 'admin', DIEGO = 'diego', MARIA = 'maria';
const scope = (userId: string, role = 'member') => ({ organizationId: ORG, userId, role });
const world = () => memory({ opportunity_work: [{ organization_id: ORG, opportunity_id: OPP, state: 'working', responsible_id: MARIA }], opportunity_price_studies: [] });
const study = (base: string) => ({ profiles: [{ id: 'a1', name: 'Guardia', headcount: '12', base }], params: { margin: '10' }, score: { weight: '60' } });
const T0 = Date.parse('2026-10-24T15:00:00.000Z');

test('whoever is in charge or an administrator works the price out; the rest of the team does not', async () => {
  const db = world();
  await assert.rejects(saveOpportunityPriceStudy(db, scope(DIEGO), OPP, { study: study('600000'), base: null }), { status: 403 });
  const saved = await saveOpportunityPriceStudy(db, scope(MARIA), OPP, { study: study('600000'), base: null }, T0);
  assert.equal(saved.created_by, MARIA);
  assert.equal(saved.study.profiles[0].base, '600000');
  assert.equal(saved.study.params.vat, '19', 'what the page did not send comes as the default');
  await saveOpportunityPriceStudy(db, scope(ADMIN, 'admin'), OPP, { study: study('610000'), base: saved.id }, T0 + 1000);
  assert.equal(db.tables.opportunity_price_studies.length, 2, 'another person starts a new version');
});

test('saves of the same person while they keep working go over the same version; after a break, a new one', async () => {
  const db = world();
  const first = await saveOpportunityPriceStudy(db, scope(MARIA), OPP, { study: study('600000'), base: null }, T0);
  const again = await saveOpportunityPriceStudy(db, scope(MARIA), OPP, { study: study('620000'), base: first.id }, T0 + 60_000);
  assert.equal(again.id, first.id);
  assert.equal(db.tables.opportunity_price_studies.length, 1);
  assert.equal(db.tables.opportunity_price_studies[0].study.profiles[0].base, '620000');
  const later = await saveOpportunityPriceStudy(db, scope(MARIA), OPP, { study: study('640000'), base: first.id }, T0 + 60_000 + PRICE_SESSION_MS + 1);
  assert.notEqual(later.id, first.id);
  const brought = await saveOpportunityPriceStudy(db, scope(MARIA), OPP, { study: study('600000'), base: later.id, fresh: true }, T0 + 60_000 + PRICE_SESSION_MS + 2);
  assert.notEqual(brought.id, later.id, 'a version brought back from the history never writes over the session in course');
});

test('a teammate\'s newer version is not overwritten unless the person chooses to keep theirs on top', async () => {
  const db = world();
  const mine = await saveOpportunityPriceStudy(db, scope(MARIA), OPP, { study: study('600000'), base: null }, T0);
  await saveOpportunityPriceStudy(db, scope(ADMIN, 'admin'), OPP, { study: study('700000'), base: mine.id }, T0 + 1000);
  await assert.rejects(saveOpportunityPriceStudy(db, scope(MARIA), OPP, { study: study('650000'), base: mine.id }, T0 + 2000), { status: 409 });
  const over = await saveOpportunityPriceStudy(db, scope(MARIA), OPP, { study: study('650000'), base: mine.id, over: true }, T0 + 3000);
  assert.equal(db.tables.opportunity_price_studies.length, 3, 'the administrator\'s version stays in the history');
  assert.equal(over.study.profiles[0].base, '650000');
});

test('the page reads the study in use and its history, and brings an old version back; before the table, it is not available', async () => {
  const db = world();
  const first = await saveOpportunityPriceStudy(db, scope(MARIA), OPP, { study: study('600000'), base: null }, T0);
  await saveOpportunityPriceStudy(db, scope(ADMIN, 'admin'), OPP, { study: study('700000'), base: first.id }, T0 + 1000);
  const read = await readOpportunityPriceStudy(db, scope(MARIA), OPP);
  assert.equal(read.available, true);
  assert.equal(read.latest.study.profiles[0].base, '700000');
  assert.deepEqual(read.versions.map((version: Row) => version.created_by), [ADMIN, MARIA]);
  assert.equal((await readOpportunityPriceVersion(db, scope(MARIA), OPP, first.id)).study.profiles[0].base, '600000');
  await assert.rejects(readOpportunityPriceVersion(db, scope(DIEGO), OPP, first.id), { status: 403 });
  await assert.rejects(readOpportunityPriceVersion(db, scope(MARIA), OPP, randomUUID()), { status: 404 });
  assert.deepEqual(await readOpportunityPriceStudy(memory({}, ['opportunity_price_studies']), scope(MARIA), OPP), { available: false, latest: null, versions: [] });
});

test('what is saved is cleaned: the shape of the study and short texts, whatever the page sends', async () => {
  const db = world();
  const saved = await saveOpportunityPriceStudy(db, scope(MARIA), OPP, { study: { profiles: [{ name: 'x'.repeat(500), base: 12 }], params: { margin: { evil: true } }, extra: 'drop me' }, base: null }, T0);
  assert.equal(saved.study.profiles[0].name.length, 120);
  assert.equal(saved.study.profiles[0].base, '', 'a number where text goes is dropped');
  assert.equal(typeof saved.study.params.margin, 'string');
  assert.equal('extra' in saved.study, false);
});

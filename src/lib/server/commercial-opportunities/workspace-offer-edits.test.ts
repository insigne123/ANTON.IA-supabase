import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

// The offer in the team's words (OPP-24) with the database in memory: a part written by hand or by the AI, without losing what a
// teammate saved, «Revisado por» for whoever is in charge, and the versions before.
const bundle = await build({
  stdin: { contents: `export * from './src/lib/server/commercial-opportunities/workspace-offer';`, loader: 'ts', resolveDir: process.cwd() },
  bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external',
  plugins: [{ name: 'stubs', setup(builder) {
    const stubs: Record<string, string> = {
      'auth-utils': 'export class AuthError extends Error {constructor(message,status){super(message);this.status=status}}',
      'workspace-access': 'export async function assertOpportunityRead(){} export function assertOpportunityAdmin(){} export async function readableOpportunityIds(){ return null }',
      'workspace-ai': 'export async function opportunityGenerate(client, job, input){ globalThis.__prompts.push(input.prompt); return globalThis.__answer(input) }',
      'tender-profile-read': 'export async function loadCompanyForModel(){ return null }',
    };
    builder.onResolve({ filter: /(auth-utils|\/workspace-access|\/workspace-ai|\/tender-profile-read)$/ }, args => ({ path: args.path, namespace: 'stub' }));
    builder.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ loader: 'js', contents: stubs[Object.keys(stubs).find(name => args.path.endsWith(name))!] }));
  } }],
});
const compiled: { exports: any } = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);
const { saveOpportunityOfferPart, reviewOpportunityOffer, enqueueOpportunityOfferRewrite, runOpportunityOffer, readOpportunityOffer, readOpportunityOfferVersion } = compiled.exports;
const globals = globalThis as any;

type Row = Record<string, any>;
/** Enough of supabase-js for these reads and writes: filters, ranges, update with what it changed, upsert that may return its row. */
function memory(tables: Record<string, Row[]>) {
  return {
    tables,
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = [];
      let op: 'select' | 'update' | 'upsert' = 'select'; let values: Row | null = null; let from = 0; let to = Infinity; let added: Row[] = [];
      const list = () => (tables[table] ||= []);
      const matching = () => list().filter(row => filters.every(keep => keep(row)));
      const run = () => {
        if (op === 'update') { const rows = matching(); rows.forEach(row => Object.assign(row, structuredClone(values))); return rows.map(row => ({ ...row })); }
        if (op === 'upsert') return added;
        return matching().slice(from, to + 1).map(row => structuredClone(row));
      };
      const chain: any = {
        select: () => chain, order: () => chain, limit: (count: number) => { to = count - 1; return chain; }, range: (start: number, end: number) => { from = start; to = end; return chain; },
        eq: (column: string, value: unknown) => { filters.push(row => row[column] === value); return chain; },
        update: (change: Row) => { op = 'update'; values = change; return chain; },
        upsert: (value: Row, options: { onConflict: string }) => {
          op = 'upsert'; const keys = options.onConflict.split(',');
          if (!list().some(row => keys.every(key => row[key] === value[key]))) { const row = { id: randomUUID(), created_at: new Date().toISOString(), ...value }; list().push(row); added = [row]; }
          return chain;
        },
        maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
        single: async () => { const rows = run(); return rows.length ? { data: rows[0], error: null } : { data: null, error: { code: 'PGRST116' } }; },
        then: (resolve: any, reject: any) => Promise.resolve({ data: run(), error: null }).then(resolve, reject),
      };
      return chain;
    },
  };
}

const ORG = 'org', OPP = 'opp', DRAFT = '00000000-0000-4000-8000-000000000a01', OLD = '00000000-0000-4000-8000-000000000a00';
const ADMIN = 'admin', DIEGO = 'diego', MARIA = 'maria';
const scope = (userId: string, role = 'member') => ({ organizationId: ORG, userId, role });
const draft = {
  summary: 'Ofrecemos guardias con [N.º de años] de experiencia.', letter: '[nombre de la empresa] presenta su oferta.', missing: [],
  technical: [{ heading: 'Experiencia', criterion: 'Experiencia del oferente', weight: '40 %', body: 'Hemos prestado servicios a [clientes].', evidence: [] },
    { heading: 'Plan de trabajo', criterion: 'Metodología', weight: '30 %', body: 'Turnos de lunes a domingo.', evidence: [] }],
  compliance: [{ requirement: 'Dotación mínima de 12 guardias', answer: 'Cumplimos con 12 guardias.', evidence: [] }],
  economic: { lines: [{ description: 'Servicio mensual', unit: 'mes', quantity: 12, notes: '', evidence: [] }], priceBasis: 'net', validity: '', paymentTerms: '', notes: [] },
};
const world = () => memory({
  commercial_opportunities: [{ organization_id: ORG, id: OPP, title: 'Servicio de guardias', buyer_name: 'Municipalidad de Providencia', kind: 'tender' }],
  opportunity_work: [{ organization_id: ORG, opportunity_id: OPP, state: 'working', responsible_id: MARIA }],
  opportunity_company_context: [{ organization_id: ORG, offer: 'Guardias de seguridad', services: ['Guardias'], territories: ['RM'], exclusions: [], revision: 1 }],
  opportunity_reports: [{ organization_id: ORG, opportunity_id: OPP, id: 'report-1', report: { sections: [] } }],
  opportunity_offer_drafts: [
    { id: DRAFT, organization_id: ORG, opportunity_id: OPP, report_id: 'report-1', draft: structuredClone(draft), prices: { 0: 1000 }, revision: 3, created_at: '2026-10-24T12:00:00.000Z', updated_at: '2026-10-24T12:00:00.000Z' },
    { id: OLD, organization_id: ORG, opportunity_id: OPP, report_id: 'report-1', draft: structuredClone(draft), prices: {}, revision: 0, created_at: '2026-10-20T12:00:00.000Z', updated_at: '2026-10-20T12:00:00.000Z' },
  ],
  opportunity_jobs: [], opportunity_activity: [], profiles: [],
});
const row = (db: ReturnType<typeof world>) => db.tables.opportunity_offer_drafts.find(item => item.id === DRAFT)!;

test('anyone on the team writes a part in their words; the AI\'s text, the prices and their revision stay as they were', async () => {
  const db = world();
  const saved = await saveOpportunityOfferPart(db, scope(DIEGO), OPP, { draftId: DRAFT, part: 'technical:1', text: 'Turnos de 7 a 22 h con un supervisor por turno.', base: null });
  assert.equal(saved.edit.text, 'Turnos de 7 a 22 h con un supervisor por turno.');
  assert.equal(saved.edit.by, DIEGO);
  assert.equal(row(db).draft.technical[1].body, 'Turnos de lunes a domingo.', 'the AI\'s text is kept');
  assert.deepEqual([row(db).prices, row(db).revision], [{ 0: 1000 }, 3], 'the prices keep their own revision: a price saved later is not refused');
  assert.notEqual(row(db).updated_at, '2026-10-24T12:00:00.000Z');
});

test('a part a teammate saved meanwhile is not overwritten; parts of two people at once both stay; and it goes back to the AI\'s text', async () => {
  const db = world();
  const first = await saveOpportunityOfferPart(db, scope(MARIA), OPP, { draftId: DRAFT, part: 'letter', text: 'Carta de María.', base: null });
  await assert.rejects(saveOpportunityOfferPart(db, scope(DIEGO), OPP, { draftId: DRAFT, part: 'letter', text: 'Carta de Diego.', base: null }), { status: 409 },
    'Diego started from the AI\'s letter: María\'s stays and he sees it');
  await saveOpportunityOfferPart(db, scope(DIEGO), OPP, { draftId: DRAFT, part: 'compliance:0', text: 'Cumplimos con 14 guardias.', base: null });
  assert.deepEqual(Object.keys(row(db).draft.edits).sort(), ['compliance:0', 'letter']);
  await saveOpportunityOfferPart(db, scope(DIEGO), OPP, { draftId: DRAFT, part: 'letter', text: null, base: first.edit.at });
  assert.deepEqual(Object.keys(row(db).draft.edits), ['compliance:0']);
  await assert.rejects(saveOpportunityOfferPart(db, scope(DIEGO), OPP, { draftId: DRAFT, part: 'technical:9', text: 'x', base: null }), { status: 404 });
});

test('«Revisado por» is for whoever is in charge or an administrator, and it is said in the activity', async () => {
  const db = world();
  await assert.rejects(reviewOpportunityOffer(db, scope(DIEGO), OPP, { draftId: DRAFT, reviewed: true }), { status: 403 });
  const done = await reviewOpportunityOffer(db, scope(MARIA), OPP, { draftId: DRAFT, reviewed: true });
  assert.equal(done.review.by, MARIA);
  assert.equal(row(db).draft.review.by, MARIA);
  assert.deepEqual(db.tables.opportunity_activity.map(item => [item.kind, item.body]), [['offer', 'Oferta revisada antes de presentarla']]);
  await reviewOpportunityOffer(db, scope(ADMIN, 'admin'), OPP, { draftId: DRAFT, reviewed: false });
  assert.equal(row(db).draft.review, null);
});

test('«Pedir cambios a la IA» queues one part, once per click, and the AI writes over that part only', async () => {
  const db = world();
  const requestId = randomUUID();
  const input = { draftId: DRAFT, part: 'technical:1', instructions: 'Agrega que hay un supervisor por turno', base: null, requestId };
  const jobId = await enqueueOpportunityOfferRewrite(db, scope(DIEGO), OPP, input);
  assert.equal(await enqueueOpportunityOfferRewrite(db, scope(DIEGO), OPP, input), jobId, 'a double click asks once');
  const job = db.tables.opportunity_jobs[0];
  assert.deepEqual([job.kind, job.payload], ['offer', { draftId: DRAFT, part: 'technical:1', instructions: 'Agrega que hay un supervisor por turno', base: null }]);
  globals.__prompts = []; globals.__answer = () => ({ text: 'Turnos de lunes a domingo, con un supervisor por turno.' });
  assert.deepEqual(await runOpportunityOffer(db, { ...job, organization_id: ORG, opportunity_id: OPP, requested_by: DIEGO }), { offerPart: 'technical:1' });
  assert.match(globals.__prompts[0], /^Reescribe la sección «Plan de trabajo»/);
  const edit = row(db).draft.edits['technical:1'];
  assert.deepEqual([edit.text, edit.by, edit.ai], ['Turnos de lunes a domingo, con un supervisor por turno.', DIEGO, true]);
  assert.equal(db.tables.opportunity_offer_drafts.length, 2, 'no new version of the draft');
});

test('when someone changed the part before the AI finished, theirs stays and the person is told', async () => {
  const db = world();
  const requestId = randomUUID();
  await enqueueOpportunityOfferRewrite(db, scope(DIEGO), OPP, { draftId: DRAFT, part: 'summary', instructions: 'Más breve, por favor', base: null, requestId });
  await saveOpportunityOfferPart(db, scope(MARIA), OPP, { draftId: DRAFT, part: 'summary', text: 'Resumen de María.', base: null });
  globals.__prompts = []; globals.__answer = () => ({ text: 'Resumen de la IA.' });
  await assert.rejects(runOpportunityOffer(db, { ...db.tables.opportunity_jobs[0], organization_id: ORG, opportunity_id: OPP, requested_by: DIEGO }), { status: 409 });
  assert.equal(row(db).draft.edits.summary.text, 'Resumen de María.');
  await assert.rejects(enqueueOpportunityOfferRewrite(db, scope(DIEGO), OPP, { draftId: DRAFT, part: 'summary', instructions: 'Más breve, por favor', base: null, requestId: randomUUID() }), { status: 409 },
    'asked over the AI\'s text, which is no longer the part');
});

test('the page reads the versions before the latest, and each keeps its Word', async () => {
  const db = world();
  const offer = await readOpportunityOffer(db, scope(DIEGO), OPP);
  assert.equal(offer.latest.id, DRAFT);
  assert.deepEqual(offer.versions.map((version: Row) => version.id), [OLD]);
  assert.equal((await readOpportunityOfferVersion(db, scope(DIEGO), OPP, OLD)).id, OLD);
  assert.equal(await readOpportunityOfferVersion(db, scope(DIEGO), OPP, randomUUID()), null);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

// «¿Cumplimos?» with the database and the model in memory: when a reading is queued, what it saves, and answers that go
// into the company's tender profile.
async function load() {
  const stubs: Record<string, string> = {
    '@/lib/server/auth-utils': 'export class AuthError extends Error {constructor(message,status){super(message);this.status=status}}',
    './workspace-access': `export async function assertOpportunityRead(client, scope, id){ if (globalThis.__denied === id) { const e = new Error('No encontramos esa oportunidad.'); e.status = 404; throw e; } }
      export function assertOpportunityAdmin(){} export async function readableOpportunityIds(){ return null }`,
    './workspace-ai': 'export async function opportunityGenerate(client, job, options){ globalThis.__call = options; return globalThis.__reply(options) }',
  };
  const bundle = await build({
    stdin: { contents: `export * from './src/lib/server/commercial-opportunities/workspace-fit';`, loader: 'ts', resolveDir: process.cwd() },
    bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external',
    plugins: [{ name: 'stubs', setup(builder) {
      const filter = new RegExp(`(${Object.keys(stubs).map(name => name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('|')})$`);
      builder.onResolve({ filter }, args => ({ path: args.path, namespace: 'stub' }));
      builder.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ loader: 'js', contents: stubs[Object.keys(stubs).find(name => args.path.endsWith(name))!] }));
    } }],
  });
  const compiled: { exports: any } = { exports: {} };
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);
  return compiled.exports;
}

function memory(seed: Record<string, any[]> = {}, missing: string[] = []) {
  let serial = 0;
  const tables: Record<string, any[]> = { opportunity_requirement_fit: [], opportunity_tender_profile: [], opportunity_jobs: [], opportunity_reports: [], commercial_opportunities: [],
    opportunity_company_context: [], ...seed };
  const query = (name: string) => {
    const filters: Array<(row: any) => boolean> = [];
    const sorts: Array<{ key: string; ascending: boolean }> = [];
    let action: { kind: string; values?: any; conflict?: string[]; ignore?: boolean } = { kind: 'select' };
    const run = () => {
      if (missing.includes(name)) return { data: null, error: { code: '42P01', message: 'missing' } };
      const match = (row: any) => filters.every(filter => filter(row));
      if (action.kind === 'upsert') {
        for (const value of [].concat(action.values) as any[]) {
          const index = tables[name].findIndex(row => action.conflict!.every(key => row[key] === value[key]));
          if (index >= 0 && action.ignore) continue;
          if (index >= 0) tables[name][index] = { ...tables[name][index], ...value };
          else tables[name].push({ id: `row-${++serial}`, created_at: new Date(Date.now() + serial).toISOString(), ...value });
        }
        return { data: null, error: null };
      }
      if (action.kind === 'update') {
        const changed = tables[name].filter(match);
        tables[name] = tables[name].map(row => match(row) ? { ...row, ...action.values } : row);
        return { data: changed.map(row => ({ ...row, ...action.values })), error: null };
      }
      const found = tables[name].filter(match);
      for (const sort of [...sorts].reverse()) found.sort((a, b) => (a[sort.key] < b[sort.key] ? -1 : a[sort.key] > b[sort.key] ? 1 : 0) * (sort.ascending ? 1 : -1));
      return { data: found, error: null };
    };
    const first = () => { const result = run(); return { data: Array.isArray(result.data) ? result.data[0] ?? null : result.data, error: result.error }; };
    const builder: any = {
      select: () => builder,
      upsert: (values: any, opts: any) => { action = { kind: 'upsert', values, conflict: String(opts.onConflict).split(','), ignore: Boolean(opts.ignoreDuplicates) }; return builder; },
      update: (values: any) => { action = { kind: 'update', values }; return builder; },
      eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return builder; },
      order: (key: string, opts?: { ascending?: boolean }) => { sorts.push({ key, ascending: opts?.ascending !== false }); return builder; },
      limit: () => builder, maybeSingle: async () => first(), single: async () => first(),
      then: (resolve: (value: unknown) => void) => resolve(run()),
    };
    return builder;
  };
  return { tables, client: { from: query } as any };
}
const scope = { organizationId: 'org', userId: 'u1', role: 'member' };
const requirement = (title: string) => ({ title, status: 'supported', evidence: [{ chunkId: 'c1', quote: title }], action: '', role: '', due: '' });
const report = { recommendation: 'do_not_advance', reasons: ['Exigen ISO 9001'], requirements: [requirement('Certificación ISO 9001 vigente'), requirement('Boleta de garantía por $4.500.000')] };
const seed = () => ({
  commercial_opportunities: [{ id: 'op1', organization_id: 'org', kind: 'tender' }, { id: 'op2', organization_id: 'org', kind: 'linkedin_post' }],
  opportunity_reports: [{ id: 'r-old', organization_id: 'org', opportunity_id: 'op1', created_at: '2026-10-10T00:00:00Z', report },
    { id: 'r1', organization_id: 'org', opportunity_id: 'op1', created_at: '2026-10-18T00:00:00Z', report }],
  opportunity_tender_profile: [{ organization_id: 'org', revision: 3, answers: { certifications: ['ISO 9001'] } }],
  opportunity_company_context: [{ organization_id: 'org', offer: 'Aseo hospitalario' }],
});

test('a reading is queued for the latest report and the current profile, once each, and only with a profile', async () => {
  const { enqueueRequirementFit } = await load();
  const { tables, client } = memory(seed());
  assert.equal(await enqueueRequirementFit(client, scope, 'op1'), 'fit:r1:3');
  await enqueueRequirementFit(client, scope, 'op1');
  assert.deepEqual(tables.opportunity_jobs.map(job => [job.kind, job.opportunity_id, job.payload]), [['fit', 'op1', { reportId: 'r1', profileRevision: 3 }]]);
  await assert.rejects(enqueueRequirementFit(client, scope, 'op2'), /no tiene requisitos de bases/, 'a LinkedIn signal has no bases');
  await assert.rejects(enqueueRequirementFit(memory({ ...seed(), opportunity_tender_profile: [] }).client, scope, 'op1'), /completar primero la ficha/);
  await assert.rejects(enqueueRequirementFit(memory({ ...seed(), opportunity_reports: [] }).client, scope, 'op1'), /Genera primero el informe/);
  (globalThis as any).__denied = 'op1';
  await assert.rejects(enqueueRequirementFit(client, scope, 'op1'), (error: any) => error.status === 404, 'only who can read the opportunity');
  (globalThis as any).__denied = null;
});

test('the reading is saved for the report and the profile version, kept honest, and refused if the profile changed', async () => {
  const { runRequirementFit, readOpportunityFit } = await load();
  const { tables, client } = memory(seed());
  (globalThis as any).__reply = () => ({ noRestsOnRequirements: true, requirements: [
    { index: 0, fit: 'meets', basis: 'certificaciones: ISO 9001', question: '' }, { index: 1, fit: 'fails', basis: '', question: '¿Pueden entregar una boleta por $4.500.000?' }] });
  const job = { id: 'j', organization_id: 'org', opportunity_id: 'op1', requested_by: 'u1', kind: 'fit', payload: { reportId: 'r1', profileRevision: 3 }, lease_token: 'l', state: 'running' };
  assert.deepEqual(await runRequirementFit(client, job), { requirements: 2 });
  const call = (globalThis as any).__call;
  assert.deepEqual([call.role, call.category, call.step], ['specialist', 'research', 'fit']);
  assert.match(call.prompt, /"certificacionesVigentes":"ISO 9001"/);
  const saved = tables.opportunity_requirement_fit[0];
  assert.deepEqual([saved.report_id, saved.profile_revision, saved.no_rests_on_requirements], ['r1', 3, true]);
  assert.deepEqual(Object.values(saved.items).map((item: any) => item.fit), ['meets', 'missing'], 'a «no cumples» without a fact against it is a question');
  const view = await readOpportunityFit(client, 'org', 'r1');
  assert.deepEqual([view.available, view.profileRevision, view.latest.profileRevision], [true, 3, 3]);
  assert.deepEqual(await readOpportunityFit(memory({}, ['opportunity_requirement_fit']).client, 'org', 'r1'), { available: false, latest: null, profileRevision: null });
  assert.deepEqual((await readOpportunityFit(memory(seed()).client, 'org', null)).latest, null);
  await assert.rejects(runRequirementFit(client, { ...job, payload: { reportId: 'r1', profileRevision: 2 } }), /La ficha cambió/);
});

test('an answer to the AI goes into the profile, replacing an earlier answer to the same question', async () => {
  const { answerFitQuestion } = await load();
  const { tables, client } = memory(seed());
  assert.equal(await answerFitQuestion(client, scope, 'op1', { question: '¿Pueden entregar una boleta por $4.500.000?', answer: '  Sí,  hasta $10.000.000 ' }), 4);
  assert.equal(await answerFitQuestion(client, scope, 'op1', { question: '¿Pueden entregar una boleta por $4.500.000?', answer: 'No' }), 5);
  const notes = tables.opportunity_tender_profile[0].answers.notes;
  assert.deepEqual(notes.map((note: any) => [note.question, note.answer]), [['¿Pueden entregar una boleta por $4.500.000?', 'No']]);
  assert.deepEqual(tables.opportunity_tender_profile[0].answers.certifications, ['ISO 9001'], 'the rest of the profile stays');
  assert.equal(tables.opportunity_tender_profile[0].updated_by, 'u1');
  await assert.rejects(answerFitQuestion(memory({ ...seed(), opportunity_tender_profile: [] }).client, scope, 'op1', { question: '¿Boleta?', answer: 'Sí' }), /completar primero la ficha/);
});

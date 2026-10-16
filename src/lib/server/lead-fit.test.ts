import assert from 'node:assert/strict';
import test from 'node:test';
import { leadFitFacts, type LeadFitStage } from '@/lib/lead-fit/core';
import { assessLeadFit, leadFitInputHash, leadFitProfile } from './lead-fit';

const SCOPE = { userId: '00000000-0000-4000-8000-000000000001', organizationId: '00000000-0000-4000-8000-0000000000aa' };
const PROFILE = { company_name: 'Yago', signatures: { profile_extended: { description: 'Selección masiva de personal', targetRoles: ['Gerente de Personas'], targetIndustries: ['Retail'] } } };
const ANA = { name: 'Ana', title: 'Gerente de Personas', company: 'Acme', industry: 'Retail', linkedinUrl: 'linkedin.com/in/ana', email: 'ana@acme.cl', leadId: 'lead-ana' };
const LUIS = { name: 'Luis', title: 'Analista contable', company: 'Beta', industry: 'Minería', linkedinUrl: 'linkedin.com/in/luis', leadId: 'lead-luis' };

/** A Supabase client in memory: each table answers its rows; writes and head counts are recorded. */
function fakeAdmin(tables: Record<string, any[]>, count = 0) {
  const upserts: any[] = [];
  const reads: string[] = [];
  const from = (table: string) => {
    let head = false;
    const chain: any = {
      select: (_columns: string, options?: { head?: boolean }) => { head = Boolean(options?.head); return chain; },
      eq: () => chain, in: () => chain, not: () => chain, gte: () => chain, order: () => chain, limit: () => chain,
      maybeSingle: async () => ({ data: (tables[table] || [])[0] ?? null, error: null }),
      upsert: async (rows: any[], options: unknown) => { upserts.push({ table, rows, options }); return { error: null }; },
      then: (resolve: (value: unknown) => void) => { reads.push(table); resolve(head ? { count, error: null } : { data: tables[table] || [], error: null }); },
    };
    return chain;
  };
  return { client: { from } as any, upserts, reads };
}

function fakeModel(answer: (prompt: any) => unknown) {
  const prompts: any[] = [];
  const generate = (async (options: any) => { prompts.push(JSON.parse(options.prompt)); return answer(JSON.parse(options.prompt)); }) as any;
  return { generate, prompts, deps: { generate, now: () => new Date('2026-10-16T12:00:00Z') } };
}
const scoreAll = (prompt: any) => ({ assessments: prompt.personas.map((person: any, index: number) => ({
  ref: person.ref, probability: index === 0 ? 78 : 18, summary: index === 0 ? 'Calza el cargo y la industria.' : 'No calza el cargo.',
  factors: [{ effect: index === 0 ? 'up' : 'down', text: index === 0 ? 'Gerente de Personas en retail' : 'Analista contable' }] })) });
const kept = (key: string, stage: LeadFitStage, probability: number, hash = 'old') => ({ lead_key: key, stage, probability, summary: `Antes ${probability}.`,
  factors: [], model: 'claude-haiku-5-5', input_hash: hash, updated_at: '2026-10-15T10:00:00Z' });

test('without an offer nor a customer in «Perfil» nothing is estimated, and the page is told so', async () => {
  const admin = fakeAdmin({ profiles: [{ company_name: 'Yago', signatures: {} }] });
  const model = fakeModel(scoreAll);
  const result = await assessLeadFit(admin.client, SCOPE, 'search', [ANA], { score: true }, model.deps);
  assert.equal(result.needsProfile, true);
  assert.equal(model.prompts.length, 0);
});

test('people whose facts changed are estimated in one call, starting from their previous stage, and kept', async () => {
  const admin = fakeAdmin({ profiles: [PROFILE], lead_fit_assessments: [kept('li:linkedin.com/in/ana', 'search', 55)], contacted_leads: [] });
  const model = fakeModel(scoreAll);
  const result = await assessLeadFit(admin.client, SCOPE, 'saved', [ANA, LUIS, { ...ANA }], { score: true }, model.deps);
  assert.equal(model.prompts.length, 1, 'one call for the page; the repeated person counts once');
  assert.equal(model.prompts[0].personas.length, 2);
  assert.deepEqual(model.prompts[0].personas[0].estimacion_anterior, { etapa: 'Al buscarlo', probabilidad: 55, porque: 'Antes 55.' });
  assert.equal(model.prompts[0].personas[1].estimacion_anterior, undefined);
  const [{ rows, options }] = admin.upserts;
  assert.deepEqual(options, { onConflict: 'organization_id,user_id,lead_key,stage' });
  assert.deepEqual(rows.map((row: any) => [row.lead_key, row.stage, row.probability, row.model]),
    [['li:linkedin.com/in/ana', 'saved', 78, 'claude-haiku-5-5'], ['li:linkedin.com/in/luis', 'saved', 18, 'claude-haiku-5-5']]);
  assert.equal(rows[0].organization_id, SCOPE.organizationId);
  assert.equal(rows[0].user_id, SCOPE.userId);
  assert.deepEqual(Object.keys(result.results['li:linkedin.com/in/ana']).sort(), ['saved', 'search'], 'the history travels with the new estimate');
  assert.equal(result.results['li:linkedin.com/in/luis'].saved?.summary, 'No calza el cargo.');
});

test('the same facts and «Perfil» reuse the kept estimate without calling the model', async () => {
  const hash = leadFitInputHash('search', leadFitFacts('search', ANA), leadFitProfile(PROFILE));
  const admin = fakeAdmin({ profiles: [PROFILE], lead_fit_assessments: [kept('li:linkedin.com/in/ana', 'search', 61, hash)] });
  const model = fakeModel(scoreAll);
  const result = await assessLeadFit(admin.client, SCOPE, 'search', [ANA], { score: true }, model.deps);
  assert.equal(model.prompts.length, 0);
  assert.equal(result.results['li:linkedin.com/in/ana'].search?.probability, 61);
  const lookOnly = await assessLeadFit(admin.client, SCOPE, 'search', [LUIS], { score: false }, model.deps);
  assert.equal(model.prompts.length, 0, 'a page that only looks never estimates');
  assert.equal(lookOnly.limited, false);
});

test('the daily cap keeps the kept estimates and says the rest come tomorrow', async () => {
  const previous = process.env.LEAD_FIT_DAILY_LIMIT;
  process.env.LEAD_FIT_DAILY_LIMIT = '1';
  try {
    const admin = fakeAdmin({ profiles: [PROFILE], lead_fit_assessments: [] }, 1);
    const model = fakeModel(scoreAll);
    const result = await assessLeadFit(admin.client, SCOPE, 'search', [ANA, LUIS], { score: true }, model.deps);
    assert.equal(result.limited, true);
    assert.equal(model.prompts.length, 0);
  } finally {
    if (previous === undefined) delete process.env.LEAD_FIT_DAILY_LIMIT; else process.env.LEAD_FIT_DAILY_LIMIT = previous;
  }
});

test('when the model fails, the kept estimates still show and nothing is written', async () => {
  const admin = fakeAdmin({ profiles: [PROFILE], lead_fit_assessments: [kept('li:linkedin.com/in/ana', 'search', 40)], contacted_leads: [] });
  const model = fakeModel(() => { throw new Error('overloaded'); });
  const result = await assessLeadFit(admin.client, SCOPE, 'saved', [ANA], { score: true }, model.deps);
  assert.equal(result.failed, true);
  assert.equal(result.results['li:linkedin.com/in/ana'].search?.probability, 40);
  assert.equal(admin.upserts.length, 0);
});

test('after research, the model reads the passages of the user\'s own report', async () => {
  const admin = fakeAdmin({
    profiles: [PROFILE], lead_fit_assessments: [], contacted_leads: [],
    research_snapshots: [{ id: 'snap-1', lead_ref: 'lead-ana', captured_at: '2026-10-15T10:00:00Z' }],
    research_report_documents: [{ research_snapshot_id: 'snap-1', updated_at: '2026-10-15T10:05:00Z',
      document: { summary: { headline: 'Acme abrió tres tiendas y contratará 40 vendedores antes de diciembre.' }, sources: [{ url: 'https://acme.cl' }] } }],
    lead_research_reports: [],
  });
  const model = fakeModel(scoreAll);
  await assessLeadFit(admin.client, SCOPE, 'researched', [ANA], { score: true }, model.deps);
  assert.deepEqual(model.prompts[0].personas[0].datos.informe.extractos, ['Acme abrió tres tiendas y contratará 40 vendedores antes de diciembre.']);
  assert.ok(admin.reads.includes('research_snapshots') && admin.reads.includes('research_report_documents'));
});

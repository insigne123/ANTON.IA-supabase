import assert from 'node:assert/strict';
import test from 'node:test';
import type { JobAd } from '@/lib/commercial-opportunities/hiring';
import type { HiringOpportunityRow, HiringSignalRow } from '@/lib/commercial-opportunities/records';
import { hiringSyncPlan, monthStart, monthlyCapUsd, runHiringSync, type HiringStore } from './sync';
import { FantasticJobsError } from './fantastic-jobs';
import { JSearchRequestError } from './jsearch';

const NOW = '2026-10-02T12:00:00Z';
const ORG = '00000000-0000-4000-8000-000000000002';
const PROFILE = { id: 'p1', name: 'Contratación operativa', offer: '', roles: ['operario', 'bodeguero', 'guardia'], regions: ['Antofagasta'], minAds: 3 };
const ENV = { jsearchKey: 'k', apifyToken: 't', usdPerJob: 0.005 };
const ad = (source: JobAd['source'], externalId: string, title: string, company: string, postedAt = '2026-09-30T12:00:00Z'): JobAd => ({
  source, externalId, title, company, companyDomain: null, companyLinkedinUrl: null, companySize: null, companyIndustry: null,
  location: 'Calama, Antofagasta', region: 'Antofagasta', publisher: source === 'linkedin' ? 'LinkedIn' : 'Computrabajo', url: null, postedAt });

function memoryStore(initial: { spent?: number; running?: boolean; stored?: JobAd[]; existing?: string[] } = {}) {
  const runs: Array<Record<string, unknown>> = [];
  const opportunities = new Map<string, HiringOpportunityRow>();
  const signals: HiringSignalRow[] = [];
  const store: HiringStore = {
    async monthSpentUsd() { return initial.spent ?? 0; },
    async closeStaleRuns() {},
    async hasRunningRun() { return Boolean(initial.running); },
    async startRun(input) { runs.push({ id: `r${runs.length + 1}`, ...input }); return `r${runs.length}`; },
    async finishRun(id, patch) { Object.assign(runs.find(run => run.id === id)!, patch); },
    async recentSignals() { return initial.stored ?? []; },
    async knownCompanies() { return { clients: [], contactsCompanies: ['Sodimac'] }; },
    async existingKeys(keys) { return new Set(keys.filter(key => initial.existing?.includes(key))); },
    async saveOpportunities(rows) { for (const row of rows) opportunities.set(row.dedupe_key, row); return new Map(rows.map(row => [row.dedupe_key, `id-${row.dedupe_key}`])); },
    async saveSignals(rows) { signals.push(...rows); },
  };
  return { store, runs, opportunities, signals };
}

test('the plan says what each source asks and costs, and which key is missing', () => {
  const plan = hiringSyncPlan({ roles: Array.from({ length: 14 }, (_, index) => `cargo ${index}`) }, { jsearchKey: 'k', usdPerJob: 0.005 });
  assert.deepEqual(plan.sources.map(source => [source.source, source.enabled, source.requests, source.estimateUsd, source.missing]),
     [['jsearch', true, 10, 0.025, null], ['linkedin', false, 198, 1, 'APIFY_TOKEN']]);
  assert.equal(plan.estimateUsd, 0.025, 'a source without its key costs nothing');
  assert.equal(monthStart(NOW), '2026-10-01T00:00:00.000Z');
  assert.equal(monthlyCapUsd(undefined), 10);
  assert.equal(monthlyCapUsd('25'), 25);
  assert.equal(monthlyCapUsd('nada'), 10);
});

test('a search regroups the window: three ads from yesterday and two today reach the minimum together', async () => {
  const memory = memoryStore({
    stored: [ad('jsearch', 'old1', 'Operario de bodega', 'Minera Norte S.A.', '2026-09-20T12:00:00Z'), ad('jsearch', 'old2', 'Bodeguero', 'Minera Norte'),
      ad('jsearch', 'old3', 'Guardia de seguridad', 'Minera Norte SpA')],
    existing: ['name:minera norte'],
  });
  const asked: string[] = [];
  const result = await runHiringSync({
    store: memory.store, profile: PROFILE, env: ENV, capUsd: 10, organizationId: ORG, now: NOW,
    sources: {
      jsearch: async input => { asked.push(input.query); return { ads: input.query === 'operario Antofagasta' ? [ad('jsearch', 'n1', 'Operaria de planta', 'Minera Norte S.A.')] : [], requests: 1, costUsd: 0.0025 }; },
      fantastic: async () => ({ ads: [ad('linkedin', 'l1', 'Operario', 'Agrosuper'), ad('linkedin', 'l2', 'Conductor', 'Adecco Chile'),
        ad('linkedin', 'l3', 'Guardia', 'Minera Norte S.A.')], fetched: 3, costUsd: 0.015 }),
    },
  });
  assert.deepEqual(asked, ['operario Antofagasta', 'bodeguero Antofagasta', 'guardia Antofagasta'], 'each role in the region chosen');
  assert.equal(result.status, 'done');
  if (result.status !== 'done') return;
  assert.equal(result.fetched, 4);
  assert.equal(result.costUsd, 0.0225);
  assert.equal(result.qualifying, 1, 'only Minera Norte reaches 3 ads; the agency is never a company');
  assert.equal(result.newQualifying, 0, 'it was already saved');
  const minera = memory.opportunities.get('name:minera norte');
  assert.equal(minera?.signal_count, 5);
  assert.equal(memory.opportunities.has('name:agrosuper'), true, 'a company below the minimum is saved, so its ads are kept');
  assert.equal([...memory.opportunities.keys()].some(key => key.includes('adecco')), false);
  // Only this search's ads are written again; the stored ones stay as they are.
  assert.deepEqual(memory.signals.map(signal => signal.external_id).sort(), ['l1', 'l3', 'n1']);
  assert.equal(memory.signals.find(signal => signal.external_id === 'n1')?.opportunity_id, 'id-name:minera norte');
  const [jsearchRun, linkedinRun] = memory.runs;
  assert.deepEqual([jsearchRun.status, jsearchRun.fetched, jsearchRun.costUsd, jsearchRun.updated], ['succeeded', 1, 0.0075, 1]);
  assert.deepEqual([linkedinRun.status, linkedinRun.fetched, linkedinRun.created, linkedinRun.updated], ['succeeded', 3, 1, 1]);
});

test('the monthly cap is checked before spending: the search is recorded as skipped and nothing is asked', async () => {
  const memory = memoryStore({ spent: 9.5 });
  const result = await runHiringSync({
    store: memory.store, profile: PROFILE, env: ENV, capUsd: 10, organizationId: ORG, now: NOW,
    sources: { jsearch: async () => assert.fail('no request over the cap'), fantastic: async () => assert.fail('no request over the cap') },
  });
  assert.equal(result.status, 'capped');
  assert.deepEqual(memory.runs.map(run => [run.source, run.status]), [['jsearch', 'skipped'], ['linkedin', 'skipped']]);
  assert.match(String(memory.runs[0].error), /Tope mensual: US\$9,50 gastados de US\$10,00; esta búsqueda costaría hasta US\$1,01/);
});

test('a source that fails does not stop the other; a rejected key stops asking that source', async () => {
  const memory = memoryStore();
  let calls = 0;
  const result = await runHiringSync({
    store: memory.store, profile: { ...PROFILE, roles: ['operario', 'bodeguero', 'guardia', 'cajero', 'vendedor'] }, env: ENV, capUsd: 10, organizationId: ORG, now: NOW,
    sources: {
      jsearch: async () => { calls++; throw new Error('JSearch rechazó la clave o la suscripción.'); },
      fantastic: async () => ({ ads: [1, 2, 3].map(index => ad('linkedin', `l${index}`, `Bodeguero ${index}`, 'Sodimac')), fetched: 3, costUsd: 0.015 }),
    },
  });
  assert.equal(calls, 1, 'a rejected key stops immediately, without a three-query burst');
  assert.equal(result.status, 'partial');
  assert.equal(result.qualifying, 1);
  assert.match(result.sources[0].error || '', /^1 de 1 consultas fallaron: JSearch rechazó la clave/);
  assert.equal(memory.runs[0].status, 'failed');
  assert.equal(memory.runs[1].status, 'succeeded');
  assert.match(String(memory.opportunities.get('name:sodimac')?.reasons.join(' ')), /ya tienes contactos ahí/);
});

test('without roles, without keys or with a search running, nothing starts', async () => {
  const sources = { jsearch: async () => assert.fail('not asked'), fantastic: async () => assert.fail('not asked') };
  await assert.rejects(runHiringSync({ store: memoryStore().store, profile: { ...PROFILE, roles: [] }, env: ENV, capUsd: 10, organizationId: ORG, sources }),
    (error: Error & { status?: number }) => error.status === 400);
  await assert.rejects(runHiringSync({ store: memoryStore().store, profile: PROFILE, env: { usdPerJob: 0.005 }, capUsd: 10, organizationId: ORG, sources }),
    (error: Error & { status?: number }) => error.status === 503 && /JSEARCH_API_KEY/.test(error.message));
  await assert.rejects(runHiringSync({ store: memoryStore({ running: true }).store, profile: PROFILE, env: ENV, capUsd: 10, organizationId: ORG, sources }),
    (error: Error & { status?: number }) => error.status === 409);
});

test('if saving fails, every run is closed as failed and the error goes up', async () => {
  const memory = memoryStore();
  memory.store.saveOpportunities = async () => { throw new Error('No se pudo guardar las empresas.'); };
  await assert.rejects(runHiringSync({
    store: memory.store, profile: PROFILE, env: ENV, capUsd: 10, organizationId: ORG, now: NOW,
    sources: { jsearch: async () => ({ ads: [ad('jsearch', 'j1', 'Operario', 'Acme')], requests: 1, costUsd: 0.0025 }), fantastic: async () => ({ ads: [], fetched: 0, costUsd: 0 }) },
  }), /guardar las empresas/);
  assert.deepEqual(memory.runs.map(run => run.status), ['failed', 'failed']);
  assert.match(String(memory.runs[0].error), /^No se pudo guardar:/);
});

test('an uncertain paid Apify run reserves its hard cap in the monthly estimate; daily JSearch-only sync never starts Apify', async () => {
  const memory = memoryStore();
  const result = await runHiringSync({ store: memory.store, profile: PROFILE, env: ENV, capUsd: 10, organizationId: ORG, now: NOW,
    only: ['linkedin'], sources: { jsearch: async () => assert.fail('not selected'), fantastic: async () => { throw Error('Apify timeout'); } } });
  assert.equal(result.status, 'failed');
  assert.equal(memory.runs[0].status, 'failed');
  assert.equal(memory.runs[0].costUsd, 1);
  assert.match(String(memory.runs[0].error), /reserva el tope/);
  const daily = memoryStore();
  await runHiringSync({ store: daily.store, profile: PROFILE, env: ENV, capUsd: 10, organizationId: ORG, now: NOW,
    only: ['jsearch'], sources: { jsearch: async () => ({ ads: [], requests: 1, costUsd: 0.0025 }), fantastic: async () => assert.fail('daily sync never spends on Apify') } });
  assert.equal(daily.runs.length, 1);
  assert.equal(daily.runs[0].source, 'jsearch');
});

test('rejected Apify input is not recorded as a paid run; all sources failing is not an empty success', async () => {
  const memory = memoryStore({ stored: [ad('jsearch', 'old', 'Operario', 'Empresa anterior')] });
  const result = await runHiringSync({ store: memory.store, profile: PROFILE, env: ENV, capUsd: 10, organizationId: ORG, now: NOW,
    sources: {
      jsearch: async () => { throw new JSearchRequestError('JSearch limitó temporalmente las consultas.', 0, [], true); },
      fantastic: async () => { throw new FantasticJobsError('Apify rechazó los parámetros.', false); },
    } });
  assert.equal(result.status, 'failed');
  assert.deepEqual(memory.runs.map(run => [run.status, run.costUsd]), [['failed', 0], ['failed', 0]]);
  assert.equal(result.costUsd, 0);
  assert.doesNotMatch(String(memory.runs[1].error), /reserva/);
});

test('JSearch queries are spaced, uncertainty is counted and useful partial results survive', async () => {
  const memory = memoryStore();
  const waits: number[] = [];
  const asked: string[] = [];
  const result = await runHiringSync({ store: memory.store, profile: PROFILE, env: ENV, capUsd: 10, organizationId: ORG, now: NOW,
    only: ['jsearch'], wait: async ms => { waits.push(ms); }, sources: {
      jsearch: async input => {
        asked.push(input.query);
        if (input.query === 'bodeguero Antofagasta') throw new JSearchRequestError('JSearch respondió 500.', 0.0025);
        return { ads: [ad('jsearch', input.query, input.query, 'Acme')], requests: 1, costUsd: 0.0025 };
      }, fantastic: async () => assert.fail('not selected'),
    } });
  assert.deepEqual(waits, [1100, 1100]);
  assert.deepEqual(asked, PROFILE.roles.map(role => `${role} Antofagasta`));
  assert.equal(result.status, 'partial');
  assert.equal(memory.runs[0].costUsd, 0.0075);
  assert.equal(memory.signals.length, 2);
});

test('each role brings its variants: they are asked too, an ad for one counts for its role, and other regions do not count', async () => {
  const memory = memoryStore();
  const asked: string[] = [];
  const titles: string[][] = [];
  const places: string[][] = [];
  const variants = { operario: ['operator', 'ayudante de producción'] };
  const plan = hiringSyncPlan(PROFILE, ENV, { variants, cap: 4 });
  assert.deepEqual(plan.queries, ['operario Antofagasta', 'bodeguero Antofagasta', 'guardia Antofagasta', 'operator Antofagasta']);
  assert.equal(plan.left, 1, 'what does not fit is reported');
  const result = await runHiringSync({ store: memory.store, profile: PROFILE, env: ENV, capUsd: 10, organizationId: ORG, now: NOW, variants, queryCap: 4,
    wait: async () => {}, sources: {
      jsearch: async input => { asked.push(input.query); return { ads: [], requests: 1, costUsd: 0.0025 }; },
      fantastic: async input => {
        titles.push(input.titles); places.push(input.locations || []);
        const santiago = { ...ad('linkedin', 'l4', 'Machine Operator', 'Minera Norte S.A.'), location: 'Santiago', region: 'Metropolitana' };
        return { ads: [ad('linkedin', 'l1', 'Machine Operator', 'Minera Norte S.A.'), ad('linkedin', 'l2', 'Operario', 'Minera Norte S.A.'),
          ad('linkedin', 'l3', 'Bodeguero', 'Minera Norte S.A.'), santiago], fetched: 4, costUsd: 0.02 };
      },
    } });
  assert.deepEqual(asked, plan.queries);
  assert.deepEqual(titles, [['operario', 'bodeguero', 'guardia', 'operator', 'ayudante de producción']]);
  assert.deepEqual(places, [['Antofagasta, Chile']]);
  assert.equal(result.status, 'done');
  const minera = memory.opportunities.get('name:minera norte');
  assert.equal(minera?.signal_count, 3, 'the ad from Santiago is left out of the count');
  assert.deepEqual(minera?.data.roles, [{ role: 'operario', ads: 2 }, { role: 'bodeguero', ads: 1 }], '«Machine Operator» counts for «operario»');
});

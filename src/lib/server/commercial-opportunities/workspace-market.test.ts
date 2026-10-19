import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

// «Mercado público» with the database, ChileCompra's history and the model in memory.
async function load() {
  const stubs: Record<string, string> = {
    '@/lib/server/auth-utils': 'export class AuthError extends Error {constructor(message,status){super(message);this.status=status}}',
    './workspace-access': `export function assertOpportunityAdmin(scope){ if (scope.role !== "admin" && scope.role !== "owner") { const e = new Error("Esta acción corresponde a un administrador."); e.status = 403; throw e } }
      export async function assertOpportunityRead(){ return true }`,
    './workspace-store': `export function opportunityDb(result){ if (result.error) throw result.error; return result.data }
      export async function createPrivateOpportunity(client, scope, input, options){ globalThis.__created = { input, options }; return "op-1" }
      export async function addOpportunityActivity(client, scope, id, kind, body){ (globalThis.__activity ||= []).push(body) }`,
    './workspace-ai': 'export async function opportunityGenerate(client, job, input){ (globalThis.__calls ||= []).push(input); return globalThis.__answer(input) }',
    './tender-profile-read': 'export async function loadCompanyForModel(){ return null } export async function loadTenderProfile(){ return globalThis.__profile ?? null }',
    '@/lib/server/public-procurement/market': `export async function readMarketCoverage(){ return globalThis.__coverage ?? { available: true, from: "2022-11-01", to: "2026-10-01", loadedAt: null } }
      export async function readAgencyHistory(){ return globalThis.__history }
      export async function readSupplierProfile(){ return null } export async function searchSuppliers(){ return [] }
      export async function suggestCompetitors(){ return { basis: "none", own: null, items: [] } }`,
  };
  const bundle = await build({
    stdin: { contents: `export * from './src/lib/server/commercial-opportunities/workspace-market';`, loader: 'ts', resolveDir: process.cwd() },
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

/** The tables in memory, with the query methods the module uses. */
function memory(seed: Record<string, any[]> = {}, rpc: Record<string, (args: any) => any> = {}) {
  const tables: Record<string, any[]> = { opportunity_jobs: [], opportunity_competitors: [], commercial_opportunities: [], ...seed };
  let serial = 0;
  const from = (name: string) => {
    const filters: Array<(row: any) => boolean> = [];
    let action: { kind: string; values?: any; conflict?: string[]; ignore?: boolean; count?: boolean } = { kind: 'select' };
    let one: 'single' | 'maybe' | null = null; let limit = Infinity; let order: { key: string; ascending: boolean } | null = null;
    const run = () => {
      const rows = tables[name] ||= [];
      if (action.kind === 'upsert' || action.kind === 'insert') {
        const values = (Array.isArray(action.values) ? action.values : [action.values]).map((value: any) => ({ id: `${name}-${++serial}`, state: 'queued', created_at: new Date(Date.now() + serial).toISOString(), ...value }));
        const written: any[] = [];
        for (const value of values) {
          const clash = action.conflict && rows.find(row => action.conflict!.every(key => row[key] === value[key]));
          if (clash) { if (!action.ignore) Object.assign(clash, value); continue; }
          rows.push(value); written.push(value);
        }
        return { data: one ? written[0] ?? null : written, error: null };
      }
      let found = rows.filter(row => filters.every(filter => filter(row)));
      if (action.kind === 'delete') { tables[name] = rows.filter(row => !found.includes(row)); return { data: null, error: null }; }
      if (action.kind === 'update') { found.forEach(row => Object.assign(row, action.values)); return { data: null, error: null }; }
      if (action.count) return { data: null, error: null, count: found.length };
      if (order) found = [...found].sort((a, b) => String(a[order!.key]).localeCompare(String(b[order!.key])) * (order!.ascending ? 1 : -1));
      found = found.slice(0, limit);
      if (one === 'single') return found.length ? { data: found[0], error: null } : { data: null, error: { code: 'PGRST116' } };
      if (one === 'maybe') return { data: found[0] ?? null, error: null };
      return { data: found, error: null };
    };
    const chain: any = {
      select: (_columns?: string, options?: { count?: string; head?: boolean }) => { if (options?.head) action.count = true; return chain; },
      insert: (values: any) => { action = { kind: 'insert', values }; return chain; },
      upsert: (values: any, options: any) => { action = { kind: 'upsert', values, conflict: options?.onConflict?.split(','), ignore: options?.ignoreDuplicates }; return chain; },
      update: (values: any) => { action = { kind: 'update', values }; return chain; },
      delete: () => { action = { kind: 'delete' }; return chain; },
      eq: (key: string, value: any) => { filters.push(row => row[key] === value); return chain; },
      in: (key: string, values: any[]) => { filters.push(row => values.includes(row[key])); return chain; },
      like: (key: string, pattern: string) => { const re = new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*')}$`); filters.push(row => re.test(String(row[key]))); return chain; },
      order: (key: string, options?: { ascending?: boolean }) => { order = { key, ascending: options?.ascending !== false }; return chain; },
      limit: (n: number) => { limit = n; return chain; },
      single: () => { one = 'single'; return chain; },
      maybeSingle: () => { one = 'maybe'; return chain; },
      then: (resolve: any, reject: any) => Promise.resolve().then(run).then(resolve, reject),
    };
    return chain;
  };
  return { tables, client: { from, rpc: async (fn: string, args: any) => (rpc[fn] ? { data: rpc[fn](args), error: null } : { data: null, error: { code: 'PGRST202' } }) } as any };
}

const admin = { organizationId: 'org-1', userId: 'u-1', role: 'admin' };
const context = { revision: 3, offer: 'Aseo industrial para edificios públicos', services: ['Aseo de oficinas'], exclusions: [], criteria: { keywords: ['aseo', 'limpieza'] } };
const expiring = (id: number, values: Record<string, unknown> = {}) => ({ tender_id: id, code: `2770-${id}-LE24`, name: `Servicio de aseo ${id}`, agency: 'I MUNICIPALIDAD DE MAIPU',
  region: 'Región Metropolitana', category: 'Servicios de limpieza', awarded_on: '2024-12-01', duration_months: '24.0', ends_on: '2026-12-01', amount: 90_000_000,
  currency: 'CLP', winner_rut: '76020266-5', winner_name: 'Aseo Norte SpA', winners: 1, ...values });

test('«Contratos por vencer» keeps only what the model chose from the batch, with its reason', async () => {
  const { runMarketContracts } = await load();
  const seen: any[] = [];
  const { client } = memory({}, { public_procurement_expiring: args => { seen.push(args); return [expiring(1), expiring(2), expiring(3, { ends_on: null, duration_months: '12', awarded_on: '2025-11-15' })]; } });
  (globalThis as any).__answer = () => ({ matches: [{ id: ' 1 ', fit: 'alta', reason: ' Aseo  de  edificios ' }, { id: '3', fit: 'media', reason: 'Limpieza' }, { id: '99', fit: 'alta', reason: 'inventado' }] });
  const job = { id: 'job-1', organization_id: 'org-1', requested_by: 'u-1', payload: { revision: 3 } };
  const result = await runMarketContracts(client, job, context, Date.now());
  assert.equal(result.waiting, false);
  assert.deepEqual(result.contracts.map((item: any) => [item.tenderId, item.fit, item.reason, item.endsOn]), [[1, 'alta', 'Aseo de edificios', '2026-12-01'], [3, 'media', 'Limpieza', '2026-11-15']]);
  assert.deepEqual(seen[0].p_patterns, ['%aseo%', '%limpieza%', '%aseo de oficinas%'], 'the words and the short services');
  assert.equal(result.read, 3);
  // Out of time, it resumes in the next tick instead of losing the batches.
  assert.deepEqual(await runMarketContracts(client, job, context, Date.now() - 300_000), { waiting: true });
  await assert.rejects(runMarketContracts(client, job, { ...context, criteria: {}, services: [] }, Date.now()), /Faltan las palabras/);
  // A history that is there but did not answer in time is not a history «not loaded yet».
  await assert.rejects(runMarketContracts(memory().client, job, context, Date.now()), /Aún no cargamos el historial/);
  const slow = { ...client, rpc: async () => ({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }) };
  await assert.rejects(runMarketContracts(slow, job, context, Date.now()), (error: any) => /No pudimos leer el historial/.test(error.message) && error.status === 409);
});

test('the month\'s «Contratos por vencer» is queued once and, if it stopped blocked, again with the next search', async () => {
  const { enqueueMonthlyContracts } = await load();
  const { tables, client } = memory();
  await enqueueMonthlyContracts(client, admin, context, '2026-10-19');
  await enqueueMonthlyContracts(client, admin, context, '2026-10-19');
  assert.deepEqual(tables.opportunity_jobs.map(job => [job.kind, job.dedupe_key, job.state]), [['contracts', 'contracts:2026-10:3', 'queued']]);
  // The search is asked every minute: a reading that just stopped waits 6 hours before trying again.
  Object.assign(tables.opportunity_jobs[0], { state: 'blocked', error: 'No pudimos leer el historial de ChileCompra ahora.', updated_at: new Date(Date.now() - 60_000).toISOString() });
  await enqueueMonthlyContracts(client, admin, context, '2026-10-19');
  assert.equal(tables.opportunity_jobs[0].state, 'blocked', 'not every minute');
  Object.assign(tables.opportunity_jobs[0], { updated_at: new Date(Date.now() - 7 * 3600_000).toISOString() });
  await enqueueMonthlyContracts(client, admin, context, '2026-10-20');
  assert.deepEqual([tables.opportunity_jobs[0].state, tables.opportunity_jobs[0].error], ['queued', null]);
  Object.assign(tables.opportunity_jobs[0], { state: 'ready' });
  await enqueueMonthlyContracts(client, admin, context, '2026-10-21');
  assert.equal(tables.opportunity_jobs[0].state, 'ready', 'a finished reading stays until next month');
  await enqueueMonthlyContracts(client, admin, context, '2026-11-01');
  assert.deepEqual(tables.opportunity_jobs.map(job => job.dedupe_key), ['contracts:2026-10:3', 'contracts:2026-11:3']);
});

test('«Seguir» a contract opens one opportunity per workspace, with who holds it and until when', async () => {
  const { followExpiringContract } = await load();
  const contract = { tenderId: 1, code: '2770-1-LE24', name: 'Servicio de aseo edificio consistorial', agency: 'I MUNICIPALIDAD DE MAIPU', region: null, category: null,
    awardedOn: '2024-12-01', durationMonths: 24, endsOn: '2026-12-01', amount: 90_000_000, currency: 'CLP', winnerRut: '76020266-5', winnerName: 'Aseo Norte SpA', winners: 1, fit: 'alta', reason: 'Aseo de edificios' };
  const { client } = memory({ opportunity_jobs: [{ id: 'j1', organization_id: 'org-1', kind: 'contracts', state: 'ready', created_at: '2026-10-01', updated_at: '2026-10-01', result: { contracts: [contract], read: 4 } }] });
  assert.equal(await followExpiringContract(client, admin, 1), 'op-1');
  const { input, options } = (globalThis as any).__created;
  assert.equal(input.title, 'Renovación: Servicio de aseo edificio consistorial');
  assert.equal(input.company, 'I MUNICIPALIDAD DE MAIPU');
  assert.match(input.description, /a Aseo Norte SpA \(RUT 76\.020\.266-5\) el 1 de diciembre de 2024 por 24 meses, por \$90 millones/);
  assert.match(input.description, /vence cerca del 1 de diciembre de 2026/);
  assert.equal(input.url, 'https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=2770-1-LE24');
  assert.equal(options.dedupeKey, 'contract:2770-1-LE24');
  await assert.rejects(followExpiringContract(client, admin, 2), /ya no está en la lista/);
  await assert.rejects(followExpiringContract(client, { ...admin, role: 'member' }, 1), /administrador/);
});

test('«Cómo ganar» is for public tenders with history, asked once per click', async () => {
  const { enqueueWinPlan } = await load();
  const { client, tables } = memory({ commercial_opportunities: [{ id: 'o1', organization_id: 'org-1', kind: 'tender' }, { id: 'o2', organization_id: 'org-1', kind: 'hiring' }] });
  const member = { ...admin, role: 'member' };
  const first = await enqueueWinPlan(client, member, 'o1', { requestId: 'r1' });
  assert.equal(await enqueueWinPlan(client, member, 'o1', { requestId: 'r1' }), first, 'a double click asks once');
  assert.notEqual(await enqueueWinPlan(client, member, 'o1', { requestId: 'r2' }), first, '«Preparar de nuevo» asks again');
  assert.deepEqual(tables.opportunity_jobs.map(job => [job.kind, job.dedupe_key]), [['winplan', 'winplan:o1:r1'], ['winplan', 'winplan:o1:r2']]);
  await assert.rejects(enqueueWinPlan(client, member, 'o2', { requestId: 'r3' }), /licitaciones y Compra Ágil/);
  (globalThis as any).__coverage = { available: false };
  await assert.rejects(enqueueWinPlan(client, member, 'o1', { requestId: 'r4' }), /Aún no cargamos el historial/);
  delete (globalThis as any).__coverage;
});

test('the strategy is written from the history, and none is written without something to compare', async () => {
  const { runWinPlan, reportForWinPlan } = await load();
  const tender = { id: 1, code: '2770-48-LR25', name: 'Mantención de áreas verdes', agency: 'I MUNICIPALIDAD DE MAIPU', status: 'adjudicada', kind: 'LR', currency: 'CLP',
    estimatedAmount: 100_000_000, awardedAmount: 80_000_000, bidders: 5, publishedOn: '2025-04-24', awardedOn: '2025-06-01', durationMonths: 24, category: null,
    winners: [{ rut: '76020266-5', name: 'Núcleo Paisajismo SpA', amount: 80_000_000 }], bids: [{ rut: '76020266-5', name: 'Núcleo Paisajismo SpA', offered: 80_000_000, selected: true }], score: 0.8 };
  const { client } = memory({
    commercial_opportunities: [{ id: 'o1', organization_id: 'org-1', kind: 'tender', title: 'Mantención de áreas verdes 2027', buyer_name: 'Municipalidad de Maipú', amount: 120_000_000, currency: 'CLP', deadline_at: null, data: {} }],
    opportunity_company_context: [{ organization_id: 'org-1', offer: 'Paisajismo', services: [] }],
    opportunity_reports: [],
  });
  (globalThis as any).__history = { available: true, agency: { ids: [7], name: 'I MUNICIPALIDAD DE MAIPU', sector: null }, similar: [tender], agencyStats: null, market: null,
    coverage: { available: true, from: '2022-11-01', to: '2026-10-01', loadedAt: null } };
  (globalThis as any).__calls = [];
  (globalThis as any).__answer = () => ({ summary: 'Ofertar cerca del 80 %.', price: { low: 90_000_000, high: 100_000_000, basis: '80 % del estimado.' }, highlights: [], risks: [],
    competitors: [{ rut: '76020266-5', why: 'Ganó la última.' }], confidence: 'media' });
  const job = { id: 'job-2', organization_id: 'org-1', requested_by: 'u-1', opportunity_id: 'o1', payload: {} };
  const result = await runWinPlan(client, job);
  assert.equal((globalThis as any).__calls[0].role, 'report');
  assert.match((globalThis as any).__calls[0].prompt, /Núcleo Paisajismo SpA \[76020266-5\]/);
  assert.deepEqual(result.plan.competitors, [{ rut: '76020266-5', why: 'Ganó la última.', name: 'Núcleo Paisajismo SpA', wins: 1 }]);
  assert.deepEqual(result.basis, { agency: 'I MUNICIPALIDAD DE MAIPU', similar: 1, market: 0, deserted: 0, medianBidders: null, coverage: { from: '2022-11-01', to: '2026-10-01' } });
  (globalThis as any).__history = { ...(globalThis as any).__history, similar: [] };
  await assert.rejects(runWinPlan(client, job), /No encontramos licitaciones parecidas/);

  const report = reportForWinPlan({ sections: [{ id: 's4', title: 'Cómo se evalúa y cómo ganar puntaje', paragraphs: ['Precio 60 %, experiencia 40 %.'] }, { id: 's1', title: 'Decisión', paragraphs: ['Postular.'] }],
    requirements: [{ title: 'Boleta de garantía' }], risks: [{ title: 'Multas altas' }] });
  assert.deepEqual(report, { criteria: ['Precio 60 %, experiencia 40 %.'], requirements: ['Boleta de garantía'], risks: ['Multas altas'] });
  assert.equal(reportForWinPlan(null), null);
});

test('the radar follows up to 30 competitors and lets them go', async () => {
  const { followCompetitor } = await load();
  const { client, tables } = memory({ opportunity_competitors: Array.from({ length: 29 }, (_, i) => ({ organization_id: 'org-1', supplier_id: i + 1 })) });
  assert.deepEqual(await followCompetitor(client, admin, 100, true), { following: true });
  await assert.rejects(followCompetitor(client, admin, 101, true), /hasta 30 competidores/);
  assert.deepEqual(await followCompetitor(client, admin, 100, false), { following: false });
  assert.equal(tables.opportunity_competitors.length, 29);
  await assert.rejects(followCompetitor(client, { ...admin, role: 'member' }, 5, true), /administrador/);
});

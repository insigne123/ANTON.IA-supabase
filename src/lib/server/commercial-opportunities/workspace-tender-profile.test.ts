import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

// «Ficha para licitaciones» with the database and the model in memory: saves, the AI's suggestions, the review of the
// discards, and the screening that reads it.
const AUTH = 'export class AuthError extends Error {constructor(message,status){super(message);this.status=status}}';
async function load(entry: string, extra: Record<string, string> = {}) {
  const stubs: Record<string, string> = {
    '@/lib/server/auth-utils': AUTH,
    './workspace-access': `import { AuthError } from '@/lib/server/auth-utils';
      export async function assertOpportunityRead(){} export async function readableOpportunityIds(){ return null }
      export function assertOpportunityAdmin(scope){ if (!['admin','owner'].includes(scope.role)) throw new AuthError('Esta acción corresponde a un administrador.', 403) }`,
    './workspace-ai': 'export async function opportunityGenerate(client, job, options){ globalThis.__call = options; return globalThis.__reply(options) }',
    './workspace-download': 'export async function downloadOpportunitySource(url){ globalThis.__downloaded = url; return globalThis.__page() }',
    ...extra,
  };
  const bundle = await build({
    stdin: { contents: entry, loader: 'ts', resolveDir: process.cwd() },
    bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external',
    plugins: [{ name: 'stubs', setup(builder) {
      const filter = new RegExp(`(${Object.keys(stubs).map(name => name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('|')})$`);
      builder.onResolve({ filter }, args => ({ path: args.path, namespace: 'stub' }));
      builder.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ loader: 'js', contents: stubs[Object.keys(stubs).find(name => args.path.endsWith(name))!], resolveDir: process.cwd() }));
    } }],
  });
  const compiled: { exports: any } = { exports: {} };
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);
  return compiled.exports;
}
const profileModule = () => load(`export * from './src/lib/server/commercial-opportunities/workspace-tender-profile';`);

/** Enough of supabase-js: `data->>field` filters, a unique key on insert, and tables that may not exist yet. */
function memory(seed: Record<string, any[]> = {}, missing: string[] = []) {
  let serial = 0;
  const tables: Record<string, any[]> = { opportunity_tender_profile: [], opportunity_jobs: [], commercial_opportunities: [], opportunity_company_context: [],
    organization_members: [], profiles: [], opportunity_evaluations: [], ...seed };
  const read = (row: any, key: string) => { const [column, field] = key.split('->>'); return field ? (row[column]?.[field] === undefined ? undefined : String(row[column][field])) : row[column]; };
  const query = (name: string) => {
    const filters: Array<(row: any) => boolean> = [];
    let action: { kind: string; values?: any; conflict?: string[]; ignore?: boolean } = { kind: 'select' };
    const run = () => {
      if (missing.includes(name)) return { data: null, error: { code: '42P01', message: 'missing' } };
      const match = (row: any) => filters.every(filter => filter(row));
      if (action.kind === 'insert') {
        const value = action.values;
        if (name === 'opportunity_tender_profile' && tables[name].some(row => row.organization_id === value.organization_id)) return { data: null, error: { code: '23505', message: 'duplicate' } };
        tables[name].push({ id: `row-${++serial}`, ...value }); return { data: [value], error: null };
      }
      if (action.kind === 'upsert') {
        for (const value of [].concat(action.values) as any[]) {
          const index = tables[name].findIndex(row => action.conflict!.every(key => row[key] === value[key]));
          if (index >= 0 && action.ignore) continue;
          if (index >= 0) tables[name][index] = { ...tables[name][index], ...value }; else tables[name].push({ id: `row-${++serial}`, state: 'queued', ...value });
        }
        return { data: null, error: null };
      }
      if (action.kind === 'update') {
        const changed = tables[name].filter(match);
        tables[name] = tables[name].map(row => match(row) ? { ...row, ...action.values } : row);
        return { data: changed.map(row => ({ ...row, ...action.values })), error: null };
      }
      return { data: tables[name].filter(match), error: null };
    };
    const first = () => { const result = run(); return { data: Array.isArray(result.data) ? result.data[0] ?? null : result.data, error: result.error }; };
    const builder: any = {
      select: () => builder, insert: (values: any) => { action = { kind: 'insert', values }; return builder; },
      upsert: (values: any, opts: any) => { action = { kind: 'upsert', values, conflict: String(opts.onConflict).split(','), ignore: Boolean(opts.ignoreDuplicates) }; return builder; },
      update: (values: any) => { action = { kind: 'update', values }; return builder; },
      eq: (key: string, value: unknown) => { filters.push(row => read(row, key) === (typeof value === 'number' && key.includes('->>') ? String(value) : value)); return builder; },
      in: (key: string, values: unknown[]) => { filters.push(row => values.includes(read(row, key))); return builder; },
      order: () => builder, limit: () => builder,
      maybeSingle: async () => first(), single: async () => first(),
      then: (resolve: (value: unknown) => void) => resolve(run()),
    };
    return builder;
  };
  return { tables, client: { from: query, rpc: async () => ({ data: null, error: null }) } as any };
}
const admin = { organizationId: 'org', userId: 'a1', role: 'admin' };
const blank = { legalName: null, rut: null, size: null, employees: null, yearsOperating: null, regions: null, staffCapacity: null, contractMin: null, contractMax: null,
  publicExperience: null, publicContracts: null, privateClients: null, providerRegistry: null, certifications: null, otherCertifications: null, guaranteeMax: null, insurance: null, assets: null, limits: null };

test('the profile is saved by admins only, and a save over another admin\'s newer one is refused', async () => {
  const { saveTenderProfile, readTenderProfileView } = await profileModule();
  const { tables, client } = memory();
  await assert.rejects(saveTenderProfile(client, { ...admin, role: 'member' }, { profile: blank, expectedRevision: 0 }), (error: any) => error.status === 403);
  const first = await saveTenderProfile(client, admin, { profile: { ...blank, legalName: 'Aseo Sur SpA', rut: '760864285', regions: ['Los Lagos'] }, expectedRevision: 0 });
  assert.equal(first.revision, 1);
  assert.equal(tables.opportunity_tender_profile[0].answers.rut, '76.086.428-5', 'saved normalized');
  assert.deepEqual(first.progress, { answered: 3, total: 16 });
  await assert.rejects(saveTenderProfile(client, admin, { profile: blank, expectedRevision: 0 }), (error: any) => error.status === 409, 'a second first save');
  const second = await saveTenderProfile(client, admin, { profile: { ...blank, legalName: 'Aseo Sur SpA', employees: 40 }, expectedRevision: 1 });
  assert.equal(second.revision, 2);
  await assert.rejects(saveTenderProfile(client, admin, { profile: blank, expectedRevision: 1 }), (error: any) => error.status === 409, 'a stale revision');
  await assert.rejects(saveTenderProfile(client, admin, { profile: { ...blank, rut: '76.086.428-4' }, expectedRevision: 2 }), /dígito verificador/);
  const view = await readTenderProfileView(client, admin);
  assert.deepEqual([view.available, view.revision, view.profile.employees], [true, 2, 40]);
  assert.deepEqual((await readTenderProfileView(memory({}, ['opportunity_tender_profile']).client, admin)).available, false, 'before the migration');
});

test('«Revisar de nuevo» sends the open discards for a requirement or scale back to the AI, once per profile version', async () => {
  const { readTenderProfileView, reconsiderWithTenderProfile } = await profileModule();
  const future = new Date(Date.now() + 5 * 86_400_000).toISOString();
  const past = new Date(Date.now() - 86_400_000).toISOString();
  const discard = (id: string, motive: string, deadline: string | null, revision = 3) => ({ id, organization_id: 'org', deadline_at: deadline,
    data: { evaluation: 'excluded', excludedMotive: motive, profileRevision: revision } });
  const { tables, client } = memory({
    opportunity_company_context: [{ organization_id: 'org', revision: 3 }],
    opportunity_tender_profile: [{ organization_id: 'org', answers: {}, revision: 2 }],
    commercial_opportunities: [discard('o1', 'requisito', future), discard('o2', 'escala', null), discard('o3', 'otro_producto', future), discard('o4', 'requisito', past),
      discard('o5', 'requisito', future, 2), { id: 'o6', organization_id: 'org', deadline_at: future, data: { evaluation: 'recommended' } }],
  });
  assert.equal((await readTenderProfileView(client, admin)).reconsiderable, 3, 'requirement and scale, still open');
  assert.equal(await reconsiderWithTenderProfile(client, admin), 2, 'only those read with the current offer');
  assert.deepEqual(tables.opportunity_jobs.map(job => [job.kind, job.dedupe_key, job.payload]), [['evaluate', 'profile-review:2:3:0', { ids: ['o1', 'o2'], revision: 3 }]]);
  await reconsiderWithTenderProfile(client, admin);
  assert.equal(tables.opportunity_jobs.length, 1, 'pressing twice does not pay twice');
  await assert.rejects(reconsiderWithTenderProfile(memory({ opportunity_company_context: [{ organization_id: 'org', revision: 3 }] }).client, admin), /Guarda primero la ficha/);
});

test('«Completar con IA» reads Perfil, the website and the offer, and suggests only what is blank', async () => {
  const { runTenderProfileSuggestion } = await profileModule();
  const { client } = memory({
    opportunity_company_context: [{ organization_id: 'org', offer: 'Aseo industrial y hospitalario en el sur', services: ['Aseo hospitalario'], territories: ['Los Lagos'], exclusions: [] }],
    organization_members: [{ organization_id: 'org', user_id: 'a1', role: 'admin' }, { organization_id: 'org', user_id: 'm1', role: 'member' }],
    profiles: [{ id: 'a1', company_name: 'Aseo Sur', company_domain: 'aseosur.cl', company_profile: 'Somos Aseo Sur, 15 años en Chiloé', signatures: { profile_extended: { referenceClients: ['Hospital de Castro'] } } },
      { id: 'm1', company_name: 'No debe leerse', company_domain: 'otro.cl', company_profile: 'Perfil de un integrante' }],
    opportunity_tender_profile: [{ organization_id: 'org', answers: { legalName: 'Aseo Sur SpA' }, revision: 1 }],
  });
  (globalThis as any).__page = () => ({ mime: 'text/html', bytes: Buffer.from('<html><head><style>x{}</style></head><body><main>Aseo hospitalario e industrial para clínicas, hospitales y plantas del sur de Chile.</main><footer>Aseo Sur SpA · RUT 76.086.428-5 · Certificación ISO 9001</footer><script>evil()</script></body></html>') });
  (globalThis as any).__reply = () => ({ legalName: 'Otra', rut: '76.086.428-5', size: null, employees: null, yearsOperating: 15, regions: ['Los Lagos'], publicExperience: 'si',
    publicContracts: 'Hospital de Castro', privateClients: null, certifications: ['ISO 9001'], otherCertifications: null, assets: null, limits: null,
    sources: [{ field: 'rut', from: 'sitio web' }, { field: 'yearsOperating', from: 'Perfil' }] });
  const suggestion = await runTenderProfileSuggestion(client, { id: 'j', organization_id: 'org', requested_by: 'a1', opportunity_id: null, kind: 'profile', payload: {}, lease_token: 'l', state: 'running' });
  const call = (globalThis as any).__call;
  assert.deepEqual([call.role, call.category], ['extract', 'research']);
  assert.equal((globalThis as any).__downloaded, 'https://aseosur.cl');
  assert.match(call.prompt, /Sitio web: Aseo hospitalario e industrial .* Aseo Sur SpA · RUT 76\.086\.428-5 · Certificación ISO 9001$/m);
  assert.doesNotMatch(call.prompt, /evil|x\{\}/, 'no scripts or styles from the page');
  assert.match(call.prompt, /15 años en Chiloé/);
  assert.match(call.prompt, /Hospital de Castro/);
  assert.doesNotMatch(call.prompt, /Perfil de un integrante/, 'only what admins wrote about the company');
  assert.ok(!('legalName' in suggestion.values), 'the saved name stays');
  assert.deepEqual([suggestion.values.rut, suggestion.values.yearsOperating, suggestion.values.certifications], ['76.086.428-5', 15, ['ISO 9001']]);
  assert.equal(suggestion.website, true);
  (globalThis as any).__page = () => { throw new Error('OPPORTUNITY_SOURCE_UNAVAILABLE'); };
  const offline = await runTenderProfileSuggestion(client, { id: 'j2', organization_id: 'org', requested_by: 'a1', opportunity_id: null, kind: 'profile', payload: {}, lease_token: 'l', state: 'running' });
  assert.equal(offline.website, false, 'a website that cannot be read is skipped');
  assert.match((globalThis as any).__call.prompt, /Sitio web: no disponible/);
});

test('the daily screening reads the profile: an unknown is a question, not a discard', async () => {
  const { evaluateOpportunityBatch } = await load(`export { evaluateOpportunityBatch } from './src/lib/server/commercial-opportunities/workspace-sources';`, {
    './mercado-publico': 'export async function listOpenLicitaciones(){ return [] }',
    './tickets': 'export async function resolveTicketForOrganization(){ return null }',
    './compra-agil': 'export class CompraAgilError extends Error {} export async function searchCompraAgil(){ return [] } export function compraAgilQuery(){ return "" }',
  });
  const rows = [{ id: 'o1', organization_id: 'org', kind: 'tender', title: 'Aseo Hospital de Puerto Montt', company_name: 'Servicio de Salud', deadline_at: null, data: { profileRevision: 3, contentHash: 'h', source: 'tenders', description: 'Exige ISO 9001' } }];
  const context = { offer: 'Aseo hospitalario', services: ['Aseo'], exclusions: [], priority: 'balanced', revision: 3 };
  (globalThis as any).__reply = () => ({ evaluations: [] });
  const job = { id: 'j', organization_id: 'org', requested_by: 'a1', payload: { ids: ['o1'] }, kind: 'evaluate', lease_token: 'l', state: 'running', opportunity_id: null };
  await evaluateOpportunityBatch(memory({ commercial_opportunities: rows }).client, job, context);
  assert.match((globalThis as any).__call.prompt, /Sin ficha de la empresa, requisito y escala solo descartan cuando la oferta o sus exclusiones lo dicen; si no, review/);
  await evaluateOpportunityBatch(memory({ commercial_opportunities: rows,
    opportunity_tender_profile: [{ organization_id: 'org', answers: { certifications: ['ISO 9001'], regions: ['Los Lagos'] }, revision: 1 }] }).client, job, context);
  const prompt = (globalThis as any).__call.prompt;
  assert.match(prompt, /«no sé» significa que no lo sabemos, nunca que no lo tenga/);
  assert.match(prompt, /"certificacionesVigentes":"ISO 9001"/);
  assert.match(prompt, /"regionesDondeOpera":"Los Lagos"/);
  assert.match(prompt, /"garantiaMaximaQuePuedeEntregar":"no sé"/);
});

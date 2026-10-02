// The 1 Oct test (Pruebas_de_app.docx), repeated end to end (Plan 6, PR-Z): two HR people found to offer AXIS are prepared with one
// approval (saved, email looked up, researched), the conversation hears when their research finishes, reads their full reports, gets
// a first email for each one and builds the campaign. The real Cowork modules run over in-memory tables shared by every step; only
// the edges are stand-ins: the email provider, the research queue, the model and the access checks. Nothing real is reached: no
// provider, secret, env file or database, and nothing is sent.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const USER = '00000000-0000-4000-8000-0000000000e1';
const ORG = '00000000-0000-4000-8000-0000000000f1';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SEARCH_RUN = id(1);
const PREPARE_RUN = id(2);
const DRAFT_RUN = id(4);
const CAMPAIGN_RUN = id(5);
const REASK_RUN = id(6);
const AXIS = 'AXIS: consultas judiciales automáticas en el Poder Judicial (PJUD) para revisar antecedentes laborales';
const NOW = Date.now();
const iso = ms => new Date(ms).toISOString();

// What the provider knows about each person: the search hides the surname; the email lookup returns the whole identity.
const PEOPLE = {
  valentina: {
    search: { id: 'apollo:valentina', name: 'Valentina Fu***s', company: 'Tiendas Andinas', title: 'Jefa de Reclutamiento y Selección', company_website: 'https://tiendasandinas.cl' },
    lookup: { first_name: 'Valentina', last_name: 'Fuentes', email: 'vfuentes@tiendasandinas.cl', email_status: 'verified',
      linkedin_url: 'https://www.linkedin.com/in/valentina-fuentes-rrhh', source_provider_id: 'valentina' },
    signal: 'Tiendas Andinas busca 150 vendedores para la temporada de Navidad.',
  },
  patricio: {
    search: { id: 'apollo:patricio', name: 'Patricio So***o', company: 'Constructora Pehuén', title: 'Gerente de Personas', company_website: 'https://pehuen.cl' },
    lookup: { first_name: 'Patricio', last_name: 'Soto', email: 'psoto@pehuen.cl', email_status: 'verified',
      linkedin_url: 'https://www.linkedin.com/in/patricio-soto-personas', source_provider_id: 'patricio' },
    signal: 'Constructora Pehuén contratará 300 trabajadores para dos obras nuevas en el Biobío.',
  },
};

// ---- In-memory tables, read and written through the same calls the app makes to Supabase ----------------------------------
const tables = {
  cowork_runs: [
    { id: SEARCH_RUN, user_id: USER, organization_id: ORG, status: 'completed', mode: 'approval', parent_run_id: null, root_run_id: SEARCH_RUN,
      message: 'Busca personas de RR. HH. en retail y construcción para ofrecerles AXIS', created_at: iso(NOW - 30 * 60_000) },
    { id: PREPARE_RUN, user_id: USER, organization_id: ORG, status: 'running', mode: 'approval', parent_run_id: SEARCH_RUN, root_run_id: SEARCH_RUN,
      message: 'Guarda a las dos, busca su correo e investígalas', created_at: iso(NOW - 20 * 60_000) },
  ],
  cowork_run_events: [
    { run_id: SEARCH_RUN, user_id: USER, organization_id: ORG, kind: 'tool.completed',
      payload: { action: 'prospecting.search', input: '', result: { scope: 'external_search', items: [PEOPLE.valentina.search, PEOPLE.patricio.search] } } },
  ],
  // «Perfil» still describes another product: the one asked for in the conversation must win (on 1 Oct the emails sold this one).
  profiles: [{
    id: USER, full_name: 'Nicolás Yarur', job_title: 'Gerente Comercial', company_name: 'Yago SpA', company_domain: 'yago.cl',
    signatures: { profile_extended: {
      role: 'Gerente Comercial', sector: 'Software B2B para recursos humanos',
      description: 'Yago automatiza una verificación repetitiva sobre las personas que una empresa contrata.',
      services: ['Automatización con IA de tareas administrativas'],
      valueProposition: 'Automatizamos tareas administrativas repetitivas con IA.',
    } },
  }],
};
const calls = { lookups: [], research: [], admitted: [], prompts: [] };

const pick = (row, path) => {
  const [column, key] = path.split('->>');
  return key ? row[column]?.[key] : row[column];
};
const likeRegex = (pattern, flags) => new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*')}$`, flags);
const clone = value => JSON.parse(JSON.stringify(value));

/** A column list as PostgREST reads it: plain columns, `*`, and aliases of a JSON key («saved_lead_id:data->>sourceSavedLeadId»). */
function project(row, fields) {
  if (!fields || fields.trim() === '*') return clone(row);
  const out = {};
  for (const field of fields.split(',').map(part => part.trim()).filter(Boolean)) {
    const [alias, source] = field.includes(':') ? field.split(':') : [field.split('->>').pop(), field];
    out[alias] = clone(pick(row, source) ?? null);
  }
  return out;
}

function from(name) {
  const rows = () => (tables[name] ||= []);
  const q = { filters: [], order: [], limit: Infinity, offset: 0, action: 'select', fields: '*', payload: null, options: {}, returning: null };
  const where = row => q.filters.every(test => test(row));
  const sorted = list => {
    const copy = [...list];
    for (const [column, ascending] of [...q.order].reverse()) {
      copy.sort((a, b) => (String(pick(a, column) ?? '') < String(pick(b, column) ?? '') ? -1 : String(pick(a, column) ?? '') > String(pick(b, column) ?? '') ? 1 : 0) * (ascending ? 1 : -1));
    }
    return copy;
  };
  const run = () => {
    if (q.action === 'insert' || q.action === 'upsert') {
      const values = (Array.isArray(q.payload) ? q.payload : [q.payload]).map(clone);
      const keys = String(q.options.onConflict || 'id').split(',').map(key => key.trim());
      const written = [];
      for (const value of values) {
        const existing = q.action === 'upsert' ? rows().find(row => keys.every(key => row[key] === value[key])) : null;
        if (existing) {
          if (q.options.ignoreDuplicates) continue;
          Object.assign(existing, value);
          written.push(existing);
        } else {
          const row = { created_at: new Date().toISOString(), ...value };
          rows().push(row);
          written.push(row);
        }
      }
      return written;
    }
    const matched = sorted(rows().filter(where));
    if (q.action === 'update') { for (const row of matched) Object.assign(row, clone(q.payload)); return matched; }
    if (q.action === 'delete') { tables[name] = rows().filter(row => !matched.includes(row)); return matched; }
    return matched.slice(q.offset, q.offset + q.limit);
  };
  const result = () => {
    const list = run();
    const fields = q.action === 'select' ? q.fields : q.returning;
    return { data: fields === null ? null : list.map(row => project(row, fields)), error: null, count: list.length };
  };
  const builder = {
    select(fields = '*') { if (q.action === 'select') q.fields = fields; else q.returning = fields; return builder; },
    eq(column, value) { q.filters.push(row => pick(row, column) === value); return builder; },
    neq(column, value) { q.filters.push(row => pick(row, column) !== value); return builder; },
    in(column, list) { q.filters.push(row => list.includes(pick(row, column))); return builder; },
    is(column, value) { q.filters.push(row => (pick(row, column) ?? null) === value); return builder; },
    gte(column, value) { q.filters.push(row => String(pick(row, column)) >= String(value)); return builder; },
    lte(column, value) { q.filters.push(row => String(pick(row, column)) <= String(value)); return builder; },
    gt(column, value) { q.filters.push(row => String(pick(row, column)) > String(value)); return builder; },
    lt(column, value) { q.filters.push(row => String(pick(row, column)) < String(value)); return builder; },
    like(column, pattern) { q.filters.push(row => likeRegex(pattern).test(String(pick(row, column) ?? ''))); return builder; },
    ilike(column, pattern) { q.filters.push(row => likeRegex(pattern, 'i').test(String(pick(row, column) ?? ''))); return builder; },
    not(column, op, value) {
      q.filters.push(row => !(op === 'is' ? (pick(row, column) ?? null) === value : op === 'eq' ? pick(row, column) === value : false));
      return builder;
    },
    filter(column, op, value) {
      const list = String(value).replace(/^\(|\)$/g, '').split(',');
      q.filters.push(row => (op === 'in' ? list.includes(String(pick(row, column))) : String(pick(row, column)) === String(value)));
      return builder;
    },
    or(expression) {
      const terms = expression.split(',').map(term => term.split('.'));
      q.filters.push(row => terms.some(([column, op, ...rest]) => {
        const pattern = rest.join('.');
        return op === 'ilike' ? likeRegex(pattern, 'i').test(String(row[column] ?? '')) : op === 'eq' ? String(row[column]) === pattern : false;
      }));
      return builder;
    },
    order(column, options = {}) { q.order.push([column, options.ascending !== false]); return builder; },
    limit(n) { q.limit = n; return builder; },
    range(start, end) { q.offset = start; q.limit = end - start + 1; return builder; },
    insert(payload) { q.action = 'insert'; q.payload = payload; return builder; },
    upsert(payload, options = {}) { q.action = 'upsert'; q.payload = payload; q.options = options; return builder; },
    update(payload) { q.action = 'update'; q.payload = payload; return builder; },
    delete() { q.action = 'delete'; return builder; },
    async maybeSingle() { const { data } = result(); return { data: data?.[0] ?? null, error: null }; },
    async single() { const { data } = result(); return data?.[0] ? { data: data[0], error: null } : { data: null, error: { message: 'No rows' } }; },
    then(resolve, reject) { return Promise.resolve().then(result).then(resolve, reject); },
  };
  return builder;
}

const rpc = async (name, args) => {
  if (name === 'cowork_admit_followup') {
    calls.admitted.push(args);
    const runId = id(100 + calls.admitted.length);
    tables.cowork_runs.push({ id: runId, user_id: args.p_user_id, organization_id: args.p_organization_id, status: 'queued', mode: args.p_mode,
      parent_run_id: args.p_parent_run_id, root_run_id: SEARCH_RUN, message: args.p_message, request_id: args.p_request_id, automatic: true,
      created_at: new Date().toISOString() });
    return { data: runId, error: null };
  }
  return { data: null, error: { message: `rpc ${name} is not part of this test` } };
};
const db = { from, rpc };
globalThis.__pruebasDeApp = { db, tables, calls, PEOPLE };

// ---- The edges: the email provider, the research queue, the model and the access checks -------------------------------------
const sources = {
  '@/lib/server/supabase-admin': 'export const getSupabaseAdminClient = () => globalThis.__pruebasDeApp.db;',
  'cowork:access': 'export const requireCoworkWorkerAccess = async () => {};',
  'cowork:runs': `export const getCoworkRun = async (auth, runId) => {
    const w = globalThis.__pruebasDeApp; const run = w.tables.cowork_runs.find(row => row.id === runId);
    return run ? { run, events: w.tables.cowork_run_events.filter(event => event.run_id === runId) } : null; };`,
  '@/lib/server/apollo-credit-balance': 'export const loadLatestApolloCreditBalance = async () => ({ remaining: 120, capturedAt: new Date().toISOString() }); export const isApolloCreditBalanceStale = () => false;',
  '@/lib/server/daily-quota-store': `export const getEnrichmentQuotaOperation = async () => null;
    export const getEffectiveDailyQuotaLimits = async () => ({ enrich: 50, search: 50, research: 50 });
    export const claimEnrichmentQuotaOperation = async () => ({ claimed: true, allowed: true, claimToken: 'claim' });
    export const releaseEnrichmentQuotaOperation = async () => {};`,
  '@/lib/server/enrichment-search-access': 'export const hasUserEnrichmentSearchCreditAccess = async () => true;',
  '@/lib/server/apollo-enrichment-callbacks': `export const createApolloEnrichmentCallback = async input => ({ callbackId: 'callback-' + input.targetId, tokenHash: 'hash' });
    export const markApolloEnrichmentCallbackSubmitted = async () => {}; export const bindApolloEnrichmentCallback = async () => 'bound';
    export const applyApolloEnrichmentCandidate = async () => 'processed'; export const settleApolloEnrichmentCallback = async () => {};`,
  // The provider's person lookup: by the person id the search returned, with the whole name, the email and the LinkedIn.
  '@/lib/server/apollo-enrichment': `export const submitApolloEnrichment = async ({ lead }) => {
    const w = globalThis.__pruebasDeApp; w.calls.lookups.push(lead);
    const person = Object.values(w.PEOPLE).find(item => item.lookup.source_provider_id === lead.sourceProviderId);
    return person ? { success: true, providerRequestId: null, creditsConsumed: 1, extractedData: { ...person.lookup, title: person.search.title } }
      : { success: false, providerRequestId: null, creditsConsumed: 0, extractedData: {} }; };`,
  // The research queue: the job a real enqueue creates, with the person as it was sent to be researched.
  '@/lib/server/native-research': `export const findNativeResearchJob = async () => null;
    export const enqueueNativeResearch = async input => {
      const w = globalThis.__pruebasDeApp; w.calls.research.push(input);
      const jobId = '00000000-0000-4000-8000-' + String(200 + w.calls.research.length).padStart(12, '0');
      w.tables.lead_research_jobs = w.tables.lead_research_jobs || [];
      w.tables.lead_research_jobs.push({ id: jobId, user_id: input.access.userId, organization_id: input.access.organizationId, lead_id: input.lead.id,
        status: 'queued', error_code: null, research_snapshot_id: null, request_idempotency_key: input.requestIdempotencyKey,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
      return { reportId: 'report-' + jobId, status: 'queued', reused: false }; };`,
  '@/lib/server/team-locks': 'export const readTeamLocks = async () => ({ enabled: false, byEmail: {} });',
  '@/lib/server/mail-sender-preference': "export const readMailSenderPreference = async () => ({ connected: ['google'], preferred: 'google' });",
  // The writer's model: it reads the prompt (kept to check what it was told) and answers with the JSON the writer asks for.
  '@/ai/openai-json': `const answer = opts => {
      globalThis.__pruebasDeApp.calls.prompts.push(String(opts.prompt));
      return { data: opts.schema.parse({ subject: 'antecedentes para tu selección', opening: 'Vi la búsqueda de personal que publicaron este mes.',
        value: 'Con AXIS tu equipo revisa antecedentes laborales con consultas judiciales automáticas, sin trámites manuales.', hechos_usados: [], datos_faltantes: [] }),
        telemetry: { modelName: 'modelo-de-prueba', usage: { prompt_tokens: 100, completion_tokens: 20 } } };
    };
    export const generateStructuredWithTelemetry = async opts => answer(opts);
    export const generateStructured = async opts => answer(opts).data;`,
  '@/ai/genkit': 'export const ai = { defineFlow: (_config, run) => run, definePrompt: () => async () => ({ output: null }) };',
};
const COWORK_DIR = /[\\/]src[\\/]lib[\\/]server[\\/]cowork[\\/]/;
const bundle = await build({
  stdin: {
    contents: `
      export * from './src/lib/server/cowork/prepare-batch';
      export * from './src/lib/server/cowork/prepare-batch-run';
      export { queryCoworkLeads } from './src/lib/server/cowork/lead-tools';
      export { processCoworkResearchNotices } from './src/lib/server/cowork/research-notice';
      export { readCoworkResearch } from './src/lib/server/cowork/research-read';
      export { saveCoworkThreadMemory, loadCoworkOfferInPlay } from './src/lib/server/cowork/thread-memory';
      export { stageCoworkCampaignDefinition } from './src/lib/server/cowork/campaign-ops';
      export { loadSellerProfile, sellerWithOfferInPlay } from './src/lib/server/seller-profile';
      export { buildDraftContextV2, createDefaultDraftWritingStyleV2 } from './src/lib/server/draft-context-v2';
      export { generateOutreachFromDraftContextV2 } from './src/ai/flows/generate-outreach-from-report';
      export { loadAudience } from './src/lib/server/bulk-campaign-audience';
      export { renderCampaignMessage, defaultAudience } from './src/lib/bulk-campaigns';
      export { draftSnapshotFixture } from './src/lib/server/draft-v2-test-fixtures';
      export { ResearchSnapshotV1Schema } from './src/lib/research-contracts';
      export { REPORT_V2_ANGLE_TITLE } from './src/lib/report-v2-contracts';
      export { canonicalSha256 } from './src/lib/messaging-contracts';`,
    resolveDir: process.cwd(), loader: 'ts',
  },
  bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent',
  plugins: [{ name: 'edges', setup(b) {
    b.onResolve({ filter: /.*/ }, args => {
      if ((args.path === './access' || args.path === './runs') && COWORK_DIR.test(args.importer)) return { path: `cowork:${args.path.slice(2)}`, namespace: 'edge' };
      // The quota store is only a stand-in for the email lookup; the campaign code keeps its own (it never runs here).
      if (args.path === '@/lib/server/daily-quota-store' && !/enrich-contact\.ts$/.test(args.importer)) return undefined;
      return sources[args.path] ? { path: args.path, namespace: 'edge' } : undefined;
    });
    b.onLoad({ filter: /.*/, namespace: 'edge' }, args => ({ contents: sources[args.path], loader: 'js' }));
  } }],
});
const loaded = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports);
const app = loaded.exports;

const scope = { userId: USER, organizationId: ORG };
const auth = { user: { id: USER }, organizationId: ORG, organizationIds: [ORG], supabase: db };
const approvals = [];
const shown = [];
const leadOf = key => tables.leads.find(row => row.source_provider_id === key);
const env = { prepare: process.env.COWORK_PREPARE_BATCH_ENABLED, bulk: process.env.BULK_CAMPAIGNS_ENABLED };
process.env.BULK_CAMPAIGNS_ENABLED = 'true';
delete process.env.COWORK_PREPARE_BATCH_ENABLED;

try {
  // Turn 1 told the conversation what is being sold; the memory keeps it for every later turn (the 1 Oct emails sold another thing).
  assert.equal(await app.saveCoworkThreadMemory(db, scope, tables.cowork_runs[0], {
    offer: AXIS, audience: 'RR. HH. en retail y construcción', people: [], decisions: [], pending: ['Preparar a las dos personas'] }), true);

  // 1. «Guarda a las dos, busca su correo e investígalas»: one card for both, with the three steps (points 3, 6 and 7).
  const staged = await app.stageCoworkPrepareBatch(scope, PREPARE_RUN,
    { goal: 'research', people: [{ providerId: 'apollo:valentina' }, { providerId: 'apollo:patricio' }] });
  approvals.push(staged.label);
  assert.equal(staged.label, 'Preparar a 2 personas: guardar, buscar su correo e investigar');
  assert.deepEqual(staged.cost, { saves: 2, lookups: 2, research: 2 });
  const target = `preparebatch:${staged.hash}`;
  tables.cowork_effect_proposals = [{ run_id: PREPARE_RUN, user_id: USER, organization_id: ORG, status: 'executing', kind: 'lead_prepare_batch', target_id: target }];
  tables.cowork_runs.find(run => run.id === PREPARE_RUN).status = 'waiting_approval';
  const prepared = await app.executeCoworkPrepareBatch(auth, PREPARE_RUN, target);
  shown.push(prepared.reply);

  // Real names, email and LinkedIn in the result (points 8 and 9); one lookup per person, nothing paid twice.
  assert.deepEqual(prepared.result.items.map(item => [item.name, item.email, item.linkedinUrl, item.research, item.status]), [
    ['Valentina Fuentes', 'vfuentes@tiendasandinas.cl', 'https://www.linkedin.com/in/valentina-fuentes-rrhh', 'queued', 'ready'],
    ['Patricio Soto', 'psoto@pehuen.cl', 'https://www.linkedin.com/in/patricio-soto-personas', 'queued', 'ready'],
  ]);
  assert.match(prepared.reply, /^Listo con 2 de 2 personas/);
  assert.equal(calls.lookups.length, 2, 'one email lookup per person');
  // The saved contacts keep the real name and the LinkedIn, so every screen and step after this one sees them.
  for (const [key, name] of [['valentina', 'Valentina Fuentes'], ['patricio', 'Patricio Soto']]) {
    const lead = leadOf(key);
    assert.equal(lead.name, name);
    assert.equal(lead.email, PEOPLE[key].lookup.email);
    assert.equal(lead.linkedin_url, PEOPLE[key].lookup.linkedin_url);
  }
  // The research looks the person up by the real name, not «Fu***s» (point 12: on 1 Oct the person was never found).
  assert.deepEqual(calls.research.map(input => [input.lead.fullName, input.lead.companyName, input.lead.email]), [
    ['Valentina Fuentes', 'Tiendas Andinas', 'vfuentes@tiendasandinas.cl'],
    ['Patricio Soto', 'Constructora Pehuén', 'psoto@pehuen.cl'],
  ]);
  tables.cowork_runs.find(run => run.id === PREPARE_RUN).status = 'completed';
  tables.cowork_run_events.push({ run_id: PREPARE_RUN, user_id: USER, organization_id: ORG, kind: 'effect.completed',
    payload: { kind: 'lead_prepare_batch', result: prepared.result } });

  // Asked again in the next turn, nothing is proposed or charged: everything is done (point 7).
  tables.cowork_runs.push({ id: REASK_RUN, user_id: USER, organization_id: ORG, status: 'running', mode: 'approval', parent_run_id: PREPARE_RUN,
    root_run_id: SEARCH_RUN, message: 'Investiga a Valentina', created_at: new Date().toISOString() });
  await assert.rejects(app.stageCoworkPrepareBatch(scope, REASK_RUN, { goal: 'research', people: [{ leadId: leadOf('valentina').id }] }),
    /No queda nada por hacer con esa persona \(Valentina Fuentes\)/);
  assert.match(await app.coworkEffectAlreadyDone(scope, 'enrich_contact', leadOf('patricio').id), /Patricio Soto ya tiene correo/);
  assert.equal(calls.lookups.length + calls.research.length, 4, 'asking again charged nothing');
  tables.cowork_runs.find(run => run.id === REASK_RUN).status = 'completed';

  // 2. Cowork sees each LinkedIn when it reads the contacts (point 22).
  const contacts = await app.queryCoworkLeads(db, scope, 'leads.search', '');
  assert.deepEqual(contacts.items.map(item => [item.name, item.linkedin_url]).sort(), [
    ['Patricio Soto', 'https://www.linkedin.com/in/patricio-soto-personas'],
    ['Valentina Fuentes', 'https://www.linkedin.com/in/valentina-fuentes-rrhh'],
  ]);

  // 3. The research finishes: the conversation hears it by itself, once, with the real names (points 10, 11 and 13).
  const NOTICE_RUN = id(3);
  for (const [index, key] of ['valentina', 'patricio'].entries()) {
    const lead = leadOf(key);
    const job = tables.lead_research_jobs.find(row => row.lead_id === lead.id);
    const snapshotId = id(300 + index);
    const base = app.draftSnapshotFixture();
    const at = iso(NOW - 60_000);
    const fact = { id: 'evidence-signal', subjectScope: 'company', kind: 'fact', path: 'fixture.signal', statement: PEOPLE[key].signal,
      sourceId: 'source-company', extractedAt: at, confidence: 0.85, extraction: { method: 'rule', provider: 'fixture', version: 'fixture/v1' } };
    tables.research_snapshots = [...(tables.research_snapshots || []), { id: snapshotId, user_id: USER, organization_id: ORG,
      payload: app.ResearchSnapshotV1Schema.parse({
        ...base, id: snapshotId, scope: { kind: 'organization', organizationId: ORG, ownerUserId: USER },
        subject: { leadRef: lead.id, leadId: lead.id, email: lead.email,
          person: { fullName: lead.name, title: lead.title, linkedinUrl: lead.linkedin_url },
          company: { name: lead.company, domain: new URL(PEOPLE[key].search.company_website).hostname, websiteUrl: PEOPLE[key].search.company_website } },
        sources: [{ id: 'source-company', type: 'news', url: `${PEOPLE[key].search.company_website}/noticias`, canonicalUrl: `${PEOPLE[key].search.company_website}/noticias`,
          title: lead.company, provider: 'fixture', retrievedAt: at, reliability: 0.85 }],
        evidence: [fact],
        claims: [{ id: 'claim-signal', kind: 'company_overview', subjectScope: 'company', classification: 'fact', statement: PEOPLE[key].signal,
          supportingEvidenceIds: ['evidence-signal'], contradictingEvidenceIds: [], confidence: 0.85,
          freshness: { asOf: at, validUntil: iso(NOW + 30 * 86_400_000), policyVersion: 'research-freshness/v1' },
          derivation: { method: 'rule', promptVersion: 'fixture/v1' } }],
        // Patricio's research ends with gaps, like most on 1 Oct: the report still arrives, with what was missing.
        lifecycle: { status: key === 'valentina' ? 'completed' : 'partial', queuedAt: at, startedAt: at, completedAt: at,
          errors: key === 'valentina' ? [] : [{ code: 'insufficient_evidence', stage: 'validate', severity: 'warning', retryable: false,
            message: 'No se encontró información pública sobre la persona.', observedAt: at }] },
        createdAt: at, updatedAt: at,
      }) }];
    tables.research_report_documents = [...(tables.research_report_documents || []), {
      research_snapshot_id: snapshotId, user_id: USER, organization_id: ORG, schema_version: 'research-report-document/v2', delivery_state: 'visible',
      revision: 1, generated_at: iso(NOW - 30_000),
      document: { sections: [
        { key: 'verdict', title: 'Resumen y decisión', paragraphs: [{ text: `Vale la pena escribirle a ${lead.name}: ${PEOPLE[key].signal}` }] },
        { key: 'contact', title: 'La persona', paragraphs: [{ text: `${lead.name} es ${lead.title} en ${lead.company}.` }] },
        { key: 'company', title: 'La empresa', paragraphs: [{ text: PEOPLE[key].signal }] },
        { key: 'angle', title: app.REPORT_V2_ANGLE_TITLE, paragraphs: [
          { text: 'Ángulo 1: la contratación masiva multiplica las revisiones de antecedentes; AXIS las hace sin trámites manuales.' },
          { text: 'Idea de primer correo, asunto «antecedentes para la temporada»: la búsqueda de personal y una pregunta de bajo esfuerzo.' },
          { text: 'Dos ideas de seguimiento: el uso diario en reclutamiento y el tiempo que ahorra cada revisión.' },
          { text: 'Qué no afirmar: cuántas revisiones hacen hoy ni qué herramienta usan.' },
        ] },
      ] },
    }];
    Object.assign(job, { status: key === 'valentina' ? 'completed' : 'partial', research_snapshot_id: snapshotId, updated_at: new Date().toISOString() });
  }
  const told = await app.processCoworkResearchNotices({ client: db, force: true, now: new Date(Date.now() + 60_000) });
  assert.equal(told.notified, 1, 'one notice for the conversation');
  const notice = calls.admitted[0];
  shown.push(notice.p_message);
  assert.match(notice.p_message, /Terminaron las investigaciones/);
  assert.match(notice.p_message, /Valentina Fuentes \(Tiendas Andinas\)/);
  assert.match(notice.p_message, /Patricio Soto \(Constructora Pehuén\)/);
  assert.doesNotMatch(notice.p_message, /\*\*\*|Contacto sin nombre|pocas líneas/);
  assert.match(notice.p_message, /entrégalos completos/);
  // The notice starts a new chain like a message: it does not spend the automatic steps of the turn before (point 15).
  assert.equal(notice.p_reset_depth, true);
  assert.equal(notice.p_parent_run_id, REASK_RUN, 'after the newest finished turn of the conversation');
  assert.equal((await app.processCoworkResearchNotices({ client: db, force: true, now: new Date(Date.now() + 120_000) })).notified, 0, 'told once');
  tables.cowork_runs.find(run => run.id === id(101)).status = 'completed';

  // 4. Each report, complete, with its guide to write the email and the follow-ups (points 12 and 13).
  for (const key of ['valentina', 'patricio']) {
    const read = await app.readCoworkResearch(db, scope, leadOf(key).id);
    assert.equal(read.reportStatus, 'ready');
    assert.equal(read.report.truncated, false);
    const angle = read.report.sections.find(section => section.key === 'angle');
    assert.equal(angle.title, 'Cómo usarlo en el correo y los seguimientos');
    assert.match(angle.text, /Idea de primer correo[\s\S]*Dos ideas de seguimiento[\s\S]*Qué no afirmar/);
  }

  // 5. «Escríbeles el primer correo»: from each research, about AXIS, greeting with the first name (points 14 and 19).
  tables.cowork_runs.push({ id: DRAFT_RUN, user_id: USER, organization_id: ORG, status: 'running', mode: 'approval', parent_run_id: id(101),
    root_run_id: SEARCH_RUN, message: 'Escríbeles el primer correo', created_at: new Date().toISOString() });
  const offer = await app.loadCoworkOfferInPlay(db, scope, DRAFT_RUN);
  assert.equal(offer, AXIS);
  const seller = app.sellerWithOfferInPlay(await app.loadSellerProfile(USER, ORG, db), offer);
  const firstEmails = [];
  for (const key of ['valentina', 'patricio']) {
    const lead = leadOf(key);
    const snapshot = tables.research_snapshots.find(row => row.payload.subject.leadId === lead.id).payload;
    const built = app.buildDraftContextV2({ snapshot, artifact: { contentHash: app.canonicalSha256(snapshot), capturedAt: snapshot.updatedAt },
      seller, style: app.createDefaultDraftWritingStyleV2(), now: new Date() });
    assert.equal(built.status, 'ready', `${lead.name}: ${built.reason || ''}`);
    const before = calls.prompts.length;
    const draft = await app.generateOutreachFromDraftContextV2({ context: built.context });
    const told = calls.prompts.slice(before).join('\n');
    assert.match(told, /AXIS/, 'the writer is told the offer in play');
    assert.doesNotMatch(told, /Automatización con IA de tareas administrativas/, 'not the offer of «Perfil»');
    assert.match(told, /Yago SpA/);
    assert.ok(told.includes(PEOPLE[key].signal.replace(/\.$/, '')), 'the writer is told what the research found');
    assert.doesNotMatch(told, /\*\*\*/);
    assert.equal(draft.body.split('\n')[0], `Hola ${PEOPLE[key].lookup.first_name},`);
    firstEmails.push({ email: lead.email, subject: draft.subject, body: draft.body });
    shown.push(draft.body);
  }

  // 6. «Arma la campaña con las dos»: one card, each person with their own first email, the follow-ups greet by first name
  //    (points 19, 20, 21 and 28). Activating it is the only other approval.
  tables.cowork_runs.push({ id: CAMPAIGN_RUN, user_id: USER, organization_id: ORG, status: 'running', mode: 'approval', parent_run_id: DRAFT_RUN,
    root_run_id: SEARCH_RUN, message: 'Arma la campaña con las dos', created_at: new Date().toISOString() });
  const followUp = { subject: 'Re: antecedentes', body: 'Hola {{nombre}},\n\nRetomo lo de AXIS: un cliente en piloto lo usa a diario en reclutamiento. ¿Lo vemos en 15 minutos?', delayDays: 3 };
  const campaign = await app.stageCoworkCampaignDefinition(scope, CAMPAIGN_RUN, {
    name: 'AXIS · RR. HH. retail y construcción', objective: 'Conversar sobre AXIS', criteria: app.defaultAudience,
    emails: firstEmails.map(item => item.email), messages: [firstEmails[0] && { subject: 'antecedentes', body: 'Hola {{nombre}},\n\nTe escribo por AXIS.', delayDays: 0 }, followUp],
    provider: 'google', firstEmails,
  });
  approvals.push(`Crear la campaña «AXIS · RR. HH. retail y construcción» sin enviar, para ${campaign.recipients} personas`);
  assert.deepEqual(campaign, { recipients: 2, provider: 'google' });
  const definition = tables.cowork_campaign_definitions.find(row => row.run_id === CAMPAIGN_RUN).definition;
  assert.deepEqual(definition.overrides.map(item => [item.email, item.messageIndex, item.body.split('\n')[0]]), [
    ['vfuentes@tiendasandinas.cl', 0, 'Hola Valentina,'],
    ['psoto@pehuen.cl', 0, 'Hola Patricio,'],
  ]);
  const audience = await app.loadAudience(auth);
  for (const key of ['valentina', 'patricio']) {
    const person = audience.find(item => item.email === PEOPLE[key].lookup.email);
    assert.equal(app.renderCampaignMessage(followUp, person).body.split('\n')[0], `Hola ${PEOPLE[key].lookup.first_name},`);
  }
  approvals.push('Activar la campaña');

  // The whole test: three approvals (prepare, create the campaign, activate it), never a limit message (points 6 and 15).
  assert.ok(approvals.length <= 3, `approvals: ${approvals.join(' | ')}`);
  for (const text of shown) assert.doesNotMatch(text, /límite|trabajo nuevo/i);
  console.log('PASS: the 1 Oct test, repeated: two people prepared with one approval, real names, email and LinkedIn, research by the real name, one notice with their names, their full reports with the writing guide, a first email each about AXIS greeting by first name, and the campaign with their emails; three approvals and no limit message.');
} finally {
  delete globalThis.__pruebasDeApp;
  if (env.prepare === undefined) delete process.env.COWORK_PREPARE_BATCH_ENABLED; else process.env.COWORK_PREPARE_BATCH_ENABLED = env.prepare;
  if (env.bulk === undefined) delete process.env.BULK_CAMPAIGNS_ENABLED; else process.env.BULK_CAMPAIGNS_ENABLED = env.bulk;
}

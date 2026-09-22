// Fase 2B: enrich effect through shared primitives. No providers, secrets or env files.
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const LEAD = '00000000-0000-4000-8000-000000000001';
const savedLead = { id: LEAD, name: 'Ana Ejemplo', title: 'Gerenta', company: 'Logística Sur', company_website: 'https://logisticasur.cl', linkedin_url: 'https://www.linkedin.com/in/ana', email: null, source_provider: 'apollo', source_provider_id: 'apollo-1' };
const state = {
  quotaOp: null, claim: { claimed: true, allowed: true, claimToken: '00000000-0000-4000-8000-000000000002' },
  submit: async () => ({ success: true, enrichmentStatus: 'completed', providerRequestId: 'pr-1', creditsConsumed: 1,
    extractedData: { email: 'ana@logisticasur.cl', email_status: 'verified', source_provider_id: 'apollo-1' } }),
  calls: [], updates: [], completes: [], releases: [],
};
globalThis.__coworkEnrich = state;

const client = {
  from: table => {
    const chain = { select: () => chain, eq: () => chain,
      insert: values => { state.calls.push(['insert', table, values]); return chain; },
      update: values => { state.updates.push([table, values]); return chain; },
      maybeSingle: async () => {
        if (table === 'leads') return { data: savedLead, error: null };
        if (table === 'enriched_leads') return { data: { id: 'enriched-1', email: 'ana@logisticasur.cl', email_status: 'verified', enrichment_status: 'completed' }, error: null };
        if (table === 'apollo_enrichment_callbacks') return { data: { target_lead_id: 'enriched-1' }, error: null };
        return { data: null, error: null };
      } };
    return chain;
  },
};
const sources = {
  '@/lib/server/supabase-admin': 'export const getSupabaseAdminClient=()=>globalThis.__coworkEnrich.client;',
  './runs': `export const getCoworkRun=async()=>({run:{status:'completed'},events:[{kind:'tool.completed',payload:{action:'leads.search',result:{scope:'own_saved_contacts',items:[{id:'${LEAD}',name:'Ana Ejemplo'}]}}}]});`,
  './access': 'export const requireCoworkWorkerAccess=async()=>{};',
  '@/lib/server/daily-quota-store': `export const getEffectiveDailyQuotaLimits=async()=>({enrich:50});
    export const getEnrichmentQuotaOperation=async()=>globalThis.__coworkEnrich.quotaOp;
    export const claimEnrichmentQuotaOperation=async()=>{globalThis.__coworkEnrich.calls.push(['claim']);return globalThis.__coworkEnrich.claim;};
    export const markEnrichmentQuotaOperationSubmitted=async()=>{};
    export const releaseEnrichmentQuotaOperation=async()=>{globalThis.__coworkEnrich.releases.push(true);};
    export const completeEnrichmentQuotaOperation=async(args)=>{globalThis.__coworkEnrich.completes.push(args);};`,
  '@/lib/server/enrichment-search-access': 'export const hasUserEnrichmentSearchCreditAccess=async()=>true;',
  '@/lib/server/apollo-enrichment-callbacks': `export const createApolloEnrichmentCallback=async()=>({callbackId:'00000000-0000-4000-8000-000000000003',token:'t',tokenHash:'${'a'.repeat(64)}',webhookUrl:'https://x.example/hook',claimToken:'c'});
    export const markApolloEnrichmentCallbackSubmitted=async()=>{};
    export const bindApolloEnrichmentCallback=async()=> 'bound';
    export const applyApolloEnrichmentCandidate=async()=>{globalThis.__coworkEnrich.calls.push(['apply']);return 'processed';};
    export const settleApolloEnrichmentCallback=async()=>{globalThis.__coworkEnrich.calls.push(['settle']);};`,
  '@/lib/server/apollo-enrichment': 'export const submitApolloEnrichment=(...args)=>globalThis.__coworkEnrich.submit(...args);',
};
globalThis.__coworkEnrich.client = client;
const bundle = await build({ entryPoints: ['src/lib/server/cowork/enrich-contact.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
  plugins: [{ name: 'isolated-services', setup(b) {
    b.onResolve({ filter: /.*/ }, args => sources[args.path] ? { path: args.path, namespace: 'fixture' } : undefined);
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: sources[args.path] }));
  } }],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const auth = { user: { id: 'owner' }, organizationId: 'org', supabase: client };
try {
  // 1. Success persists the provider email with its status, never invented.
  const ok = await module.exports.enrichCoworkContact(auth, 'run-1', LEAD);
  assert.equal(ok.email, 'ana@logisticasur.cl');
  assert.equal(ok.emailStatus, 'verified');
  assert.equal(ok.found, true);
  assert.equal(ok.reused, false);
  const persisted = state.updates.find(([table]) => table === 'enriched_leads');
  assert.equal(persisted[1].email, 'ana@logisticasur.cl');
  assert.equal(persisted[1].email_status, 'verified');
  const backfill = state.updates.find(([table]) => table === 'leads');
  assert.equal(backfill[1].email, 'ana@logisticasur.cl', 'missing saved email is backfilled for research/drafts/sends');
  assert.equal(state.completes.length, 0, 'shared callback owns quota completion');
  assert.equal(ok.verifiedForList, true);
  state.updates = [];
  state.submit = async () => ({ success: true, providerRequestId: 'unverified', extractedData: {
    email: 'candidate@example.com', email_status: 'likely to engage', source_provider_id: 'apollo-1' } });
  const uncertain = await module.exports.enrichCoworkContact(auth, 'run-unverified', LEAD);
  assert.equal(uncertain.found, true);
  assert.equal(uncertain.verifiedForList, false);
  assert.equal(state.updates.some(([table]) => table === 'leads'), false, 'unverified candidate must not backfill saved lead');

  // 2. Replay reuses the stored summary without touching the provider.
  state.quotaOp = { status: 'completed', responsePayload: { email: 'ana@logisticasur.cl', emailStatus: 'verified', found: true, creditsConsumed: 1, enrichedLeadId: 'enriched-1' } };
  let providerCalls = 0;
  state.submit = async (...args) => { providerCalls++; return { success: false, extractedData: null }; };
  const replay = await module.exports.enrichCoworkContact(auth, 'run-1', LEAD);
  assert.equal(replay.reused, true);
  assert.equal(replay.email, 'ana@logisticasur.cl');
  assert.equal(providerCalls, 0);

  state.quotaOp = { status: 'submitted' };
  await assert.rejects(module.exports.enrichCoworkContact(auth, 'run-1', LEAD), /Ya existe una solicitud/);
  assert.equal(providerCalls, 0, 'a submitted operation is not treated as a new quota request');

  // 3. Exhausted quota fails in Spanish before any provider call.
  state.quotaOp = null; state.claim = { claimed: false, allowed: false };
  await assert.rejects(module.exports.enrichCoworkContact(auth, 'run-1', LEAD), /cupo diario de enriquecimiento/);
  assert.equal(providerCalls, 0);

  // 4. Unknown provider outcome completes as failed without auto-retry.
  state.claim = { claimed: true, allowed: true, claimToken: '00000000-0000-4000-8000-000000000002' };
  state.submit = async () => { throw new Error('socket hang up'); };
  state.completes = []; state.releases = [];
  await assert.rejects(module.exports.enrichCoworkContact(auth, 'run-1', LEAD), /No pudimos confirmar/);
  assert.equal(state.completes.length, 0, 'unknown outcome stays available for reconciliation');
  assert.equal(state.releases.length, 0);

  console.log('PASS: enrich success with provider email, replay reuse, quota message, unknown outcome without retry.');
} finally {
  delete globalThis.__coworkEnrich;
}

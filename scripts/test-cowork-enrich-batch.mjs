// Fase 2: enrich batch staging/execution with per-item reconciliation. No providers, secrets or env files.
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const RUN = '00000000-0000-4000-8000-000000000020';
const LEADS = [
  '00000000-0000-4000-8000-000000000021',
  '00000000-0000-4000-8000-000000000022',
  '00000000-0000-4000-8000-000000000023',
];
const state = {
  runStatus: 'completed',
  workStatus: 'running',
  observed: [...LEADS],
  owned: [...LEADS],
  staged: null,
  existingOp: null,
  quotaOpen: true,
  claims: 0,
  provider: {},
  access: true,
};
globalThis.__coworkEnrichBatch = state;

function tableHandler(table) {
  const s = globalThis.__coworkEnrichBatch;
  const chain = { _eq: [], _in: null };
  chain.select = () => chain;
  chain.eq = (column, value) => { chain._eq.push([column, value]); return chain; };
  chain.in = (column, values) => { chain._in = [column, values]; return chain; };
  chain.order = () => chain;
  chain.limit = () => chain;
  chain.insert = values => ({ ...chain, select: () => ({ ...chain, maybeSingle: async () => ({ data: { id: 'x' }, error: null }) }) });
  chain.update = () => chain;
  chain.upsert = values => {
    if (table === 'cowork_enrich_batch_proposals') s.staged = values;
    return { ...chain, select: () => ({ ...chain, maybeSingle: async () => ({ data: null, error: null }) }) };
  };
  chain.maybeSingle = async () => {
    if (table === 'cowork_runs') return { data: { status: s.workStatus }, error: null };
    if (table === 'leads') {
      const id = chain._eq.find(([column]) => column === 'id')?.[1];
      if (id) return { data: s.owned.includes(id)
        ? { id, name: 'Ana', email: null, source_provider: 'apollo', source_provider_id: id }
        : null, error: null };
      return { data: null, error: null };
    }
    if (table === 'cowork_enrich_batch_proposals') return { data: s.staged, error: null };
    if (table === 'enriched_leads') return { data: { id: 'e1', email: 'a@example.com', email_status: 'verified', enrichment_status: 'completed' }, error: null };
    if (table === 'apollo_enrichment_callbacks') return { data: { target_lead_id: 'e1' }, error: null };
    return { data: null, error: null };
  };
  chain.then = resolve => resolve({ data: table === 'leads' && chain._in
    ? (s.owned.filter(id => chain._in[1].includes(id)).map(id => ({ id })))
    : table === 'cowork_run_events'
      ? [{ kind: 'tool.completed', payload: { action: 'lists.review_batch',
        result: { items: s.observed.map(leadId => ({ leadId })) } } }]
      : [], error: null });
  return chain;
}
const sources = {
  '@/lib/server/supabase-admin': 'export const getSupabaseAdminClient=()=>({from:t=>globalThis.__coworkEnrichBatch.table(t)});',
  './runs': 'export const getCoworkRun=async()=>({run:{status:globalThis.__coworkEnrichBatch.runStatus},events:globalThis.__coworkEnrichBatch.events()});',
  './access': 'export const requireCoworkWorkerAccess=async()=>{if(!globalThis.__coworkEnrichBatch.access)throw new Error("denied");};',
  '@/lib/server/daily-quota-store': `export const getEffectiveDailyQuotaLimits=async()=>({enrich:10});
    export const getEnrichmentQuotaOperation=async()=>globalThis.__coworkEnrichBatch.existingOp;
    export const claimEnrichmentQuotaOperation=async()=>{const s=globalThis.__coworkEnrichBatch;if(!s.quotaOpen)return{claimed:false,allowed:false};s.claims++;return{claimed:true,allowed:true,claimToken:'token'};};
    export const releaseEnrichmentQuotaOperation=async()=>{};
    export const completeEnrichmentQuotaOperation=async()=>{};`,
  '@/lib/server/enrichment-search-access': 'export const hasUserEnrichmentSearchCreditAccess=async()=>true;',
  '@/lib/server/apollo-enrichment-callbacks': `export const createApolloEnrichmentCallback=async()=>({callbackId:'cb',tokenHash:'${'a'.repeat(64)}',claimToken:'c'});
    export const markApolloEnrichmentCallbackSubmitted=async()=>{};
    export const bindApolloEnrichmentCallback=async()=>'bound';
    export const applyApolloEnrichmentCandidate=async()=>'processed';
    export const settleApolloEnrichmentCallback=async()=>{};`,
  '@/lib/server/apollo-enrichment': 'export const submitApolloEnrichment=async input=>globalThis.__coworkEnrichBatch.submit(input);',
  '@/lib/messaging-contracts': 'export const canonicalSha256=o=>{const c=require("node:crypto").createHash("sha256").update(JSON.stringify(o)).digest("hex");return c;};',
};
globalThis.__coworkEnrichBatch.table = tableHandler;
globalThis.__coworkEnrichBatch.events = () => [{
  kind: 'tool.completed',
  payload: { action: 'lists.review_batch', result: { items: globalThis.__coworkEnrichBatch.observed.map(leadId => ({ leadId })) } },
}];
globalThis.__coworkEnrichBatch.submit = async input => {
  const s = globalThis.__coworkEnrichBatch;
  const id = input.lead?.sourceProviderId || 'unknown';
  const mode = s.provider[id] || 'verified';
  if (mode === 'throw') throw new Error('socket hang up');
  return { success: true, providerRequestId: `pr-${id}`, creditsConsumed: 1,
    extractedData: { email: `${id}@example.com`, email_status: mode === 'verified' ? 'verified' : 'likely to engage', source_provider_id: id } };
};
const bundle = await build({ entryPoints: ['src/lib/server/cowork/enrich-batch.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
  plugins: [{ name: 'isolated-services', setup(b) {
    b.onResolve({ filter: /.*/ }, args => sources[args.path] ? { path: args.path, namespace: 'fixture' } : undefined);
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: sources[args.path] }));
  } }],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const api = module.exports;
const scope = { userId: 'owner', organizationId: 'org' };
const auth = { user: { id: 'owner' }, organizationId: 'org', supabase: { from: tableHandler } };
try {
  // 1. Staging refuses duplicates, unobserved and foreign leads.
  await assert.rejects(api.stageCoworkEnrichBatch(scope, RUN, [LEADS[0], LEADS[0]]), /duplicados/);
  state.observed = [LEADS[0]];
  await assert.rejects(api.stageCoworkEnrichBatch(scope, RUN, [LEADS[0], LEADS[1]]), /observado/);
  state.observed = [...LEADS];
  state.owned = [LEADS[0]];
  await assert.rejects(api.stageCoworkEnrichBatch(scope, RUN, [LEADS[0], LEADS[1]]), /propios/);
  state.owned = [...LEADS];
  // 2. Valid batch stages with cost estimate and hash target.
  const staged = await api.stageCoworkEnrichBatch(scope, RUN, [LEADS[1], LEADS[0]]);
  assert.equal(staged.costEstimate, 2);
  assert.match(staged.hash, /^[a-f0-9]{64}$/);
  api.parseCoworkEnrichBatchTarget(`enrichbatch:${staged.hash}`);
  assert.throws(() => api.parseCoworkEnrichBatchTarget('enrich_contact:abc'), /no es válida/);
  // 3. Execution reconciles per item: verified, unverified, quota wall stops the rest.
  state.provider = { [LEADS[0]]: 'verified', [LEADS[1]]: 'likely' };
  state.quotaOpen = true;
  const done = await api.executeCoworkEnrichBatch(auth, RUN, `enrichbatch:${staged.hash}`);
  assert.equal(done.result.items.length, 2);
  assert.equal(done.result.items[0].status, 'enriched');
  assert.equal(done.result.items[0].verifiedForList, true);
  assert.equal(done.result.items[1].status, 'enriched');
  assert.equal(done.result.items[1].verifiedForList, false);
  // 4. Resume is safe: completed reuses, in-flight reports without double charge.
  state.existingOp = { status: 'completed' };
  const replay = await api.executeCoworkEnrichBatch(auth, RUN, `enrichbatch:${staged.hash}`);
  assert.ok(replay.result.items.every(item => item.status === 'reused'));
  const claimsBefore = state.claims;
  state.existingOp = { status: 'submitted' };
  const waiting = await api.executeCoworkEnrichBatch(auth, RUN, `enrichbatch:${staged.hash}`);
  assert.ok(waiting.result.items.every(item => item.status === 'already_requested'));
  assert.equal(state.claims, claimsBefore, 'resume must not consume quota again');
  state.existingOp = null;
  // 5. Tampered batch refuses execution.
  state.staged = { ...state.staged, lead_ids: [LEADS[2]] };
  await assert.rejects(api.executeCoworkEnrichBatch(auth, RUN, `enrichbatch:${staged.hash}`), /cambió desde/);
  console.log('PASS: batch staging, per-item reconciliation, quota wall and safe resume without double charge.');
} finally {
  delete globalThis.__coworkEnrichBatch;
}

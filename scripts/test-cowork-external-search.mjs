// No secrets, environment files or providers: exercises claim/quota/provider ordering.
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const envBefore = process.env.COWORK_EXTERNAL_SEARCH_ENABLED;
const enabledBefore = process.env.COWORK_ENABLED;
process.env.COWORK_ENABLED = 'true';
process.env.COWORK_EXTERNAL_SEARCH_ENABLED = 'true';
const state = { claimed: false, approved: false, cancelled: false, quota: 0, provider: 0, allow: true, failProvider: false, finishes: [], admissions: [] };
const criteria = { titles: ['Gerente'], industries: [], locations: ['Chile'], limit: 5 };
globalThis.__coworkSearch = {
  client: {
    rpc: async (name, args) => {
      if (name === 'cowork_claim_search') {
        state.approved = args.p_approve;
        return { data: { approved: args.p_approve }, error: null };
      }
      if (name === 'cowork_take_search') {
        if (!state.approved || state.claimed) return { data: [], error: null };
        state.claimed = true;
        return { data: [{ criteria, run_id: 'run', user_id: 'owner', organization_id: 'org' }], error: null };
      }
      if (name === 'cowork_admit_followup') {
        state.admissions.push(args);
        return { data: '00000000-0000-4000-8000-000000000099', error: null };
      }
      state.finishes.push(args);
      return { data: true, error: null };
    },
    from: () => ({ select: () => { const chain = { eq: () => chain, in: () => chain,
      single: async () => ({ data: { status: state.cancelled ? 'cancelled' : 'waiting_approval', mode: 'approval' }, error: null }),
      maybeSingle: async () => ({ data: { id: 'run', parent_run_id: null, depth: 0 }, error: null }),
      then(resolve) { resolve({ data: [], error: null }); } }; return chain; } }),
    // Thread-budget event log is observability only in this suite.
  },
  quota: async () => { state.quota++; return { allowed: state.allow }; },
  provider: async payload => {
    state.provider++;
    assert.equal(payload.reveal_email, false); assert.equal(payload.reveal_phone, false);
    assert.equal(payload.user_id, 'owner'); assert.equal(payload.max_results, 5);
    if (state.failProvider) throw new Error('timeout');
    return { leads: [{ id: 'external-1', name: 'Ejemplo', email: 'not-authorized@example.com', linkedin_url: 'https://www.linkedin.com/in/example', organization: { name: 'Empresa', website_url: 'https://empresa.example', linkedin_url: 'javascript:alert(1)' } }] };
  },
};
const sources = {
  './enrich-contact': 'export const enrichCoworkContact=async()=>{throw new Error("unexpected enrichment")};',
  './send-email': 'export const sendCoworkEmail=async()=>{throw new Error("unexpected send")};',
  './campaign-ops': 'export const createCoworkCampaign=async()=>{throw new Error("unexpected campaign")};export const reviewCoworkCampaign=createCoworkCampaign;',
  '@/lib/server/supabase-admin': 'export const getSupabaseAdminClient=()=>globalThis.__coworkSearch.client;',
  '@/lib/server/daily-quota-store': 'export const getEffectiveDailyQuotaLimits=async()=>({leadSearch:10});export const checkAndConsumeDailyQuota=()=>globalThis.__coworkSearch.quota();',
  '@/lib/server/apollo-search-client': 'export const requestApolloSearch=p=>globalThis.__coworkSearch.provider(p);',
  '@/lib/cowork/capabilities': 'export const createCoworkGateway=()=>{throw new Error("gateway unused in this suite")};',
  './access': 'export const requireCoworkWorkerAccess=async()=>{};',
};
const bundle = await build({ entryPoints: ['src/lib/server/cowork/external-search.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
  plugins: [{ name: 'isolated-services', setup(build) {
    build.onResolve({ filter: /.*/ }, args => sources[args.path] ? { path: args.path, namespace: 'fixture' } : undefined);
    build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: sources[args.path] }));
  } }],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const auth = { user: { id: 'owner' }, organizationId: 'org' };
const run = approve => module.exports.resolveCoworkSearch(auth, 'run', approve);
const tick = () => module.exports.processCoworkSearchQueue();
try {
  assert.equal(await run(true), true);
  assert.equal(await run(true), true);
  assert.equal(state.quota, 0); assert.equal(state.provider, 0);
  const parallel = await Promise.all([tick(), tick()]);
  assert.equal(parallel.filter(result => result.claimed).length, 1);
  assert.equal(state.quota, 1); assert.equal(state.provider, 1);
  assert.equal(state.finishes[0].p_payload.result.items[0].id, 'apollo:external-1');
  assert.equal(state.finishes[0].p_payload.result.items[0].email, null);
  assert.equal(state.finishes[0].p_payload.result.items[0].company_website, 'https://empresa.example/');
  assert.equal(state.finishes[0].p_payload.result.items[0].linkedin_url, 'https://www.linkedin.com/in/example');
  assert.equal(state.finishes[0].p_payload.result.items[0].company_linkedin, null);
  state.claimed = false; state.allow = false;
  assert.equal((await tick()).processed, 0);
  assert.equal(state.provider, 1);
  state.claimed = false; state.allow = true; state.failProvider = true;
  assert.equal((await tick()).processed, 0);
  assert.equal((await tick()).claimed, false);
  assert.equal(state.provider, 2);
  const calls = state.quota;
  state.claimed = false;
  assert.equal(await run(false), true);
  assert.equal((await tick()).claimed, false);
  assert.equal(state.quota, calls);
  state.approved = true; state.claimed = false; state.cancelled = true;
  assert.equal((await tick()).processed, 0);
  assert.equal(state.provider, 2);
  assert.equal(state.admissions.length, 1);
  assert.equal(state.admissions[0].p_parent_run_id, 'run');
  assert.equal(state.admissions[0].p_mode, 'approval');
  assert.ok(String(state.admissions[0].p_message).length > 20);
  const retryRequestId = state.admissions[0].p_request_id;
  assert.match(retryRequestId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  state.cancelled = false;
  assert.equal(await module.exports.admitSearchContinuation(globalThis.__coworkSearch.client, { userId: 'owner', organizationId: 'org' }, 'run'), '00000000-0000-4000-8000-000000000099');
  assert.equal(state.admissions.length, 2);
  assert.equal(state.admissions[1].p_request_id, retryRequestId);
  console.log('PASS: approval without provider call, background claim, parallel ticks, quota exhaustion, timeout without replay, no reveal, rejection and cancellation.');
} finally {
  delete globalThis.__coworkSearch;
  if (envBefore === undefined) delete process.env.COWORK_EXTERNAL_SEARCH_ENABLED;
  else process.env.COWORK_EXTERNAL_SEARCH_ENABLED = envBefore;
  if (enabledBefore === undefined) delete process.env.COWORK_ENABLED;
  else process.env.COWORK_ENABLED = enabledBefore;
}

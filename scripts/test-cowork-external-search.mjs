// No secrets, environment files or providers: exercises claim/quota/provider ordering.
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const envBefore = process.env.COWORK_EXTERNAL_SEARCH_ENABLED;
const enabledBefore = process.env.COWORK_ENABLED;
process.env.COWORK_ENABLED = 'true';
process.env.COWORK_EXTERNAL_SEARCH_ENABLED = 'true';
const state = { claimed: false, approved: false, cancelled: false, quota: 0, provider: 0, allow: true, failProvider: false, finishes: [], admissions: [] };
let criteria = { titles: ['Gerente'], industries: [], locations: ['Chile'], limit: 5 };
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
    assert.equal(payload.user_id, 'owner');
    if (state.failProvider) throw new Error('timeout');
    if (state.companiesFirst) return state.companiesFirst(payload);
    assert.equal(payload.max_results, 5);
    if (payload.search_mode === 'organization_search') {
      assert.deepEqual(payload.company_location, ['Chile']);
      return { organizations: [{ id: 'company-1', name: 'Empresa', primary_domain: 'example.com', estimated_num_employees: 80 }] };
    }
    return { leads: [{ id: 'external-1', name: 'Ejemplo', email: 'not-authorized@example.com', linkedin_url: 'https://www.linkedin.com/in/example', organization: { name: 'Empresa', website_url: 'https://empresa.example', linkedin_url: 'javascript:alert(1)' } }] };
  },
};
const sources = {
  './enrich-contact': 'export const enrichCoworkContact=async()=>{throw new Error("unexpected enrichment")};export const enrichCoworkSavedLead=enrichCoworkContact;',
  './send-email': 'export const sendCoworkEmail=async()=>{throw new Error("unexpected send")};',
  './reply-thread-effect': 'export const executeCoworkReplyThread=async()=>{throw new Error("unexpected reply")};',
  './enrich-phone': 'export const executeCoworkPhoneReveal=async()=>{throw new Error("unexpected phone reveal")};',
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
  criteria = { target: 'companies', titles: [], industries: ['outsourcing'], locations: [], companyLocations: ['Chile'], employeeRanges: ['51-200'], limit: 5 };
  state.claimed = false; state.approved = true; state.failProvider = false;
  assert.equal((await tick()).processed, 1);
  const companyResult = state.finishes.at(-1).p_payload.result;
  assert.equal(companyResult.scope, 'external_company_search');
  assert.equal(companyResult.items[0].id, 'apollo-company:company-1');
  assert.equal(companyResult.items[0].domain, 'example.com');
  assert.equal(companyResult.items[0].employees, 80);
  assert.equal(state.admissions.length, 3);
  assert.equal((await tick()).claimed, false);

  // Companies first (the 1 Oct test brought 2 of 25): 60 companies of the offer's industries, then the people inside them,
  // 50 companies per provider call, buyers first; one search of the daily quota for the three calls.
  const companies = Array.from({ length: 60 }, (_, index) => ({ id: `org-${index}`, name: `Empresa ${index}`, industry: 'outsourcing',
    estimated_num_employees: 100 + index, website_url: `https://empresa${index}.example` }));
  const peopleOf = ids => ids.flatMap(id => [
    { id: `${id}-analyst`, name: 'Luis R***s', title: 'Analista de Selección', organization: { id } },
    { id: `${id}-boss`, name: 'Ana P***z', title: 'Gerente de Personas', organization: { id } },
  ]);
  let groupFails = false;
  let noCompanies = false;
  state.companiesFirst = payload => {
    if (payload.search_mode === 'organization_search') {
      assert.deepEqual(payload.company_keywords, ['servicios', 'outsourcing']);
      assert.deepEqual(payload.company_location, ['Chile']);
      assert.equal(payload.per_page, 100);
      assert.equal('titles' in payload, false);
      return noCompanies ? { organizations: [] } : { organizations: companies, total_pages: 3 };
    }
    assert.equal(payload.search_mode, 'batch');
    assert.equal(payload.include_similar_titles, true);
    assert.ok(payload.organization_ids.length >= 1 && payload.organization_ids.length <= 50);
    assert.deepEqual(payload.titles, ['Gerente de Personas', 'Jefe de Reclutamiento']);
    if (groupFails && payload.organization_ids.includes('org-55')) throw new Error('timeout');
    return { leads: peopleOf(payload.organization_ids) };
  };
  criteria = { titles: ['Gerente de Personas', 'Jefe de Reclutamiento'], industries: ['servicios', 'outsourcing'], locations: ['Santiago, Chile'], limit: 25,
    rolePolicy: { decisionTerms: ['gerente de personas', 'jefe de reclutamiento'], userTerms: [], referralTerms: ['analista'], excludeTerms: [] } };
  const before = { quota: state.quota, provider: state.provider };
  state.claimed = false; state.approved = true;
  assert.equal((await tick()).processed, 1);
  assert.equal(state.quota - before.quota, 1, 'one search of the daily quota');
  assert.equal(state.provider - before.provider, 3, 'the companies, then their people in two groups');
  const found = state.finishes.at(-1).p_payload.result;
  assert.equal(found.scope, 'external_search');
  assert.equal(found.strategy, 'companies_first');
  assert.equal(found.items.length, 25);
  assert.equal(found.candidates, 120);
  assert.deepEqual(found.companies, { found: 60, withPeople: 60 });
  assert.ok(found.items.every(item => item.role === 'decision_maker_candidate'), 'who may decide the purchase comes first');
  assert.equal(found.items[0].id, 'apollo:org-0-boss');
  assert.equal(found.items[0].company, 'Empresa 0', 'the company found first names the people search left without one');
  assert.equal(found.items[0].industry, 'outsourcing');
  assert.equal(found.items[0].employees, 100);
  assert.equal(found.items[0].company_website, 'https://empresa0.example/');
  assert.equal(found.items[0].email, null);
  assert.match(found.items[0].fit, /^Posible comprador: cargo con «gerente de personas» · outsourcing, 100 empleados$/);
  assert.deepEqual(found.next, { page: 1, offset: 25 }, '«Traer más» continues with the people of these same companies');
  assert.ok(JSON.stringify(found).length < 20000, 'a page of results stays small enough for the next turn');
  // «Traer más»: the next people of the same companies, then the next page of companies.
  criteria = { ...criteria, offset: 100 };
  state.claimed = false; state.approved = true;
  assert.equal((await tick()).processed, 1);
  const last = state.finishes.at(-1).p_payload.result;
  assert.equal(last.items.length, 20);
  assert.ok(last.items.every(item => item.role === 'referrer_candidate'));
  assert.deepEqual(last.next, { page: 2, offset: 0 });
  // A group that does not answer leaves the rest of the list, and says so.
  criteria = { ...criteria, offset: 0, limit: 100 };
  groupFails = true;
  state.claimed = false; state.approved = true;
  assert.equal((await tick()).processed, 1);
  const partial = state.finishes.at(-1).p_payload.result;
  assert.equal(partial.candidates, 100);
  assert.deepEqual(partial.companies, { found: 60, withPeople: 50 });
  assert.match(partial.notice, /no respondió a tiempo/);
  assert.ok(JSON.stringify(partial).length < 60000, 'even 100 people fit the history of the next turn');
  // No companies: an empty list with what to try, not a failure.
  noCompanies = true; groupFails = false;
  state.claimed = false; state.approved = true;
  const providerCalls = state.provider;
  assert.equal((await tick()).processed, 1);
  const empty = state.finishes.at(-1).p_payload.result;
  assert.equal(state.provider - providerCalls, 1, 'no people search without companies');
  assert.deepEqual(empty.items, []);
  assert.match(empty.notice, /No encontré empresas/);
  assert.equal(empty.next, null);
  console.log('PASS: approval without provider call, background claim, parallel ticks, quota exhaustion, timeout without replay, no reveal, rejection and cancellation; companies first with buyers first, «Traer más», a group that fails and no companies.');
} finally {
  delete globalThis.__coworkSearch;
  if (envBefore === undefined) delete process.env.COWORK_EXTERNAL_SEARCH_ENABLED;
  else process.env.COWORK_EXTERNAL_SEARCH_ENABLED = envBefore;
  if (enabledBefore === undefined) delete process.env.COWORK_ENABLED;
  else process.env.COWORK_ENABLED = enabledBefore;
}

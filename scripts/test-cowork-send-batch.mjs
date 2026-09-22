// Fase 4: send batch staging/execution with in-memory tables. No providers, secrets or env files.
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const RUN = '00000000-0000-4000-8000-000000000010';
const CAMPAIGN = '00000000-0000-4000-8000-000000000011';
const delays = [0, 2, 4, 4, 5, 7, 15];
const recipients = [
  { email: 'ana@acme.cl', name: 'Ana', company: 'Acme' },
  { email: 'luis@acme.cl', name: 'Luis', company: 'Acme' },
  { email: 'mia@beta.cl', name: 'Mia', company: 'Beta' },
];
const state = {
  runStatus: 'completed',
  campaign: { id: CAMPAIGN, organization_id: 'org', user_id: 'owner', revision: 1, status: 'draft', recipients,
    definition: { messages: delays.map(delayDays => ({ subject: 's', body: 'b', delayDays })) } },
  staged: null, batches: [], reserved: [],
};

function matches(row, filters) {
  return filters.every(([column, value]) => row[column] === value);
}

function tableHandler(table) {
  const s = globalThis.__coworkSendBatch;
  const chain = { _eq: [], _in: [] };
  chain.select = () => chain;
  chain.eq = (column, value) => { chain._eq.push([column, value]); return chain; };
  chain.in = () => chain;
  chain.order = () => chain;
  chain.limit = () => chain;
  chain.upsert = values => {
    if (table === 'cowork_send_batch_proposals') {
      if (s.staged && s.staged.run_id === values.run_id) return { select: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) };
      s.staged = { ...values };
      return { select: () => ({ maybeSingle: async () => ({ data: { run_id: values.run_id }, error: null }) }) };
    }
    throw new Error(`unexpected upsert ${table}`);
  };
  chain.insert = values => {
    if (table === 'cowork_company_send_days') {
      for (const row of values) {
        if (s.reserved.some(existing => existing.organization_id === row.organization_id
          && existing.company_key === row.company_key && existing.send_day === row.send_day)) {
          return Promise.resolve({ error: { code: '23505' } });
        }
      }
      s.reserved.push(...values);
      return Promise.resolve({ error: null });
    }
    throw new Error(`unexpected insert ${table}`);
  };
  chain.maybeSingle = async () => {
    if (table === 'cowork_runs') return { data: { status: 'running' }, error: null };
    if (table === 'bulk_campaigns') {
      return matches(s.campaign, chain._eq) || chain._eq.length === 0
        ? { data: s.campaign, error: null } : { data: null, error: null };
    }
    if (table === 'cowork_send_batch_proposals') {
      return s.staged && matches(s.staged, chain._eq) ? { data: s.staged, error: null } : { data: null, error: null };
    }
    if (table === 'cowork_send_batches') return { data: s.batches.find(row => matches(row, chain._eq)) || null, error: null };
    return { data: null, error: null };
  };
  return chain;
}

const sources = {
  '@/lib/server/supabase-admin': 'export const getSupabaseAdminClient=()=>({from:t=>globalThis.__coworkSendBatch.table(t),rpc:(name,args)=>globalThis.__coworkSendBatch.rpc(name,args)});',
  './runs': 'export const getCoworkRun=async()=>({run:{status:globalThis.__coworkSendBatch.runStatus},events:[]});',
  './access': 'export const requireCoworkWorkerAccess=async()=>{};',
};
globalThis.__coworkSendBatch = state;
globalThis.__coworkSendBatch.table = tableHandler;
// Contract fake only: actual transaction/concurrency still requires PostgreSQL validation.
globalThis.__coworkSendBatch.rpc = async (name, args) => {
  assert.equal(name, 'cowork_schedule_send_batch');
  assert.equal(args.p_org, 'org'); assert.equal(args.p_user, 'owner');
  const existing = state.batches.find(row => row.proposal_hash === args.p_hash);
  if (existing) return { error: null };
  const values = args.p_plan.flatMap(row => row.companyKeys.map(company_key => ({ organization_id: args.p_org, company_key, send_day: row.sendDay, recipient_email: row.email })));
  if (values.some(row => state.reserved.some(old => old.company_key === row.company_key && old.send_day === row.send_day))) return { error: { code: '23505' } };
  state.batches.push({ campaign_id: CAMPAIGN, run_id: RUN, user_id: 'owner', organization_id: 'org', spacing_minutes: state.staged.spacing_minutes, proposal_hash: args.p_hash });
  state.reserved.push(...values);
  return { error: null };
};
const bundle = await build({ entryPoints: ['src/lib/server/cowork/send-batch.ts'], bundle: true, write: false,
  platform: 'node', format: 'cjs', packages: 'external',
  plugins: [{ name: 'isolated-services', setup(b) {
    b.onResolve({ filter: /.*/ }, args => sources[args.path] ? { path: args.path, namespace: 'fixture' } : undefined);
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: sources[args.path] }));
  } }],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const api = module.exports;
const scope = { userId: 'owner', organizationId: 'org' };
const auth = { user: { id: 'owner' }, organizationId: 'org' };
try {
  // 1. Unknown campaign refuses before staging.
  await assert.rejects(api.stageCoworkSendBatch(scope, RUN, { campaignId: '00000000-0000-4000-8000-000000000099' }), /no está disponible/);
  // 2. Valid draft stages with stagger: Acme repeats, so two days reserved.
  const staged = await api.stageCoworkSendBatch(scope, RUN, { campaignId: CAMPAIGN, spacingMinutes: 45 });
  assert.match(staged.hash, /^[a-f0-9]{64}$/);
  assert.equal(staged.recipients, 3);
  assert.equal(staged.staggered, 1);
  assert.equal(staged.touches, 7);
  api.parseCoworkSendBatchTarget(`sendbatch:${staged.hash}`);
  assert.throws(() => api.parseCoworkSendBatchTarget('sendbatch:xyz'), /no es válida/);
  // 3. A different spacing in the same run conflicts.
  await assert.rejects(api.stageCoworkSendBatch(scope, RUN, { campaignId: CAMPAIGN, spacingMinutes: 60 }), /otra programación/);
  // 4. Wrong hash refuses execution.
  await assert.rejects(api.executeCoworkSendBatch(auth, RUN, `sendbatch:${'b'.repeat(64)}`), /cambió desde tu revisión/);
  // 5. Approved execution persists the batch and one day per company.
  const done = await api.executeCoworkSendBatch(auth, RUN, `sendbatch:${staged.hash}`);
  assert.match(done.reply, /Lote programado: 3 destinatarios/);
  assert.equal(state.batches.length, 1);
  assert.equal(state.batches[0].spacing_minutes, 45);
  assert.equal(state.reserved.length, 6);
  const acmeDays = new Set(state.reserved.filter(row => row.company_key === 'domain:acme.cl').map(row => row.send_day));
  assert.equal(acmeDays.size, 2);
  await api.executeCoworkSendBatch(auth, RUN, `sendbatch:${staged.hash}`);
  assert.equal(state.batches.length, 1); assert.equal(state.reserved.length, 6);
  // 6. Campaign revision drift refuses without touching reservations.
  state.campaign = { ...state.campaign, revision: 2 };
  await assert.rejects(api.executeCoworkSendBatch(auth, RUN, `sendbatch:${staged.hash}`), /cambió/);
  assert.equal(state.reserved.length, 6);
  state.campaign = { ...state.campaign, revision: 1 };
  // 7. A concurrent reservation for the same company and day conflicts.
  state.staged = null; state.batches = [];
  const again = await api.stageCoworkSendBatch(scope, RUN, { campaignId: CAMPAIGN });
  assert.ok(again.hash);
  await assert.rejects(api.executeCoworkSendBatch(auth, RUN, `sendbatch:${again.hash}`), /ya reservo esa empresa/);
  assert.equal(state.batches.length, 0, 'reservation failure must not publish a batch');
  console.log('PASS: send batch staging, hash binding, revision drift and atomic RPC contract (fake, not PostgreSQL concurrency).');
} finally {
  delete globalThis.__coworkSendBatch;
}

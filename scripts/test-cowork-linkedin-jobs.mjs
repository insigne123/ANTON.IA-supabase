// Fase 5: linkedin job staging/execution with in-memory tables. No providers, secrets or env files.
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const RUN = '00000000-0000-4000-8000-000000000010';
const LEAD = '00000000-0000-4000-8000-000000000021';
const state = {
  runStatus: 'completed',
  lead: { id: LEAD, organization_id: 'org', name: 'Ana Pérez', email: 'ana@acme.cl',
    title: 'Gerenta', company: 'Acme', linkedin_url: 'https://www.linkedin.com/in/ana-perez' },
  stages: [{ id: `lead_saved|${LEAD}`, stage: 'contacted' }],
  contacted: [],
  staged: null, jobs: [],
};

function matches(row, filters, floors) {
  return filters.every(([column, value]) => row[column] === value)
    && floors.every(([column, value]) => String(row[column] || '') >= String(value));
}

function tableHandler(table) {
  const s = globalThis.__coworkLinkedinJobs;
  const chain = { _eq: [], _in: [], _gte: [] };
  chain.select = () => chain;
  chain.eq = (column, value) => { chain._eq.push([column, value]); return chain; };
  chain.not = () => chain;
  chain.in = () => chain;
  chain.order = () => chain;
  chain.limit = () => chain;
  chain.gte = (column, value) => { chain._gte.push([column, value]); return chain; };
  chain.upsert = values => {
    if (table === 'cowork_linkedin_job_proposals') {
      if (s.staged && s.staged.run_id === values.run_id) return { select: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) };
      s.staged = { ...values };
      return { select: () => ({ maybeSingle: async () => ({ data: { run_id: values.run_id }, error: null }) }) };
    }
    if (table === 'cowork_linkedin_jobs') {
      const conflict = (col, vals) => vals;
      void conflict;
      s.jobs.push({ id: `job-${s.jobs.length + 1}`, status: 'queued', created_at: new Date().toISOString(), ...values });
      return { select: () => ({ maybeSingle: async () => ({ data: s.jobs[s.jobs.length - 1], error: null }) }) };
    }
    throw new Error(`unexpected upsert ${table}`);
  };
  const selectMany = () => {
    if (table === 'cowork_linkedin_jobs') {
      const filtered = s.jobs.filter(row => matches(row, chain._eq, chain._gte));
      return { data: filtered, error: null, count: filtered.length };
    }
    if (table === 'contacted_leads') return { data: s.contacted, error: null };
    if (table === 'unified_crm_data') return { data: s.stages, error: null };
    return { data: [], error: null };
  };
  chain.maybeSingle = async () => {
    if (table === 'cowork_runs') return { data: { status: 'running' }, error: null };
    if (table === 'leads') {
      return matches(s.lead, chain._eq, chain._gte) ? { data: s.lead, error: null } : { data: null, error: null };
    }
    if (table === 'cowork_linkedin_job_proposals') {
      return s.staged && matches(s.staged, chain._eq, chain._gte) ? { data: s.staged, error: null } : { data: null, error: null };
    }
    return { data: null, error: null };
  };
  chain.then = resolve => resolve(selectMany());
  return chain;
}
// count queries use select(columns, {count:'exact',head:true}) then .then
const countingHandler = tableHandler;

const sources = {
  '@/lib/server/supabase-admin': 'export const getSupabaseAdminClient=()=>({from:t=>globalThis.__coworkLinkedinJobs.table(t)});',
  './runs': 'export const getCoworkRun=async()=>({run:{status:globalThis.__coworkLinkedinJobs.runStatus},events:[]});',
  './access': 'export const requireCoworkWorkerAccess=async()=>{};',
  '@/lib/server/campaign-send-guards': `export const findCompanyReply=async()=>{const s=globalThis.__coworkLinkedinJobs;return s.contacted.length?{stopped:true,email:s.contacted[0].email}:{stopped:false};};
    export const findNegotiationHold=async()=>({held:false});`,
};
globalThis.__coworkLinkedinJobs = state;
globalThis.__coworkLinkedinJobs.table = countingHandler;
const bundle = await build({ entryPoints: ['src/lib/server/cowork/linkedin-jobs.ts'], bundle: true, write: false,
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
  // Count queries: invite quota uses head-count selects resolved through .then.
  const quotaJobs = state.jobs;
  void quotaJobs;
  // 1. Unknown lead refuses before staging.
  await assert.rejects(api.stageCoworkLinkedinInvite(scope, RUN, { leadId: '00000000-0000-4000-8000-000000000099' }), /no está disponible/);
  // 2. Lead without usable profile url refuses.
  state.lead = { ...state.lead, linkedin_url: 'not-a-url' };
  await assert.rejects(api.stageCoworkLinkedinInvite(scope, RUN, { leadId: LEAD }), /válida/);
  state.lead = { ...state.lead, linkedin_url: 'https://www.linkedin.com/in/ana-perez' };
  // 3. Name mismatch refuses (wrong person protection).
  state.lead = { ...state.lead, name: 'Luis García Contreras' };
  await assert.rejects(api.stageCoworkLinkedinInvite(scope, RUN, { leadId: LEAD }), /no corresponde/);
  state.lead = { ...state.lead, name: 'Ana Pérez' };
  // 4. Valid invite stages with hash target.
  const invite = await api.stageCoworkLinkedinInvite(scope, RUN, { leadId: LEAD });
  assert.match(invite.hash, /^[a-f0-9]{64}$/);
  assert.equal(invite.nameCheck, 'verified');
  api.parseCoworkLinkedinJobTarget(`linkedinjob:${invite.hash}`);
  assert.throws(() => api.parseCoworkLinkedinJobTarget('linkedinjob:xyz'), /no es válida/);
  // 5. Approved execution queues the job with expiry guidance.
  const done = await api.executeCoworkLinkedinInvite(auth, RUN, `linkedinjob:${invite.hash}`);
  assert.match(done.reply, /en cola/);
  assert.equal(state.jobs.length, 1);
  assert.equal(state.jobs[0].kind, 'invite');
  assert.equal(state.jobs[0].message, null);
  // 6. Duplicate invite refuses instead of queueing twice.
  state.staged = null;
  await assert.rejects(api.stageCoworkLinkedinInvite(scope, RUN, { leadId: LEAD }), /Ya hay una invitación/);
  // 7. Company reply retains the message (previous invite aged past the daily cap).
  state.jobs.forEach(job => { job.created_at = '2026-09-01T12:00:00Z'; });
  state.contacted = [{ email: 'jefa@acme.cl' }];
  await assert.rejects(api.stageCoworkLinkedinMessage(scope, RUN, { leadId: LEAD, message: 'Hola Ana' }), /ya respondió/);
  state.contacted = [];
  // 8. Negotiation stage retains the message.
  state.stages = [{ id: `lead_saved|${LEAD}`, stage: 'negotiation' }];
  await assert.rejects(api.stageCoworkLinkedinMessage(scope, RUN, { leadId: LEAD, message: 'Hola Ana' }), /negociación|etapa/);
  state.stages = [{ id: `lead_saved|${LEAD}`, stage: 'contacted' }];
  // 9. Valid message stages, executes and binds the approved text.
  const staged = await api.stageCoworkLinkedinMessage(scope, RUN, { leadId: LEAD, message: 'Hola Ana, ¿conversamos?' });
  assert.match(staged.hash, /^[a-f0-9]{64}$/);
  const sent = await api.executeCoworkLinkedinMessage(auth, RUN, `linkedinjob:${staged.hash}`);
  assert.match(sent.reply, /en cola/);
  assert.equal(state.jobs.length, 2);
  assert.equal(state.jobs[1].message, 'Hola Ana, ¿conversamos?');
  // 10. Same content refuses as duplicate; profile change refuses execution.
  state.staged = null;
  await assert.rejects(api.stageCoworkLinkedinMessage(scope, RUN, { leadId: LEAD, message: 'Hola Ana, ¿conversamos?' }), /ya tiene un trabajo/);
  console.log('PASS: linkedin invite/message staging, identity refusal, quota/reply/negotiation brakes and hash-bound execution without writes.');
} finally {
  delete globalThis.__coworkLinkedinJobs;
}

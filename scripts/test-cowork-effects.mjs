// No secrets, environment files or providers: exercises effect propose/approve/execute.
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
process.env.COWORK_ENABLED = 'true';
const state = { proposals: [], takes: 0, finishes: [], admissions: [], executed: [], events: [], depth: 0 };
const lease = '00000000-0000-4000-8000-000000000010';
const client = {
  rpc: async (name, args) => {
    if (name === 'cowork_propose_effect') {
      state.proposals.push(args);
      return { data: true, error: null };
    }
    if (name === 'cowork_resolve_effect') return { data: true, error: null };
    if (name === 'cowork_take_effect') {
      state.takes++;
      if (state.takes > 1) return { data: [], error: null };
      return { data: [{ run_id: 'run-effect', user_id: 'owner', organization_id: 'org',
        kind: state.kind || 'save_contact', origin_run_id: 'run-origin', target_id: 'apollo:abc', label: 'Guardar contacto' }], error: null };
    }
    if (name === 'cowork_finish_effect') {
      state.finishes.push(args);
      return { data: true, error: null };
    }
    if (name === 'cowork_admit_followup') {
      state.admissions.push(args);
      return { data: 'child-run', error: null };
    }
    throw new Error(`unexpected rpc ${name}`);
  },
  from: table => {
    const chain = { select: () => chain, eq: () => chain, in: () => chain,
      single: async () => table === 'cowork_runs'
        ? { data: { status: 'waiting_approval', mode: 'approval' }, error: null }
        : { data: null, error: null },
      maybeSingle: async () => ({ data: { id: 'run-effect', parent_run_id: null, depth: state.depth }, error: null }),
      insert: async row => { state.events.push(row); return { data: null, error: null }; },
      then(resolve) { resolve({ data: [], error: null }); } };
    return chain;
  },
};
const sources = {
  '@/lib/server/supabase-admin': 'export const getSupabaseAdminClient=()=>globalThis.__coworkEffects.client;',
  './access': 'export const requireCoworkWorkerAccess=async()=>{};',
  '@/lib/cowork/capabilities': 'export const createCoworkGateway=()=>{throw new Error("gateway unused in this suite")};',
  './save-contact': 'export const saveCoworkContact=async()=>{globalThis.__coworkEffects.executed.push("save");return {lead:{id:"lead-1",name:"Ana"},reused:false};};',
  './start-research': 'export const startCoworkResearch=async()=>{globalThis.__coworkEffects.executed.push("research");if(globalThis.__coworkEffects.failResearch)throw new Error("No se pudo preparar la investigación.");return {reportId:"rep",status:"running",reused:false};};',
  './draft-from-research': 'export const requestCoworkDraft=async()=>{globalThis.__coworkEffects.executed.push("draft");return {status:"pending",reused:false};};',
  './code-runner': 'export const executeCoworkCode=async()=>{globalThis.__coworkEffects.executed.push("code");if(globalThis.__coworkEffects.failCode)throw new Error("El código terminó con error (salida 1).\\nSalida:\\nTraceback KeyError: monto");return {reply:"ok",result:{}};};',
  './profile-update': 'export const executeCoworkProfileUpdate=async()=>{globalThis.__coworkEffects.executed.push("profile");return {reply:"ok",result:{}};};',
  './saved-search-ops': 'export const executeCoworkSavedSearchCreate=async()=>{globalThis.__coworkEffects.executed.push("saved-search");return {reply:"ok",result:{}};};export const executeCoworkSavedSearchUpdate=async()=>{globalThis.__coworkEffects.executed.push("saved-search");return {reply:"ok",result:{}};};export const executeCoworkSavedSearchDelete=async()=>{globalThis.__coworkEffects.executed.push("saved-search");return {reply:"ok",result:{}};};',
  './campaign-stop': 'export const executeCoworkCampaignStop=async()=>{globalThis.__coworkEffects.executed.push("campaign-stop");return {reply:"ok",result:{}};};',
};
globalThis.__coworkEffects = { client, executed: state.executed, failCode: false, failResearch: false };
const bundle = await build({ entryPoints: ['src/lib/server/cowork/effects.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
  plugins: [{ name: 'isolated-services', setup(build) {
    build.onResolve({ filter: /.*/ }, args => sources[args.path] ? { path: args.path, namespace: 'fixture' } : undefined);
    build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: sources[args.path] }));
  } }],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
try {
  assert.equal(await module.exports.proposeCoworkEffect(client, 'run-effect', lease,
    { kind: 'save_contact', originRunId: 'run-origin', targetId: 'apollo:abc', label: 'Guardar contacto' }), true);
  assert.equal(state.proposals.length, 1);
  assert.equal(state.proposals[0].p_kind, 'save_contact');
  assert.equal(await module.exports.resolveCoworkEffect(client, { userId: 'owner', organizationId: 'org' }, 'run-effect', true), true);
  const first = await module.exports.processCoworkEffectQueue();
  assert.deepEqual(first, { processed: 1, claimed: true });
  assert.deepEqual(state.executed, ['save']);
  assert.equal(state.finishes.length, 1);
  assert.equal(state.finishes[0].p_success, true);
  assert.ok(String(state.finishes[0].p_reply).length > 10);
  assert.equal(state.admissions.length, 1);
  assert.equal(state.admissions[0].p_parent_run_id, 'run-effect');
  // Named explicitly: with the 6- and 7-argument versions in the database, omitting it is PGRST203.
  assert.equal(state.admissions[0].p_reset_depth, false);
  const second = await module.exports.processCoworkEffectQueue();
  assert.deepEqual(second, { processed: 0, claimed: false });
  // Failed code execution records the failure and resumes the thread with the
  // observed error so the agent can propose corrected code (new review, no
  // auto-execution).
  state.kind = 'code_execute';
  globalThis.__coworkEffects.failCode = true;
  state.takes = 0;
  const failed = await module.exports.processCoworkEffectQueue();
  assert.deepEqual(failed, { processed: 0, claimed: true });
  assert.deepEqual(state.executed, ['save', 'code']);
  assert.equal(state.finishes[state.finishes.length - 1].p_success, false);
  assert.equal(state.admissions.length, 2);
  assert.equal(state.admissions[1].p_parent_run_id, 'run-effect');
  assert.match(state.admissions[1].p_message, /falló/);
  assert.match(state.admissions[1].p_message, /KeyError/);
  assert.match(state.admissions[1].p_message, /otra revisión humana/);
  // Any other failed action also resumes the thread: the person gets an
  // explanation and an alternative, never a raw error as the last word.
  state.kind = 'start_research';
  globalThis.__coworkEffects.failResearch = true;
  state.takes = 0;
  assert.deepEqual(await module.exports.processCoworkEffectQueue(), { processed: 0, claimed: true });
  assert.equal(state.finishes[state.finishes.length - 1].p_success, false);
  assert.equal(state.admissions.length, 3);
  assert.match(state.admissions[2].p_message, /no se pudo completar/);
  assert.match(state.admissions[2].p_message, /No se pudo preparar la investigación/);
  assert.match(state.admissions[2].p_message, /no vuelvas a proponer la misma acción/);
  assert.equal(state.admissions[2].p_reset_depth, false);
  // Thread budget: at max depth the chain stops gracefully with an observed event.
  state.depth = 5;
  const refused = await module.exports.admitCoworkContinuation(client,
    { userId: 'owner', organizationId: 'org' }, 'run-effect', 'Continúa');
  assert.equal(refused, null);
  assert.equal(state.admissions.length, 3);
  assert.equal(state.events.length, 1);
  assert.equal(state.events[0].kind, 'thread.budget_exhausted');
  console.log('PASS: effect propose, approval, single execution, finish, continuation (also after a failed action) and thread budget.');
} finally {
  delete globalThis.__coworkEffects;
  delete process.env.COWORK_ENABLED;
}

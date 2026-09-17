// No secrets, environment files or providers: exercises effect propose/approve/execute.
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
process.env.COWORK_ENABLED = 'true';
const state = { proposals: [], takes: 0, finishes: [], admissions: [], executed: [] };
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
    const chain = { select: () => chain, eq: () => chain,
      single: async () => table === 'cowork_runs'
        ? { data: { status: 'waiting_approval', mode: 'approval' }, error: null }
        : { data: null, error: null } };
    return chain;
  },
};
const sources = {
  '@/lib/server/supabase-admin': 'export const getSupabaseAdminClient=()=>globalThis.__coworkEffects.client;',
  './access': 'export const requireCoworkWorkerAccess=async()=>{};',
  '@/lib/cowork/capabilities': 'export const createCoworkGateway=()=>{throw new Error("gateway unused in this suite")};',
  './save-contact': 'export const saveCoworkContact=async()=>{globalThis.__coworkEffects.executed.push("save");return {lead:{id:"lead-1",name:"Ana"},reused:false};};',
  './start-research': 'export const startCoworkResearch=async()=>{globalThis.__coworkEffects.executed.push("research");return {reportId:"rep",status:"running",reused:false};};',
  './draft-from-research': 'export const requestCoworkDraft=async()=>{globalThis.__coworkEffects.executed.push("draft");return {status:"pending",reused:false};};',
};
globalThis.__coworkEffects = { client, executed: state.executed };
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
  const second = await module.exports.processCoworkEffectQueue();
  assert.deepEqual(second, { processed: 0, claimed: false });
  console.log('PASS: effect propose, approval, single execution, finish and continuation.');
} finally {
  delete globalThis.__coworkEffects;
  delete process.env.COWORK_ENABLED;
}

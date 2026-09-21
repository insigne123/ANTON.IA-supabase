// Fase 4: human-reviewed collaboration, exception triage and mission control.
// No providers, secrets or env files.
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const OWNER = '00000000-0000-4000-8000-000000000001';
const ORG = '00000000-0000-4000-8000-000000000002';
const LEAD = '00000000-0000-4000-8000-000000000003';
const MEMBER = '00000000-0000-4000-8000-000000000004';
const EXCEPTION = '00000000-0000-4000-8000-000000000005';
const MISSION = '00000000-0000-4000-8000-000000000006';
const state = {
  role: 'owner', collaborationEnabled: true,
  collaboration: { lead_id: LEAD, organization_id: ORG, assigned_to_user_id: null,
    claimed_by_user_id: null, claim_expires_at: null, contact_state: 'uncontacted', updated_at: '2026-09-21T00:00:00Z' },
  assignStaged: null, rpcCalls: [],
  exception: { id: EXCEPTION, mission_id: null, lead_id: null, title: 'Fallo de sincronización',
    status: 'open', payload: { category: 'sync' }, updated_at: '2026-09-21T00:00:00Z' },
  exceptionStaged: null, exceptionUpdated: null,
  mission: { id: MISSION, title: 'Prospección', status: 'active', updated_at: '2026-09-21T00:00:00Z' },
  missionStaged: null, missionUpdated: null, tasksCompleted: 0, logsInserted: 0,
  runStatus: 'completed',
};
globalThis.__coworkDomainEffects3 = state;

function tableHandler(table) {
  const s = globalThis.__coworkDomainEffects3;
  const chain = { _eq: [] };
  chain.select = () => chain;
  chain.eq = (column, value) => { chain._eq.push([column, value]); return chain; };
  chain.in = () => chain;
  chain.update = values => {
    if (table === 'organization_lead_collaboration') s.collaborationUpdated = values;
    if (table === 'antonia_exceptions') s.exceptionUpdated = values;
    if (table === 'antonia_missions') s.missionUpdated = values;
    if (table === 'antonia_tasks') s.tasksCompleted++;
    return chain;
  };
  chain.insert = values => { if (table === 'antonia_logs') s.logsInserted++; return chain; };
  chain.upsert = (values, options) => {
    if (table === 'cowork_crm_assign_proposals') s.assignStaged = values;
    if (table === 'cowork_exception_proposals') s.exceptionStaged = values;
    if (table === 'cowork_mission_proposals') s.missionStaged = values;
    return { ...chain, select: () => ({ ...chain, maybeSingle: async () => ({ data: null, error: null }) }) };
  };
  chain.single = async () => ({ data: null, error: null });
  chain.maybeSingle = async () => {
    if (table === 'organizations') {
      return s.collaborationEnabled
        ? { data: { collaboration_v1_enabled: true }, error: null }
        : { data: { collaboration_v1_enabled: false }, error: null };
    }
    if (table === 'leads') return { data: { id: '00000000-0000-4000-8000-000000000003' }, error: null };
    if (table === 'organization_members') {
      const wanted = chain._eq.find(([column]) => column === 'user_id')?.[1];
      if (wanted === '00000000-0000-4000-8000-000000000004') return { data: { role: 'member' }, error: null };
      if (wanted === '00000000-0000-4000-8000-000000000001') return { data: { role: s.role }, error: null };
      return { data: { user_id: wanted }, error: null };
    }
    if (table === 'organization_lead_collaboration') {
      if (s.collaborationUpdated) {
        const version = chain._eq.find(([column]) => column === 'updated_at')?.[1];
        if (version !== undefined && version !== s.collaboration.updated_at) return { data: null, error: null };
        return { data: { id: LEAD }, error: null };
      }
      return { data: s.collaboration, error: null };
    }
    if (table === 'cowork_crm_assign_proposals') {
      return s.assignStaged
        ? { data: { lead_id: s.assignStaged.lead_id, op: s.assignStaged.op,
          assigned_to_user_id: s.assignStaged.assigned_to_user_id, minutes: s.assignStaged.minutes,
          base_updated_at: s.assignStaged.base_updated_at, proposal_hash: s.assignStaged.proposal_hash }, error: null }
        : { data: null, error: null };
    }
    if (table === 'antonia_exceptions') {
      if (s.exceptionUpdated) {
        const version = chain._eq.find(([column]) => column === 'updated_at')?.[1];
        const status = chain._eq.find(([column]) => column === 'status')?.[1];
        if (version !== s.exception.updated_at || status !== 'open') return { data: null, error: null };
        return { data: { id: '00000000-0000-4000-8000-000000000005' }, error: null };
      }
      return { data: s.exception, error: null };
    }
    if (table === 'cowork_exception_proposals') {
      return s.exceptionStaged
        ? { data: { exception_id: s.exceptionStaged.exception_id, action: s.exceptionStaged.action,
          reason: s.exceptionStaged.reason, base_updated_at: s.exceptionStaged.base_updated_at,
          proposal_hash: s.exceptionStaged.proposal_hash }, error: null }
        : { data: null, error: null };
    }
    if (table === 'antonia_missions') {
      if (s.missionUpdated) {
        const version = chain._eq.find(([column]) => column === 'updated_at')?.[1];
        const status = chain._eq.find(([column]) => column === 'status')?.[1];
        if (version !== s.mission.updated_at || status !== s.mission.status) return { data: null, error: null };
        return { data: { id: '00000000-0000-4000-8000-000000000006', organization_id: '00000000-0000-4000-8000-000000000002' }, error: null };
      }
      if (chain._eq.some(([column, value]) => column === 'user_id' && value !== '00000000-0000-4000-8000-000000000001')) {
        return { data: null, error: null };
      }
      return { data: s.mission, error: null };
    }
    if (table === 'cowork_mission_proposals') {
      return s.missionStaged
        ? { data: { mission_id: s.missionStaged.mission_id, target_status: s.missionStaged.target_status,
          base_status: s.missionStaged.base_status, base_updated_at: s.missionStaged.base_updated_at,
          proposal_hash: s.missionStaged.proposal_hash }, error: null }
        : { data: null, error: null };
    }
    return { data: null, error: null };
  };
  return chain;
}

const sources = {
  '@/lib/server/supabase-admin': `export const getSupabaseAdminClient=()=>{const s=globalThis.__coworkDomainEffects3;
    return { from: table => (${tableHandler.toString()})(table),
      rpc: async (name,args) => { s.rpcCalls.push({name,args});
        if(name==='cowork_lead_collaboration_op') return { data:{ lead_id:args.p_lead_id }, error:null };
        return { data:null, error:{ message:'unexpected rpc' } }; } };};`,
  './runs': `export const getCoworkRun=async()=>({run:{status:globalThis.__coworkDomainEffects3.runStatus},events:[]});`,
  './access': 'export const requireCoworkWorkerAccess=async()=>{};',
};
const bundle = await build({ stdin: { contents: `export * from './src/lib/server/cowork/crm-assign';
  export * from './src/lib/server/cowork/exception-resolve';
  export * from './src/lib/server/cowork/mission-control';`, resolveDir: process.cwd() },
  bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
  plugins: [{ name: 'isolated-services', setup(b) {
    b.onResolve({ filter: /.*/ }, args => sources[args.path] ? { path: args.path, namespace: 'fixture' } : undefined);
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: sources[args.path] }));
  } }],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const auth = { user: { id: OWNER }, organizationId: ORG };
const scope = { userId: OWNER, organizationId: ORG };
try {
  // Assign: owner pins target and version; drift refuses; RPC applies once.
  const assign = await module.exports.stageCoworkCrmAssign(scope, 'run-1',
    { leadId: LEAD, op: 'assign', assignedToUserId: MEMBER });
  assert.match(assign.hash, /^[a-f0-9]{64}$/);
  const assigned = await module.exports.executeCoworkCrmAssign(auth, 'run-1', `crmassign:${assign.hash}`);
  assert.match(assigned.reply, /Asignado/);
  assert.equal(state.rpcCalls.length, 1);
  assert.equal(state.rpcCalls[0].args.p_op, 'assign');
  assert.equal(state.rpcCalls[0].args.p_actor_user_id, OWNER);
  state.collaboration.updated_at = '2026-09-21T01:00:00Z';
  await assert.rejects(module.exports.executeCoworkCrmAssign(auth, 'run-1', `crmassign:${assign.hash}`), /cambió/);
  state.collaboration.updated_at = '2026-09-21T00:00:00Z';

  // Member matrix: cannot assign others, cannot take assigned leads, cannot free foreign claims.
  state.role = 'member';
  await assert.rejects(module.exports.stageCoworkCrmAssign(scope, 'run-1',
    { leadId: LEAD, op: 'assign', assignedToUserId: MEMBER }), /reservarlo para ti|no permite asignar/);
  state.collaboration.assigned_to_user_id = MEMBER;
  await assert.rejects(module.exports.stageCoworkCrmAssign(scope, 'run-1', { leadId: LEAD, op: 'claim' }), /no se puede reservar/);
  state.collaboration.assigned_to_user_id = null;
  state.collaboration.claimed_by_user_id = MEMBER;
  state.collaboration.claim_expires_at = new Date(Date.now() + 600000).toISOString();
  await assert.rejects(module.exports.stageCoworkCrmAssign(scope, 'run-1', { leadId: LEAD, op: 'release' }), /no es tuya/);
  state.collaboration.claimed_by_user_id = null;
  state.collaboration.claim_expires_at = null;
  const claim = await module.exports.stageCoworkCrmAssign(scope, 'run-1', { leadId: LEAD, op: 'claim', minutes: 20 });
  const claimed = await module.exports.executeCoworkCrmAssign(auth, 'run-1', `crmassign:${claim.hash}`);
  assert.match(claimed.reply, /Reservado/);
  assert.equal(state.rpcCalls.at(-1).args.p_minutes, 20);
  state.role = 'owner';

  // Exception: only open ones move, with reason; drift refuses.
  const triage = await module.exports.stageCoworkExceptionResolve(scope, 'run-1',
    { exceptionId: EXCEPTION, action: 'resolved', reason: 'Sincronización reintentada y confirmada' });
  assert.match(triage.hash, /^[a-f0-9]{64}$/);
  const resolved = await module.exports.executeCoworkExceptionResolve(auth, 'run-1', `exception:${triage.hash}`);
  assert.match(resolved.reply, /resolved/);
  assert.equal(state.exceptionUpdated.status, 'resolved');
  assert.equal(state.exceptionUpdated.payload.resolution.reason, 'Sincronización reintentada y confirmada');
  state.exceptionUpdated = null;
  state.exception.status = 'resolved';
  await assert.rejects(module.exports.executeCoworkExceptionResolve(auth, 'run-1', `exception:${triage.hash}`), /cambió/);
  state.exception.status = 'open';
  await assert.rejects(module.exports.stageCoworkExceptionResolve(scope, 'run-1',
    { exceptionId: EXCEPTION, action: 'resolved', reason: 'x' }), /3/);

  // Mission: own active missions pause with side effects; drift and foreign rows refuse.
  const pause = await module.exports.stageCoworkMissionControl(scope, 'run-1', { missionId: MISSION, targetStatus: 'paused' });
  assert.match(pause.hash, /^[a-f0-9]{64}$/);
  const paused = await module.exports.executeCoworkMissionControl(auth, 'run-1', `mission:${pause.hash}`);
  assert.match(paused.reply, /pausada/);
  assert.equal(state.missionUpdated.status, 'paused');
  assert.equal(state.tasksCompleted, 1);
  assert.equal(state.logsInserted, 1);
  state.missionUpdated = null;
  state.mission.updated_at = '2026-09-21T01:00:00Z';
  await assert.rejects(module.exports.executeCoworkMissionControl(auth, 'run-1', `mission:${pause.hash}`), /cambió/);
  state.mission.updated_at = '2026-09-21T00:00:00Z';
  state.mission.status = 'paused';
  await assert.rejects(module.exports.stageCoworkMissionControl(scope, 'run-1', { missionId: MISSION, targetStatus: 'paused' }), /ya está pausada/);
  state.mission.status = 'active';

  console.log('PASS: staged collaboration, exception triage and mission control with role matrix, drift refusal and confirmed writes.');
} finally {
  delete globalThis.__coworkDomainEffects3;
}

// Fase 4: human-reviewed CRM record and v2 draft preparation effects.
// No providers, secrets or env files.
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const OWNER = '00000000-0000-4000-8000-000000000001';
const ORG = '00000000-0000-4000-8000-000000000002';
const GID = 'lead_saved|00000000-0000-4000-8000-000000000003';
const STEP = '00000000-0000-4000-8000-000000000004';
const state = {
  unifiedRow: { id: GID, stage: 'inbox', owner: null, notes: null, next_action: null,
    next_action_type: null, next_action_due_at: null, meeting_link: null, updated_at: '2026-09-21T00:00:00Z' },
  crmStaged: null, crmUpdated: null, crmInserted: null, unifiedConflict: false,
  prepStaged: null, prepareCalls: [],
  stepState: 'ready', stepDraft: null,
  runStatus: 'completed',
};
globalThis.__coworkDomainEffects2 = state;

function tableHandler(table) {
  const s = globalThis.__coworkDomainEffects2;
  const chain = { _eq: [] };
  chain.select = () => chain;
  chain.eq = (column, value) => { chain._eq.push([column, value]); return chain; };
  chain.order = () => chain;
  chain.limit = () => chain;
  chain.update = values => { if (table === 'unified_crm_data') s.crmUpdated = values; return chain; };
  chain.insert = values => { if (table === 'unified_crm_data') s.crmInserted = values; return chain; };
  chain.upsert = (values, options) => {
    if (table === 'cowork_crm_record_proposals') s.crmStaged = values;
    if (table === 'cowork_campaign_prepare_proposals') s.prepStaged = values;
    return { ...chain, select: () => ({ ...chain, maybeSingle: async () => ({ data: null, error: null }) }) };
  };
  chain.maybeSingle = async () => {
    if (table === 'unified_crm_data') {
      if (s.crmUpdated) {
        const version = chain._eq.find(([column]) => column === 'updated_at')?.[1];
        if (version !== s.unifiedRow?.updated_at) return { data: null, error: null };
        return { data: { id: 'lead_saved|00000000-0000-4000-8000-000000000003' }, error: null };
      }
      if (s.crmInserted) {
        if (s.unifiedConflict || s.unifiedRow) return { data: null, error: { message: 'duplicate' } };
        return { data: { id: 'lead_saved|00000000-0000-4000-8000-000000000003' }, error: null };
      }
      return { data: s.unifiedRow, error: null };
    }
    if (table === 'cowork_crm_record_proposals') {
      return s.crmStaged
        ? { data: { gid: s.crmStaged.gid, patch: s.crmStaged.patch,
          base_updated_at: s.crmStaged.base_updated_at, proposal_hash: s.crmStaged.proposal_hash }, error: null }
        : { data: null, error: null };
    }
    if (table === 'cowork_campaign_prepare_proposals') {
      return s.prepStaged
        ? { data: { step_id: s.prepStaged.step_id, base_state: s.prepStaged.base_state,
          proposal_hash: s.prepStaged.proposal_hash }, error: null }
        : { data: null, error: null };
    }
    return { data: null, error: null };
  };
  return chain;
}

const sources = {
  '@/lib/server/supabase-admin': `export const getSupabaseAdminClient=()=>{const s=globalThis.__coworkDomainEffects2;
    return { from: table => (${tableHandler.toString()})(table) };};`,
  './runs': `export const getCoworkRun=async()=>({run:{status:globalThis.__coworkDomainEffects2.runStatus},events:[]});`,
  './access': 'export const requireCoworkWorkerAccess=async()=>{};',
  '@/lib/server/campaigns-v2/send-context': `export const getCampaignV2RecipientStepSendContext=async()=>{const s=globalThis.__coworkDomainEffects2;
    return { stepId:'${STEP}', state:s.stepState, nativeDraftId:s.stepDraft };};`,
  '@/lib/server/campaigns-v2/prepare-draft': `export const prepareCampaignV2Draft=async input=>{const s=globalThis.__coworkDomainEffects2;
    s.prepareCalls.push(input);
    return { draft:{ draftId:'00000000-0000-4000-8000-000000000005', versionId:'00000000-0000-4000-8000-000000000006' }, composeUrl:'/contact/compose?draftId=x' };};`,
};
const bundle = await build({ stdin: { contents: `export * from './src/lib/server/cowork/crm-record-update';
  export * from './src/lib/server/cowork/campaign-prepare';`, resolveDir: process.cwd() },
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
  // CRM record: stage pins exact fields; drift refuses; approval applies once.
  const staged = await module.exports.stageCoworkCrmRecordUpdate(scope, 'run-1',
    { gid: GID, stage: 'engaged', nextAction: 'Llamar el lunes' });
  assert.match(staged.hash, /^[a-f0-9]{64}$/);
  assert.deepEqual(staged.changed, ['stage', 'nextAction']);
  assert.equal(state.crmStaged.patch.next_action, 'Llamar el lunes');
  await assert.rejects(module.exports.stageCoworkCrmRecordUpdate(scope, 'run-1', { gid: GID }), /ningún campo/);
  await assert.rejects(module.exports.stageCoworkCrmRecordUpdate(scope, 'run-1', { gid: 'ficha-sin-origen', stage: 'engaged' }), /observarse/);
  await assert.rejects(module.exports.stageCoworkCrmRecordUpdate(scope, 'run-1', { gid: GID, nextActionDueAt: 'no es fecha' }), /fecha válida/);
  const done = await module.exports.executeCoworkCrmRecordUpdate(auth, 'run-1', `crmrecord:${staged.hash}`);
  assert.match(done.reply, /ficha comercial/);
  assert.equal(done.result.gid, GID);
  assert.equal(state.crmUpdated.next_action, 'Llamar el lunes');
  state.unifiedRow.updated_at = '2026-09-21T01:00:00Z';
  await assert.rejects(module.exports.executeCoworkCrmRecordUpdate(auth, 'run-1', `crmrecord:${staged.hash}`), /cambió/);
  state.unifiedRow.updated_at = '2026-09-21T00:00:00Z';

  // CRM record without a prior row: creates once, refuses when a row appears.
  state.unifiedRow = null; state.crmUpdated = null; state.crmInserted = null;
  const created = await module.exports.stageCoworkCrmRecordUpdate(scope, 'run-2', { gid: GID, owner: 'Ana' });
  assert.equal(state.crmStaged.base_updated_at, null);
  const made = await module.exports.executeCoworkCrmRecordUpdate(auth, 'run-2', `crmrecord:${created.hash}`);
  assert.equal(made.result.gid, GID);
  assert.equal(state.crmInserted.owner, 'Ana');
  state.unifiedRow = { id: GID, updated_at: '2026-09-21T02:00:00Z' };
  state.crmInserted = null;
  await assert.rejects(module.exports.executeCoworkCrmRecordUpdate(auth, 'run-2', `crmrecord:${created.hash}`), /cambió/);
  state.unifiedRow = { id: GID, stage: 'inbox', owner: null, notes: null, next_action: null,
    next_action_type: null, next_action_due_at: null, meeting_link: null, updated_at: '2026-09-21T00:00:00Z' };

  // Campaign prepare: pins step state; refuses drafts and drift; prepares once.
  const prep = await module.exports.stageCoworkCampaignPrepare(scope, 'run-1', STEP);
  assert.match(prep.hash, /^[a-f0-9]{64}$/);
  const ready = await module.exports.executeCoworkCampaignPrepare(auth, 'run-1', `campaignprep:${prep.hash}`);
  assert.match(ready.reply, /revisión/);
  assert.equal(state.prepareCalls.length, 1);
  assert.equal(state.prepareCalls[0].stepId, STEP);
  state.stepDraft = '00000000-0000-4000-8000-000000000005';
  await assert.rejects(module.exports.executeCoworkCampaignPrepare(auth, 'run-1', `campaignprep:${prep.hash}`), /cambió/);
  await assert.rejects(module.exports.stageCoworkCampaignPrepare(scope, 'run-1', STEP), /borrador/);
  state.stepDraft = null;
  await assert.rejects(module.exports.executeCoworkCampaignPrepare(auth, 'run-1', 'campaignprep:bad'), /válida/);

  console.log('PASS: staged CRM record and v2 draft preparation, ownership, drift refusal and confirmed writes.');
} finally {
  delete globalThis.__coworkDomainEffects2;
}

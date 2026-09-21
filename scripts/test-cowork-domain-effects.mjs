// Fase 4: human-reviewed domain effects. No providers, secrets or env files.
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const OWNER = '00000000-0000-4000-8000-000000000001';
const ORG = '00000000-0000-4000-8000-000000000002';
const SEARCH = '00000000-0000-4000-8000-000000000003';
const state = {
  profile: { id: OWNER, full_name: 'Ana', job_title: 'Rep', company_name: 'Acme',
    company_domain: 'acme.com', signatures: {}, updated_at: '2026-09-21T00:00:00Z' },
  profileStaged: null, profileUpdated: null,
  searches: [{ id: SEARCH, user_id: OWNER, organization_id: ORG, name: 'Gerentes',
    criteria: {}, is_shared: false, updated_at: '2026-09-21T00:00:00Z' }],
  searchStaged: null, searchInserted: null, searchUpdated: null, searchDeleted: null,
  runStatus: 'completed',
  stopCalls: [],
};
globalThis.__coworkDomainEffects = state;

function tableHandler(table) {
  const s = globalThis.__coworkDomainEffects;
  const chain = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.order = () => chain;
  chain.limit = () => chain;
  chain.update = values => { s.profileUpdated = values; return chain; };
  chain.insert = values => { s.searchInserted = values; return chain; };
  chain.delete = () => { chain._deleted = true; return chain; };
  chain.single = async () => ({ data: s.searchInserted ? { id: '00000000-0000-4000-8000-000000000003', name: s.searchInserted.name } : null, error: null });
  chain.upsert = (values, options) => {
    if (table === 'cowork_profile_proposals') s.profileStaged = values;
    if (table === 'cowork_saved_search_proposals') s.searchStaged = values;
    return { ...chain, select: () => ({ ...chain, maybeSingle: async () => ({ data: null, error: null }) }) };
  };
  const listRows = () => {
    if (table === 'saved_searches') return s.searchDeleted ? [] : s.searches.map(row => ({ id: row.id, name: row.name }));
    return [];
  };
  chain.then = (resolve, reject) => Promise.resolve({ data: listRows(), error: null }).then(resolve, reject);
  chain.maybeSingle = async () => {
    if (table === 'profiles') return { data: s.profile, error: null };
    if (table === 'saved_searches') {
      if (s.searchDeleted) return { data: null, error: null };
      if (chain._deleted) { s.searchDeleted = true; return { data: s.searches[0], error: null }; }
      return { data: s.searches[0], error: null };
    }
    if (table === 'cowork_profile_proposals') {
      return s.profileStaged
        ? { data: { patch: s.profileStaged.patch, base_updated_at: s.profileStaged.base_updated_at, patch_hash: s.profileStaged.patch_hash }, error: null }
        : { data: null, error: null };
    }
    if (table === 'cowork_saved_search_proposals') {
      const st = s.searchStaged;
      return st ? { data: { op: st.op, search_id: st.search_id, name: st.name, criteria: st.criteria,
        is_shared: st.is_shared, base_updated_at: st.base_updated_at, proposal_hash: st.proposal_hash }, error: null }
        : { data: null, error: null };
    }
    return { data: null, error: null };
  };
  return chain;
}

const sources = {
  '@/lib/server/supabase-admin': `export const getSupabaseAdminClient=()=>{const s=globalThis.__coworkDomainEffects;
    return { from: table => (${tableHandler.toString()})(table) };};`,
  './runs': `export const getCoworkRun=async()=>({run:{status:globalThis.__coworkDomainEffects.runStatus},events:[]});`,
  './access': 'export const requireCoworkWorkerAccess=async()=>{};',
  '@/lib/server/campaigns-v2/stop': `export const stopCampaignV2Enrollment=async input=>{globalThis.__coworkDomainEffects.stopCalls.push(input);
    if(input.campaignId!=='${'00000000-0000-4000-8000-000000000010'}')throw new Error('foreign campaign');
    return {id:input.enrollmentId,campaignId:input.campaignId,status:'stopped',stoppedAt:'t',recipientName:'Ana',recipientEmail:'ana@example.com'};};`,
};
const bundle = await build({ stdin: { contents: `export * from './src/lib/server/cowork/profile-update';
  export * from './src/lib/server/cowork/saved-search-ops';
  export * from './src/lib/server/cowork/campaign-stop';`, resolveDir: process.cwd() },
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
  // Profile: stage pins exact values; drift refuses; approval applies once.
  const patch = { companyName: 'Acme Corp' };
  const staged = await module.exports.stageCoworkProfileUpdate(scope, 'run-1', patch);
  assert.deepEqual(staged.changed, ['company_name', 'signatures']);
  assert.match(staged.hash, /^[a-f0-9]{64}$/);
  assert.equal(state.profileStaged.patch.company_name, 'Acme Corp');
  await assert.rejects(module.exports.stageCoworkProfileUpdate(scope, 'run-1', {}), /ningún campo/);
  await assert.rejects(module.exports.stageCoworkProfileUpdate(scope, 'run-1', { website: 'not a domain' }), /dominio/);
  state.profile.signatures = { profile_extended: { role: 'Rep', sector: '', description: '', services: '', valueProposition: '', proofPoints: [] } };
  const noChange = await module.exports.stageCoworkProfileUpdate(scope, 'run-1', { name: 'Ana' })
    .then(() => 'staged', () => 'refused');
  assert.equal(noChange, 'refused');
  state.profile.signatures = {};
  const done = await module.exports.executeCoworkProfileUpdate(auth, 'run-1', `profile:${staged.hash}`);
  assert.match(done.reply, /perfil comercial/);
  assert.equal(state.profileUpdated.company_name, 'Acme Corp');
  state.profile.updated_at = '2026-09-21T01:00:00Z';
  await assert.rejects(module.exports.executeCoworkProfileUpdate(auth, 'run-1', `profile:${staged.hash}`), /cambió/);
  state.profile.updated_at = '2026-09-21T00:00:00Z';

  // Signature is sanitized before review, pins one channel and preserves the other.
  state.profile.signatures = { outlook: { enabled: true, html: '<p>Outlook original</p>' } };
  const signature = await module.exports.stageCoworkProfileUpdate(scope, 'signature-run', {
    signature: { channel: 'gmail', html: '<p onclick="bad()"><b>Ana</b></p><img src="https://tracker.example/x">', enabled: true },
  });
  assert.equal(state.profileStaged.patch.signatures.gmail.html, '<p><b>Ana</b></p>');
  assert.equal(state.profileStaged.patch.signatures.outlook.html, '<p>Outlook original</p>');
  await module.exports.executeCoworkProfileUpdate(auth, 'signature-run', `profile:${signature.hash}`);
  assert.equal(state.profileUpdated.signatures.gmail.text, 'Ana');
  await assert.rejects(module.exports.stageCoworkProfileUpdate(scope, 'signature-run', {
    signature: { channel: 'gmail', html: '<script>bad()</script>', enabled: true },
  }), /texto visible/);

  // Saved search create: duplicate names refuse before and at execution.
  const created = await module.exports.stageCoworkSavedSearchCreate(scope, 'run-1',
    { name: 'Directores', criteria: { title: 'Director' }, isShared: false });
  assert.match(created.hash, /^[a-f0-9]{64}$/);
  await assert.rejects(module.exports.stageCoworkSavedSearchCreate(scope, 'run-1',
    { name: 'gerentes', criteria: {}, isShared: false }), /Ya tienes/);
  const made = await module.exports.executeCoworkSavedSearchCreate(auth, 'run-1', `savedsearch:create:${created.hash}`);
  assert.equal(made.result.searchId, SEARCH);
  assert.equal(state.searchInserted.user_id, OWNER);

  // Saved search update: owned row, optimistic concurrency, rename conflict.
  const updated = await module.exports.stageCoworkSavedSearchUpdate(scope, 'run-1', { id: SEARCH, name: 'Gerentas' });
  assert.match(updated.hash, /^[a-f0-9]{64}$/);
  const applied = await module.exports.executeCoworkSavedSearchUpdate(auth, 'run-1', `savedsearch:update:${updated.hash}`);
  assert.equal(applied.result.searchId, SEARCH);
  state.searches[0].updated_at = '2026-09-21T02:00:00Z';
  await assert.rejects(module.exports.executeCoworkSavedSearchUpdate(auth, 'run-1', `savedsearch:update:${updated.hash}`), /cambió/);
  state.searches[0].updated_at = '2026-09-21T00:00:00Z';

  // Saved search delete: owned row only, confirmed removal.
  const deletion = await module.exports.stageCoworkSavedSearchDelete(scope, 'run-1', { id: SEARCH });
  state.searches[0].updated_at = '2026-09-21T03:00:00Z';
  await assert.rejects(module.exports.executeCoworkSavedSearchDelete(auth, 'run-1', `savedsearch:delete:${deletion.hash}`), /cambió/);
  assert.equal(state.searchDeleted, null);
  state.searches[0].updated_at = '2026-09-21T00:00:00Z';
  await assert.rejects(module.exports.executeCoworkSavedSearchDelete(auth, 'run-1', `savedsearch:delete:${SEARCH}`), /válida/);
  const removed = await module.exports.executeCoworkSavedSearchDelete(auth, 'run-1', `savedsearch:delete:${deletion.hash}`);
  assert.equal(removed.result.searchId, SEARCH);
  await assert.rejects(module.exports.executeCoworkSavedSearchDelete(auth, 'run-1', `savedsearch:delete:${deletion.hash}`), /disponible/);

  // Campaign stop: observed enrollment stops through the native service.
  const stopped = await module.exports.executeCoworkCampaignStop(auth, 'run-1',
    'campaign-stop:00000000-0000-4000-8000-000000000010:00000000-0000-4000-8000-000000000011');
  assert.equal(stopped.result.status, 'stopped');
  assert.equal(state.stopCalls.length, 1);
  assert.equal(state.stopCalls[0].organizationId, ORG);
  await assert.rejects(module.exports.executeCoworkCampaignStop(auth, 'run-1', 'campaign-stop:bad'), /válida/);

  console.log('PASS: staged profile/saved-search/campaign-stop execution, ownership, drift refusal and confirmed writes.');
} finally {
  delete globalThis.__coworkDomainEffects;
}

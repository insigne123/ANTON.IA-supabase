// Fase 2D: campaign effects. No providers, secrets or env files.
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

process.env.BULK_CAMPAIGNS_ENABLED = 'true';
const CAMPAIGN = '00000000-0000-4000-8000-000000000010';
const definition = {
  name: 'Reactivación', objective: 'Retomar',
  criteria: { relationship: 'never_contacted', titles: [], industries: [], countries: [], sizes: [], seniorities: [], minimumDaysSinceSent: 0, excludeReplied: true, enrichedOnly: true },
  emails: ['ana@example.com'], messages: [{ subject: 'Hola', body: 'Te escribo', delayDays: 0 }],
  provider: 'google',
};
const state = {
  staged: null, saved: [], reviewed: [],
  audience: [{ email: 'ana@example.com', blockedReason: null }],
  campaign: { id: CAMPAIGN, revision: 2, review_hash: 'a'.repeat(64), status: 'draft', definition: { name: 'Reactivación' }, recipients: [{}, {}] },
};
globalThis.__coworkCampaigns = state;

const sources = {
  '@/lib/server/supabase-admin': `export const getSupabaseAdminClient=()=>{const s=globalThis.__coworkCampaigns;
    const chain={select:()=>chain,eq:()=>chain,
    upsert:values=>{s.staged=values;return chain;},
    maybeSingle:async()=>({data:s.staged?{definition:s.staged.definition}:null,error:null})};
    return{from:()=>chain};};`,
  './runs': `export const getCoworkRun=async()=>({run:{status:'completed'},events:[]});`,
  './access': 'export const requireCoworkWorkerAccess=async()=>{};',
  '@/lib/server/bulk-campaign-audience': 'export const loadAudience=async auth=>{if(!auth.supabase)throw new Error("missing scoped client");return globalThis.__coworkCampaigns.audience;};',
  '@/lib/server/bulk-campaigns': `export const saveBulkCampaign=async(auth,input)=>{globalThis.__coworkCampaigns.saved.push(input);return{id:"${CAMPAIGN}",definition:input,status:"draft"};};
    export const getBulkCampaign=async()=>globalThis.__coworkCampaigns.campaign;
    export const reviewBulkCampaign=async(auth,id,input)=>{const s=globalThis.__coworkCampaigns;
    if(input.revision!==s.campaign.revision||input.reviewHash!==s.campaign.review_hash)throw new Error("La campaña cambió. Revisa la nueva versión antes de aprobar.");
    s.reviewed.push({id,input});return{id,status:input.action==="approve"?"approved":"paused"};};`,
};
const bundle = await build({ entryPoints: ['src/lib/server/cowork/campaign-ops.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
  plugins: [{ name: 'isolated-services', setup(b) {
    b.onResolve({ filter: /.*/ }, args => sources[args.path] ? { path: args.path, namespace: 'fixture' } : undefined);
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: sources[args.path] }));
  } }],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const auth = { user: { id: 'owner' }, organizationId: 'org', supabase: {} };
const scope = { userId: 'owner', organizationId: 'org' };
try {
  // 1. Blocked recipients refuse before staging anything.
  state.audience = [{ email: 'ana@example.com', blockedReason: 'unsubscribed' }];
  await assert.rejects(module.exports.stageCoworkCampaignDefinition(scope, 'run-1', definition), /ya no está disponible/);
  assert.equal(state.staged, null);

  // 2. Verified audience stages the full definition.
  state.audience = [{ email: 'ana@example.com', blockedReason: null }];
  const staged = await module.exports.stageCoworkCampaignDefinition(scope, 'run-1', definition);
  assert.equal(staged.recipients, 1);
  assert.ok(state.staged);
  assert.equal(state.staged.definition.emails.length, 1);

  // 3. Create lands paused as a draft through the shared service.
  const created = await module.exports.createCoworkCampaign(auth, 'run-1');
  assert.equal(created.status, 'draft');
  assert.equal(state.saved.length, 1);
  assert.equal(state.saved[0].name, 'Reactivación');

  // 4. Activate with matching review executes; stale review refuses untouched.
  const target = `${CAMPAIGN}:2:${'a'.repeat(64)}`;
  const activated = await module.exports.reviewCoworkCampaign(auth, 'run-1', target, 'approve');
  assert.equal(activated.status, 'approved');
  assert.equal(state.reviewed.length, 1);
  await assert.rejects(module.exports.reviewCoworkCampaign(auth, 'run-1', `${CAMPAIGN}:1:${'b'.repeat(64)}`, 'approve'), /cambió/);
  assert.equal(state.reviewed.length, 1);

  // 5. Disabled campaigns fail closed.
  delete process.env.BULK_CAMPAIGNS_ENABLED;
  await assert.rejects(module.exports.createCoworkCampaign(auth, 'run-1'), /no están habilitadas/);

  console.log('PASS: audience verification, staged draft, draft-only creation, hash-bound review, disabled gate.');
} finally {
  delete globalThis.__coworkCampaigns;
  delete process.env.BULK_CAMPAIGNS_ENABLED;
}

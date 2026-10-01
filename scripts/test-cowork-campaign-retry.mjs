// Retrying the failed sends of a campaign: staging, the approval card and the approved retry, over in-memory stand-ins of the tables, the
// reads and the retry function of the database. No database, mailbox, provider, secret or env file: nothing is ever sent or retried for real.
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const RUN = '00000000-0000-4000-8000-000000000041';
const USER = '00000000-0000-4000-8000-0000000000aa';
const ORG = '00000000-0000-4000-8000-0000000000bb';
const CAMPAIGN = '00000000-0000-4000-8000-000000000051';
const draft = n => `00000000-0000-4000-8000-0000000000d${n}`;
const touch = (n, overrides = {}) => ({ draftId: draft(n), email: `persona${n}@empresa.cl`, touchNumber: 1, status: 'failed', error: 'cuota diaria', reason: 'daily_quota', ...overrides });

const state = {
  runStatus: 'waiting_approval', proposal: { status: 'executing', kind: 'campaign_retry', target_id: '' }, access: true,
  listing: { campaignId: CAMPAIGN, name: 'Prospección RR. HH.', touches: [touch(1), touch(2), touch(3)] }, listingThrows: false,
  rpc: [], rpcErrors: {},
};
globalThis.__retryTest = state;
const flag = process.env.COWORK_CAMPAIGN_RETRY_ENABLED;

const sources = {
  '@/lib/server/supabase-admin': `export const getSupabaseAdminClient=()=>{const s=globalThis.__retryTest;
    const table=name=>{const b={select:()=>b,eq:()=>b,maybeSingle:async()=>{
      if(name==="cowork_runs")return{data:{status:s.runStatus},error:null};
      if(name==="cowork_effect_proposals")return{data:s.proposal,error:null};
      return{data:null,error:null};}};return b;};
    return{from:table,rpc:async(fn,args)=>{s.rpc.push({fn,args});const e=s.rpcErrors[args.p_draft_id];return{data:null,error:e?{message:e}:null};}};};`,
  './access': 'export const requireCoworkWorkerAccess=async()=>{if(!globalThis.__retryTest.access)throw new Error("denied");};',
  './runs': 'export const getCoworkRun=async()=>({run:{status:globalThis.__retryTest.runStatus},events:[]});',
  './batch-reads': 'export const listCoworkRetryableTouches=async()=>{const s=globalThis.__retryTest;if(s.listingThrows)throw new Error("La campaña no está disponible en tu organización.");return JSON.parse(JSON.stringify(s.listing));};',
};
const externals = new RegExp(`^(${Object.keys(sources).map(key => key.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('|')})$`);
const result = await build({
  entryPoints: ['src/lib/server/cowork/campaign-retry.ts'],
  bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
  plugins: [{ name: 'isolated-retry-dependencies', setup(build) {
    build.onResolve({ filter: externals }, args => ({ path: args.path, namespace: 'fixture' }));
    build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: sources[args.path], loader: 'js' }));
  } }],
});
const loaded = { exports: {} };
new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, loaded, loaded.exports);
const { stageCoworkCampaignRetry, readCoworkCampaignRetryPreview, executeCoworkCampaignRetry } = loaded.exports;
const scope = { userId: USER, organizationId: ORG };
const auth = { user: { id: USER }, organizationId: ORG };
const reset = () => {
  state.runStatus = 'waiting_approval'; state.access = true; state.listingThrows = false; state.rpc = []; state.rpcErrors = {};
  state.listing = { campaignId: CAMPAIGN, name: 'Prospección RR. HH.', touches: [touch(1), touch(2), touch(3)] };
  process.env.COWORK_CAMPAIGN_RETRY_ENABLED = 'true';
};
const refuse = async (promise, pattern) => assert.rejects(promise, pattern);

try {
  // 1. Staging lists what can be retried now and pins it; it writes and retries nothing.
  reset();
  state.runStatus = 'running';
  const staged = await stageCoworkCampaignRetry(scope, RUN, CAMPAIGN);
  assert.equal(staged.count, 3);
  assert.match(staged.label, /^Reintentar 3 envíos fallidos de «Prospección RR\. HH\.»$/);
  assert.match(staged.targetId, new RegExp(`^campaignretry:${CAMPAIGN}:[a-f0-9]{64}$`));
  assert.equal(state.rpc.length, 0, 'staging retries nothing');
  state.listing.touches = [touch(1)];
  assert.match((await stageCoworkCampaignRetry(scope, RUN, CAMPAIGN)).label, /^Reintentar 1 envío fallido de /);
  state.listing.touches = [];
  await refuse(stageCoworkCampaignRetry(scope, RUN, CAMPAIGN), /No hay envíos de esa campaña que se puedan reintentar ahora/);
  state.listing.touches = Array.from({ length: 51 }, (_, index) => touch(index + 1, { draftId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}` }));
  await refuse(stageCoworkCampaignRetry(scope, RUN, CAMPAIGN), /más de 50 envíos/);
  state.listing.touches = [touch(1)];
  state.runStatus = 'completed';
  await refuse(stageCoworkCampaignRetry(scope, RUN, CAMPAIGN), /ya no admite propuestas/);
  state.runStatus = 'running';
  state.listingThrows = true;
  await refuse(stageCoworkCampaignRetry(scope, RUN, CAMPAIGN), /no está disponible en tu organización/);
  await refuse(stageCoworkCampaignRetry(scope, RUN, 'no-es-un-uuid'), /uuid|Invalid/i);
  state.access = false;
  state.listingThrows = false;
  await refuse(stageCoworkCampaignRetry(scope, RUN, CAMPAIGN), /denied/);

  // 2. The card: the list as it is now, and whether it is still the proposed one.
  reset();
  state.runStatus = 'running';
  const proposed = await stageCoworkCampaignRetry(scope, RUN, CAMPAIGN);
  state.runStatus = 'waiting_approval';
  const preview = await readCoworkCampaignRetryPreview(auth, RUN, proposed.targetId);
  assert.deepEqual([preview.campaignName, preview.count, preview.matches, preview.unavailable], ['Prospección RR. HH.', 3, true, null]);
  assert.deepEqual(preview.items.map(item => item.email), ['persona1@empresa.cl', 'persona2@empresa.cl', 'persona3@empresa.cl']);
  state.listing.touches.push(touch(4));
  const changed = await readCoworkCampaignRetryPreview(auth, RUN, proposed.targetId);
  assert.equal(changed.matches, false, 'a new failure after the proposal is not part of what was approved');
  assert.match(changed.unavailable, /cambió desde la propuesta/);
  state.listing.touches.pop();
  assert.equal(await readCoworkCampaignRetryPreview(auth, RUN, 'campaignretry:nope'), null, 'a target that is not a retry has no card');
  state.listingThrows = true;
  assert.equal(await readCoworkCampaignRetryPreview(auth, RUN, proposed.targetId), null, 'a campaign that is not the person\'s has no card');
  state.listingThrows = false;

  // 3. Execution. The flag is the switch that stops a retry already approved.
  reset();
  state.runStatus = 'running';
  const approved = await stageCoworkCampaignRetry(scope, RUN, CAMPAIGN);
  state.runStatus = 'waiting_approval';
  state.proposal = { status: 'executing', kind: 'campaign_retry', target_id: approved.targetId };
  delete process.env.COWORK_CAMPAIGN_RETRY_ENABLED;
  await refuse(executeCoworkCampaignRetry(auth, RUN, approved.targetId), /desactivado por ahora: no se reintentó nada/);
  assert.equal(state.rpc.length, 0);
  process.env.COWORK_CAMPAIGN_RETRY_ENABLED = 'true';
  // Another target, an authorization that is no longer in force, and a list that changed are refused before anything is retried.
  await refuse(executeCoworkCampaignRetry(auth, RUN, 'campaignretry:x'), /no es válida/);
  state.proposal = { status: 'proposed', kind: 'campaign_retry', target_id: approved.targetId };
  await refuse(executeCoworkCampaignRetry(auth, RUN, approved.targetId), /autorización del reintento ya no está vigente/);
  state.proposal = { status: 'executing', kind: 'reply_thread', target_id: approved.targetId };
  await refuse(executeCoworkCampaignRetry(auth, RUN, approved.targetId), /autorización del reintento ya no está vigente/);
  state.proposal = { status: 'executing', kind: 'campaign_retry', target_id: `campaignretry:${CAMPAIGN}:${'f'.repeat(64)}` };
  await refuse(executeCoworkCampaignRetry(auth, RUN, approved.targetId), /autorización del reintento ya no está vigente/);
  state.proposal = { status: 'executing', kind: 'campaign_retry', target_id: approved.targetId };
  state.runStatus = 'completed';
  await refuse(executeCoworkCampaignRetry(auth, RUN, approved.targetId), /ya no está disponible en este trabajo|ya no está vigente/);
  state.runStatus = 'waiting_approval';
  state.listing.touches.push(touch(4));
  await refuse(executeCoworkCampaignRetry(auth, RUN, approved.targetId), /cambió desde tu revisión. No se reintentó nada/);
  state.listing.touches.pop();
  assert.equal(state.rpc.length, 0, 'nothing was retried by any refusal');

  // The approved retry: one call per draft, for the person and organization of the run, and it says what happened.
  const done = await executeCoworkCampaignRetry(auth, RUN, approved.targetId);
  assert.equal(state.rpc.length, 3);
  assert.ok(state.rpc.every(call => call.fn === 'retry_bulk_campaign_attempt_v1' && call.args.p_campaign_id === CAMPAIGN && call.args.p_user_id === USER && call.args.p_organization_id === ORG));
  assert.deepEqual(state.rpc.map(call => call.args.p_draft_id), [draft(1), draft(2), draft(3)]);
  assert.match(done.reply, /Dejé 3 envíos en la cola para reintentarse/);
  assert.match(done.reply, /ninguno se envía dos veces/);
  assert.deepEqual([done.result.retried, done.result.refused], [3, 0]);

  // One attempt the database refuses does not stop the others, and the reply names it without the database's words.
  state.rpc = [];
  state.rpcErrors[draft(2)] = 'BULK_CAMPAIGN_ATTEMPT_NOT_RETRYABLE: estado terminal';
  state.rpcErrors[draft(3)] = 'connection reset by peer';
  const partial = await executeCoworkCampaignRetry(auth, RUN, approved.targetId);
  assert.equal(state.rpc.length, 3, 'every draft is tried');
  assert.deepEqual([partial.result.retried, partial.result.refused], [1, 2]);
  assert.match(partial.reply, /Dejé 1 envío en la cola/);
  assert.match(partial.reply, /2 no se pudieron reintentar \(persona2@empresa\.cl: necesita revisión y no se puede reintentar; persona3@empresa\.cl: no se pudo reintentar ahora\)/);
  assert.doesNotMatch(partial.reply, /BULK_CAMPAIGN|connection reset|terminal/, 'the reply never carries the database\'s words');
  console.log('PASS: staging lists what can be retried and pins it; the card recomputes it; every refusal retries nothing; the approved retry runs once per draft and says what happened.');
} finally {
  if (flag === undefined) delete process.env.COWORK_CAMPAIGN_RETRY_ENABLED; else process.env.COWORK_CAMPAIGN_RETRY_ENABLED = flag;
}

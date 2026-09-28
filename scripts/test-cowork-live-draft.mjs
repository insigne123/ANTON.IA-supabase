import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const keys = ['COWORK_ENABLED', 'COWORK_STREAMING_ENABLED'];
const environment = Object.fromEntries(keys.map(key => [key, process.env[key]]));
process.env.COWORK_ENABLED = 'true';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
// The first answer has no closing question, so the loop asks once more (the closing correction).
const first = { action: 'answer', query: null, leadId: null, answer: { reply: 'Tus 3 contactos de RR. HH. tienen correo y ninguno ha recibido nada.', document: null, question: null, blocks: null, suggestions: null } };
const second = { action: 'answer', query: null, leadId: null, answer: { reply: 'Tus 3 contactos de RR. HH. tienen correo; ninguno ha recibido nada todavía.', document: null, question: '¿Creo la campaña pausada?', blocks: null, suggestions: [{ label: 'Sí, créala', message: 'Sí, crea la campaña pausada' }] } };
const state = { calls: [], generations: [], refuse: false };
globalThis.__coworkLiveDraft = state;
state.generate = async opts => {
  const decision = state.generations.length === 0 ? first : second;
  state.generations.push({ streamed: typeof opts.onPartial === 'function' });
  if (opts.onPartial) {
    // The model's JSON arrives in pieces; the worker only keeps the latest one.
    const json = JSON.stringify(decision);
    for (let cut = 24; cut < json.length; cut += 19) { opts.onPartial(json.slice(0, cut)); await pause(3); }
    opts.onPartial(json);
  }
  return { data: decision, telemetry: { modelName: 'fixture', durationMs: 1 } };
};
const mocks = {
  './campaign-ops': 'export const stageCoworkCampaignDefinition=async()=>{throw new Error("unexpected campaign")};',
  './code-runner': 'export const stageCoworkCode=async()=>{throw new Error("unexpected code")};',
  './profile-update': 'export const stageCoworkProfileUpdate=async()=>{throw new Error("unexpected profile")};',
  './saved-search-ops': 'export const stageCoworkSavedSearchDelete=async()=>{throw new Error("unexpected search")};export const stageCoworkSavedSearchCreate=async()=>{throw new Error("unexpected search")};export const stageCoworkSavedSearchUpdate=async()=>{throw new Error("unexpected search")};',
  './campaign-stop': 'export const parseCoworkCampaignStopTarget=()=>{throw new Error("unexpected stop")};',
  './crm-record-update': 'export const stageCoworkCrmRecordUpdate=async()=>{throw new Error("unexpected record")};',
  './campaign-prepare': 'export const stageCoworkCampaignPrepare=async()=>{throw new Error("unexpected prepare")};',
  './crm-assign': 'export const stageCoworkCrmAssign=async()=>{throw new Error("unexpected assign")};',
  './exception-resolve': 'export const stageCoworkExceptionResolve=async()=>{throw new Error("unexpected exception")};',
  './mission-control': 'export const stageCoworkMissionControl=async()=>{throw new Error("unexpected mission")};',
  '@/lib/server/bulk-campaigns': 'export const getBulkCampaign=async()=>{throw new Error("unexpected campaign")};',
  '@/lib/server/native-drafts': 'export const getCurrentNativeDraft=async()=>{throw new Error("unexpected draft")};',
  '@/ai/openai-json': 'export const generateStructuredWithTelemetry=opts=>globalThis.__coworkLiveDraft.generate(opts);export const generateStructured=async()=>{throw new Error("unused")};',
  '@/lib/server/supabase-admin': `export const getSupabaseAdminClient=()=>{const chain={table:'',select:()=>chain,eq:()=>chain,gt:()=>chain,limit:()=>chain,in:()=>chain,order:()=>chain,
  maybeSingle:async()=>({data:chain.table==='cowork_runs'?{id:'run',parent_run_id:null,depth:0}:null,error:null}),
  single:async()=>({data:{status:'running',lease_token:'token'},error:null}),
  then(resolve){resolve({data:[],error:null});}};
  return{rpc:async(name,args)=>{const state=globalThis.__coworkLiveDraft;state.calls.push({name,args});
    if(name==='cowork_claim_run')return {data:[{id:'run',user_id:'owner',organization_id:'org',lease_token:'token',mode:'approval',message:'¿A quién de RR. HH. le puedo escribir?'}]};
    if(name==='cowork_write_run_draft')return state.refuse?{data:null,error:{message:'relation "cowork_run_drafts" does not exist'}}:{data:true};
    return {data:true};},from:table=>{chain.table=table;return chain;}};}`,
  '@/lib/server/daily-quota-store': 'export const getEffectiveDailyQuotaLimits=async()=>({leadSearch:50});export const getDailyQuotaStatus=async()=>({allowed:true,count:0,limit:50});export const getEnrichmentQuotaOperation=async()=>null;export const claimEnrichmentQuotaOperation=async()=>{throw new Error("unused")};export const markEnrichmentQuotaOperationSubmitted=async()=>{};export const releaseEnrichmentQuotaOperation=async()=>{};export const completeEnrichmentQuotaOperation=async()=>{};',
  './access': 'export const requireCoworkWorkerAccess=async()=>{};',
  './runs': 'export const coworkWorkerConfigured=()=>true;export const getCoworkRun=async()=>null;',
  './lead-tools': 'export const queryCoworkLeads=async()=>{throw new Error("unexpected read")};',
  './conversation-context': 'export const loadCoworkHistory=async()=>({turns:[]});',
  './external-search': 'export const processCoworkSearchQueue=async()=>({claimed:false});',
  './effects': 'export const processCoworkEffectQueue=async()=>({claimed:false});export const resolveCoworkEffect=async()=>true;',
  './operations': 'export const coworkOperationHash=()=>"hash";export const createCoworkOperationGateway=()=>({invoke:async()=>{throw new Error("unused gateway")}});export const createCoworkOperationDependencies=()=>{throw new Error("unused dependencies")};',
  './read-capabilities': 'export const coworkReadCapabilities=()=>[];',
  '@/lib/cowork/agent-instructions': 'export const coworkAgentInstructions=()=>({systemPrompt:"fixture",parallelReadCapability:"",researchCapability:"",externalSearchCapability:"",additionalCapability:"",effectCapability:""});',
  './draft-from-research': 'export const processCoworkDraftQueue=async()=>({claimed:false});',
  './research-read': 'export const readCoworkResearch=async()=>{};',
};
const bundle = await build({ entryPoints: ['src/lib/server/cowork/worker.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', plugins: [{ name: 'fixture', setup(build) {
  build.onResolve({ filter: /.*/ }, args => mocks[args.path] ? { path: args.path, namespace: 'fixture' } : undefined);
  build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: mocks[args.path] }));
} }] });
const bundled = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), bundled, bundled.exports);
const run = async () => {
  state.calls = []; state.generations = [];
  await bundled.exports.processCoworkQueue();
  const drafts = state.calls.filter(call => call.name === 'cowork_write_run_draft').map(call => call.args);
  const finished = state.calls.find(call => call.name === 'cowork_finish_run')?.args;
  return { drafts, finished };
};
const warn = console.warn;
try {
  // Off (the default): the model is not streamed and no draft is written.
  delete process.env.COWORK_STREAMING_ENABLED;
  const off = await run();
  assert.deepEqual(state.generations, [{ streamed: false }, { streamed: false }]);
  assert.equal(off.drafts.length, 0);
  assert.equal(off.finished.p_status, 'completed');

  // On: the answer is written while it streams, under the run's lease.
  process.env.COWORK_STREAMING_ENABLED = 'true';
  const on = await run();
  // The closing correction is not streamed: the answer on screen stays and is marked as reviewed.
  assert.deepEqual(state.generations, [{ streamed: true }, { streamed: false }]);
  assert.ok(on.drafts.length >= 2, `drafts: ${on.drafts.length}`);
  assert.ok(on.drafts.every(draft => draft.p_run_id === 'run' && draft.p_token === 'token'));
  const texts = on.drafts.map(draft => draft.p_text);
  assert.ok(texts.every((text, index) => index === 0 || text.startsWith(texts[index - 1]) || text === texts[index - 1]), 'the text only grows');
  const shown = on.drafts.filter(draft => !draft.p_progress.reviewing);
  assert.equal(shown.at(-1).p_text, first.answer.reply);
  assert.deepEqual(on.drafts.at(-1), { p_run_id: 'run', p_token: 'token', p_text: first.answer.reply, p_progress: { cards: [], reviewing: true } });
  assert.equal(on.drafts.filter(draft => draft.p_progress.reviewing).length, 1);
  // The answer that counts is still the validated one.
  assert.equal(on.finished.p_status, 'completed');
  assert.match(on.finished.p_payload.reply, /todavía/);

  // Without the table (migration not applied yet) the turn works as before, with one warning.
  const warnings = [];
  console.warn = (...args) => { warnings.push(args.join(' ')); };
  state.refuse = true;
  const missing = await run();
  assert.equal(missing.drafts.length, 1);
  assert.equal(missing.finished.p_status, 'completed');
  assert.match(missing.finished.p_payload.reply, /todavía/);
  assert.equal(warnings.filter(line => line.includes('live draft off')).length, 1);
  console.log('PASS: live draft off by default, written while the answer streams, correction marked as reviewed, missing table falls back.');
} finally {
  console.warn = warn;
  delete globalThis.__coworkLiveDraft;
  for (const [key, value] of Object.entries(environment)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
}

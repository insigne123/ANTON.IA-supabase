// Fase 1 (CW-06): queue fairness. A waiting conversation must go first when a
// queue item was served in the previous tick; otherwise the historical order
// (effects, drafts, searches, conversation) applies. Fail-open on signal errors.
import { build } from 'esbuild';
import assert from 'node:assert/strict';

process.env.COWORK_ENABLED = 'true';
process.env.COWORK_WORKER_ENABLED = 'true';
process.env.COWORK_WORKER_SECRET = 'test-secret';
process.env.COWORK_MODEL = 'test-model';
process.env.OPENAI_API_KEY = 'test-key';

const state = { calls: [], recent: true, failSignal: false };
globalThis.__coworkFairness = state;

function supabaseMock() {
  return `export const getSupabaseAdminClient=()=>{const s=globalThis.__coworkFairness;const rows=table=>{
    if(s.failSignal&&table!=='cowork_runs')throw new Error('signal unavailable');
    if(!s.recent)return [];
    return table==='cowork_runs'?[]:[{run_id:'job'}];};
    const chain={select:()=>chain,eq:()=>chain,gt:()=>chain,limit:()=>chain,in:()=>chain,order:()=>chain,
    maybeSingle:async()=>({data:{id:'run',parent_run_id:null,depth:0},error:null}),
    single:async()=>({data:{status:'running',lease_token:'token'},error:null}),
    then(resolve){try{resolve({data:rows(chain.table),error:null});}catch(error){resolve({data:null,error});}}};
    const from=table=>{chain.table=table;return chain;};
    return{rpc:async(name)=>{s.calls.push(name);
      if(name==='cowork_claim_run')return{data:[{id:'run',user_id:'owner',organization_id:'org',lease_token:'token',mode:'approval',message:'Hola',parent_run_id:null}]};
      if(name==='cowork_finish_run')return{data:true};
      return{data:null};},from};};`;
}

const mocks = {
  './campaign-ops': 'export const stageCoworkCampaignDefinition=async()=>{throw new Error("unexpected campaign")};',
  '@/lib/server/bulk-campaigns': 'export const getBulkCampaign=async()=>{throw new Error("unexpected campaign")};',
  '@/lib/server/native-drafts': 'export const getCurrentNativeDraft=async()=>{throw new Error("unexpected draft")};',
  '@/ai/openai-json': `export const generateStructuredWithTelemetry=async()=>({data:{action:'answer',query:null,leadId:null,answer:{reply:'Listo',document:null}},telemetry:{modelName:'fixture',durationMs:1}});`,
  '@/lib/server/supabase-admin': supabaseMock(),
  './access': 'export const requireCoworkWorkerAccess=async()=>{};',
  './runs': 'export const coworkWorkerConfigured=()=>true;',
  './conversation-context': 'export const loadCoworkHistory=async()=>({turns:[]});',
  './operations': 'export const coworkOperationHash=()=>"hash";export const createCoworkOperationGateway=()=>({invoke:async()=>({})});',
  './read-capabilities': 'export const coworkReadCapabilities=()=>[];',
  './effects': `export const processCoworkEffectQueue=async()=>{globalThis.__coworkFairness.calls.push('queue:effect');return{claimed:false};};export const resolveCoworkEffect=async()=>true;`,
  './external-search': `export const processCoworkSearchQueue=async()=>{globalThis.__coworkFairness.calls.push('queue:search');return{claimed:false};};`,
  './draft-from-research': `export const processCoworkDraftQueue=async()=>{globalThis.__coworkFairness.calls.push('queue:draft');return{claimed:false};};`,
  '@/lib/server/daily-quota-store': `export const getEffectiveDailyQuotaLimits=async()=>({leadSearch:50});export const getDailyQuotaStatus=async()=>({allowed:true,count:0,limit:50});`,
};

const bundle = await build({ entryPoints: ['src/lib/server/cowork/worker.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', plugins: [{ name: 'fixture', setup(b) {
  b.onResolve({ filter: /.*/ }, args => mocks[args.path] ? { path: args.path, namespace: 'fixture' } : undefined);
  b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: mocks[args.path] }));
} }] });
const module = { exports: {} };
new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(module, module.exports, (await import('node:module')).createRequire(import.meta.url));
const { processCoworkQueue } = module.exports;

const indexOf = name => state.calls.findIndex(call => call === name || call === `queue:${name}`);

// A: recent queue service -> conversation first, queues untouched.
state.calls = []; state.recent = true; state.failSignal = false;
await processCoworkQueue();
assert.ok(indexOf('cowork_claim_run') >= 0, 'conversation claimed first');
assert.equal(indexOf('effect'), -1, 'queues skipped when conversation served');

// B: no recent service -> historical order (effect queue before conversation).
state.calls = []; state.recent = false;
await processCoworkQueue();
assert.ok(indexOf('effect') >= 0 && indexOf('effect') < indexOf('cowork_claim_run'), 'queues keep priority without recent service');

// C: unreadable signal -> fail-open to historical order.
state.calls = []; state.recent = true; state.failSignal = true;
await processCoworkQueue();
assert.ok(indexOf('effect') >= 0 && indexOf('effect') < indexOf('cowork_claim_run'), 'fail-open keeps historical order');

console.log('PASS: conversation priority after recent queue service, historical order otherwise, fail-open on signal errors.');

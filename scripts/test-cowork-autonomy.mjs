import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const environment = Object.fromEntries(['COWORK_ENABLED','COWORK_AUTONOMY_ENABLED','COWORK_EXTERNAL_SEARCH_ENABLED'].map(key => [key,process.env[key]]));
process.env.COWORK_ENABLED='true'; process.env.COWORK_EXTERNAL_SEARCH_ENABLED='true';
const state={ mode:'approval', calls:[], disableDuringProposal:false };
globalThis.__coworkAutonomy = state;
const mocks={
  '@/ai/openai-json': `export const generateStructuredWithTelemetry=async()=>({data:{action:'prospecting.propose_search',query:null,leadId:null,answer:null,searchCriteria:{titles:['Gerente'],industries:[],locations:[],limit:5}},telemetry:{modelName:'fixture',durationMs:1}});`,
  '@/lib/server/supabase-admin': `export const getSupabaseAdminClient=()=>({rpc:async(name,args)=>{globalThis.__coworkAutonomy.calls.push({name,args});if(name==='cowork_claim_run')return {data:[{id:'run',user_id:'owner',organization_id:'org',lease_token:'token',mode:globalThis.__coworkAutonomy.mode,message:'Busca gerentes'}]};if(name==='cowork_propose_search'&&globalThis.__coworkAutonomy.disableDuringProposal)process.env.COWORK_AUTONOMY_ENABLED='false';return {data:true};},from:()=>({select:()=>({eq:()=>({single:async()=>({data:{status:'running',lease_token:'token'}})})})})});`,
  './access':'export const requireCoworkWorkerAccess=async()=>{};',
  './runs':'export const coworkWorkerConfigured=()=>true;',
  './lead-tools':'export const queryCoworkLeads=async()=>{throw new Error("unexpected read")};',
  './conversation-context':'export const loadCoworkHistory=async()=>({turns:[]});',
  './external-search':'export const processCoworkSearchQueue=async()=>({claimed:false});',
  './effects':'export const processCoworkEffectQueue=async()=>({claimed:false});export const resolveCoworkEffect=async()=>true;',
  './operations':'export const coworkOperationHash=()=>"hash";export const createCoworkOperationGateway=()=>({invoke:async()=>{throw new Error("unused gateway")}});',
  './read-capabilities':'export const coworkReadCapabilities=()=>[];',
  '@/lib/cowork/agent-instructions':'export const coworkAgentInstructions=()=>({systemPrompt:"fixture",parallelReadCapability:"",researchCapability:"",externalSearchCapability:"",additionalCapability:"",effectCapability:""});',
  './draft-from-research':'export const processCoworkDraftQueue=async()=>({claimed:false});',
  './research-read':'export const readCoworkResearch=async()=>{};',
};
const bundle=await build({entryPoints:['src/lib/server/cowork/worker.ts'],bundle:true,write:false,platform:'node',format:'cjs',packages:'external',plugins:[{name:'fixture',setup(build){
  build.onResolve({filter:/.*/},args=>mocks[args.path]?{path:args.path,namespace:'fixture'}:undefined);
  build.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mocks[args.path]}));
}}]});
const module={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
try {
  for(const [mode,enabled,expected] of [['approval','true',0],['autonomous','false',0],['autonomous','true',1]]){
    state.mode=mode;state.calls=[];process.env.COWORK_AUTONOMY_ENABLED=enabled;
    await module.exports.processCoworkQueue();
    assert.equal(state.calls.filter(call=>call.name==='cowork_claim_search').length,expected);
    assert.equal(state.calls.filter(call=>call.name==='cowork_propose_search').length,1);
  }
  const approved=state.calls.find(call=>call.name==='cowork_claim_search');
  assert.equal(approved.args.p_user_id,'owner');assert.equal(approved.args.p_approve,true);
  state.calls=[];state.disableDuringProposal=true;
  await module.exports.processCoworkQueue();
  assert.equal(state.calls.some(call=>call.name==='cowork_claim_search'),false);
  console.log('PASS: stored execution mode, server gate, one automatic search and revocation before admission.');
} finally {
  delete globalThis.__coworkAutonomy;
  for(const [key,value] of Object.entries(environment)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
}

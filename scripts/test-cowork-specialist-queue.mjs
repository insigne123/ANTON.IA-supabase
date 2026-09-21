// Worker adapter contract, no env files, network or production.
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const keys = ['COWORK_ENABLED','COWORK_SPECIALISTS_ENABLED','COWORK_OPERATION_LEASES_ENABLED','COWORK_SPECIALIST_QUEUE_ENABLED','COWORK_MODEL_BUDGET_ENABLED'];
const previous = Object.fromEntries(keys.map(key => [key,process.env[key]]));
keys.forEach(key => { process.env[key] = 'true'; });
const id = '00000000-0000-4000-8000-000000000001';
const state = { calls: [], generated: 0, access: true, parent: 'waiting_workers', invalid: false, accept: true, job: {
  id, run_id: id, user_id: id, organization_id: id, lease_token: id, role: 'analyst',
  assignment: { task: { role: 'analyst', objective: 'Analiza', evidence: [0] }, evidence: [{ index: 0, observation: { rows: 1 } }] },
} };
const client = {
  rpc: async (name,args) => { state.calls.push({ name,args });
    return { data: name === 'cowork_take_specialist' ? [state.job] : name === 'cowork_reserve_model_call' ? (state.budgetDenied ? null : id) : state.accept, error: null }; },
  from: () => { const chain = { select:()=>chain,eq:()=>chain,single:async()=>({data:{status:state.parent},error:null}) }; return chain; },
};
globalThis.__specialistQueue = { state, client };
const mocks = {
  './read-capabilities': `import {z} from 'zod'; export const coworkReadCapabilities=()=>[{name:'metrics.overview',version:1,effect:'read',description:'fixture',input:z.literal(''),output:z.unknown(),execute:async()=>({count:2})}];`,
  '@/lib/server/supabase-admin': 'export const getSupabaseAdminClient=()=>globalThis.__specialistQueue.client;',
  './access': 'export const requireCoworkWorkerAccess=async()=>{if(!globalThis.__specialistQueue.state.access)throw new Error("revoked")};',
  '@/ai/openai-json': `export const generateStructuredWithTelemetry=async options=>{
    const s=globalThis.__specialistQueue.state;s.generated++;
    if(options.maxAttempts!==1||options.maxOutputTokens!==1800)throw new Error('budget');
    return {data:{summary:'Resumen',findings:[{text:'Dato',evidence:[s.invalid?2:0]}],limitations:[]},
      telemetry:{modelName:'fixture',durationMs:10,usage:{prompt_tokens:30,completion_tokens:10,total_tokens:40,private_field:'omit'}}};};`,
};
try {
  const bundled = await build({ entryPoints:['src/lib/server/cowork/specialist-queue.ts'],bundle:true,write:false,platform:'node',format:'cjs',packages:'external',
    plugins:[{name:'fixtures',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'fixture'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks[a.path],resolveDir:process.cwd()}));}}] });
  const module={exports:{}};
  new Function('require','module','exports',bundled.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
  const processQueue=module.exports.processCoworkSpecialistQueue;
  process.env.COWORK_SPECIALIST_QUEUE_ENABLED='false';
  assert.deepEqual(await processQueue(),{claimed:false,processed:0}); assert.equal(state.calls.length,0);
  process.env.COWORK_SPECIALIST_QUEUE_ENABLED='true';
  assert.deepEqual(await processQueue(),{claimed:true,processed:1});
  const success=state.calls.find(call=>call.name==='cowork_finish_specialist');
  assert.equal(success.args.p_success,true); assert.equal(success.args.p_token,id);
  assert.deepEqual(success.args.p_usage,{model:'fixture',durationMs:10,inputTokens:30,outputTokens:10,totalTokens:40});
  state.calls=[];state.invalid=true;
  assert.deepEqual(await processQueue(),{claimed:true,processed:0});
  assert.equal(state.calls.at(-1).args.p_success,false); assert.equal(state.calls.at(-1).args.p_result,null);
  state.invalid=false;state.parent='cancelled';
  const before=state.generated;await processQueue();assert.equal(state.generated,before);
  state.parent='waiting_workers';state.access=false;await processQueue();assert.equal(state.generated,before);
  state.access=true;state.accept=false;
  assert.deepEqual(await processQueue(),{claimed:true,processed:0});
  state.accept=true;state.budgetDenied=true;
  const callsBefore=state.generated;
  assert.deepEqual(await processQueue(),{claimed:true,processed:0});
  assert.equal(state.generated,callsBefore);
  console.log('PASS: queue gate, scoped authorization, generation budget, usage minimization, invalid evidence, cancellation and rejected publication.');
} finally {
  delete globalThis.__specialistQueue;
  for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
}

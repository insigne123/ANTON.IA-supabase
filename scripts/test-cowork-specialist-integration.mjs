// Real agent + queue adapter + PostgreSQL RPCs; provider alone is deterministic.
// PGlite is isolated in memory; never loads environment files or contacts production.
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import assert from 'node:assert/strict';
const db = process.argv.includes('--native')
  ? await (await import('./cowork-isolated-postgres.mjs')).createIsolatedPostgres()
  : new (await import(process.env.COWORK_PGLITE_MODULE ? pathToFileURL(process.env.COWORK_PGLITE_MODULE).href : '@electric-sql/pglite')).PGlite();
const owner = randomUUID(), org = randomUUID(), run = randomUUID(), token = randomUUID();
const flags=['COWORK_ENABLED','COWORK_SPECIALISTS_ENABLED','COWORK_OPERATION_LEASES_ENABLED','COWORK_SPECIALIST_QUEUE_ENABLED','COWORK_MODEL_BUDGET_ENABLED','COWORK_OWNER_USER_ID','COWORK_SPECIALIST_TOOLS_ENABLED','COWORK_MODEL_USAGE_ENABLED'];
const previous=Object.fromEntries(flags.map(key=>[key,process.env[key]]));
flags.forEach(key=>process.env[key]='true');process.env.COWORK_OWNER_USER_ID=owner;
let modelCalls=0;
const rpcNames=new Set(['cowork_enqueue_specialists','cowork_take_specialist','cowork_finish_specialist','cowork_reserve_model_call','cowork_reserve_operation_v2','cowork_finish_operation_v2','cowork_record_model_usage']);
const client={rpc:async(name,args)=>{
  assert.ok(rpcNames.has(name));
  const entries=Object.entries(args);
  const parameters=entries.map(([key],i)=>`${key} => $${i+1}`).join(',');
   const values=entries.map(([key,value])=>key==='p_input'||key==='p_result'||(value && typeof value==='object')?JSON.stringify(value):value);
  try {
    const rows=(await db.query(`select * from public.${name}(${parameters})`,values)).rows;
    return {data:name==='cowork_take_specialist'?rows:name==='cowork_reserve_operation_v2'?rows[0]:rows[0][name],error:null};
  }catch(error){return {data:null,error};}
},from:table=>{
  assert.ok(['cowork_runs','cowork_run_events'].includes(table));
  const filters=[];let max=100;let order='';
  const execute=async(single)=>{
    const where=filters.map(([key],i)=>`${key}=$${i+1}`).join(' and ');
    const rows=(await db.query(`select * from ${table} where ${where}${order} limit ${max}`,filters.map(([,v])=>v))).rows;
    return {data:single?rows[0]??null:rows,error:null};
  };
  const chain={select:()=>chain,eq:(key,value)=>{assert.ok(['id','run_id','user_id','organization_id','kind'].includes(key));filters.push([key,value]);return chain;},
    order:(key)=>{assert.equal(key,'sequence');order=' order by sequence asc';return chain;},limit:value=>{max=value;return chain;},
    single:()=>execute(true),then:(resolve,reject)=>execute(false).then(resolve,reject)};return chain;
}};
globalThis.__coworkIntegration={client,generate:async()=>{
  modelCalls++;return {data:{summary:'Dos registros observados',findings:[{text:'Hay dos registros',evidence:[0]}],limitations:[]},
    telemetry:{modelName:'fixture',durationMs:5,usage:{prompt_tokens:20,completion_tokens:10,total_tokens:30}}};
},authorize:async(_client,scope)=>{
  assert.deepEqual(scope,{userId:owner,organizationId:org});
  const grant=(await db.query('select enabled from cowork_access_grants where user_id=$1',[owner])).rows[0];
  if(!grant?.enabled)throw new Error('revoked');
}};
const fixtures={
  './read-capabilities': `import {z} from 'zod'; export const coworkReadCapabilities=()=>[{name:'metrics.overview',version:1,effect:'read',description:'fixture',input:z.literal(''),output:z.unknown(),execute:async()=>({count:2})}];`,
  '@/lib/server/supabase-admin':'export const getSupabaseAdminClient=()=>globalThis.__coworkIntegration.client;',
  './access':'export const requireCoworkWorkerAccess=(...args)=>globalThis.__coworkIntegration.authorize(...args);',
  '@/ai/openai-json':'export const generateStructuredWithTelemetry=()=>globalThis.__coworkIntegration.generate();',
};
try {
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
    create function auth.uid() returns uuid language sql as 'select null::uuid';
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create table organizations(id uuid primary key);create table organization_members(user_id uuid,organization_id uuid);
    create table cowork_access_grants(user_id uuid,enabled boolean);
    create function cowork_has_access(uuid) returns boolean language sql as 'select false';
    create table cowork_runs(id uuid primary key,user_id uuid,organization_id uuid,status text constraint cowork_runs_status_check check(status in ('queued','running','waiting_approval','completed','failed','cancelled')),lease_token uuid,lease_expires_at timestamptz,created_at timestamptz default now(),updated_at timestamptz default now(),parent_run_id uuid,depth integer not null default 0);
    create table cowork_run_events(sequence bigserial,run_id uuid,user_id uuid,organization_id uuid,kind text,payload jsonb);
  `);
  await db.query(`insert into auth.users values($1,'nicolas.yarur.g@yago.cl',now())`,[owner]);
  await db.query('insert into organizations values($1)',[org]);await db.query('insert into organization_members values($1,$2)',[owner,org]);
  await db.query('insert into cowork_access_grants values($1,true)',[owner]);
  await db.query(`insert into cowork_runs(id,user_id,organization_id,status,lease_token,lease_expires_at) values($1,$2,$3,'running',$4,now()+interval '180 seconds')`,[run,owner,org,token]);
  for(const filename of ['20260917120000_cowork_operations.sql','20260920161555_cowork_operation_leases_v2.sql','20260920205105_cowork_specialist_queue.sql','20260920205152_cowork_model_budget.sql','20260921010105_cowork_thread_model_budget.sql','20260921015112_cowork_conversation_budget.sql','20260921022101_cowork_specialist_read_leases.sql','20260921022150_cowork_model_usage.sql'])
    await db.exec(await readFile(new URL(`../supabase/migrations/${filename}`,import.meta.url),'utf8'));
  const bundle=await build({stdin:{contents:`export * from './src/lib/server/cowork/specialist-queue';export {runCoworkReadLoop} from './src/lib/cowork/agent-loop';`,resolveDir:process.cwd()},
    bundle:true,write:false,platform:'node',format:'cjs',packages:'external',plugins:[{name:'boundary',setup(b){
      b.onResolve({filter:/.*/},args=>fixtures[args.path]?{path:args.path,namespace:'fixture'}:undefined);
      b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:fixtures[args.path],resolveDir:process.cwd()}));
    }}]});
  const module={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
  const api=module.exports;let turn=0;
  await assert.rejects(api.runCoworkReadLoop({message:'Analiza y verifica',runId:run,signal:new AbortController().signal,authorize:async()=>{},
    execute:async()=>({items:[{id:'a'},{id:'b'}]}),
    record:async observation=>{await db.query("insert into cowork_run_events(run_id,user_id,organization_id,kind,payload) values($1,$2,$3,'tool.completed',$4)",[run,owner,org,JSON.stringify(observation)]);},
    review:(tasks,observations)=>api.enqueueCoworkSpecialists(client,run,token,tasks,observations),
    decide:async()=>++turn===1?{action:'leads.search',query:'',leadId:null,answer:null}:
      {action:'specialists.review',query:null,leadId:null,answer:null,specialists:[{role:'analyst',objective:'Analiza',evidence:[0],read:{action:'metrics.overview',input:''}},{role:'verifier',objective:'Verifica',evidence:[0]}]},
  }),api.CoworkSpecialistsDeferred);
  assert.equal((await db.query('select status from cowork_runs where id=$1',[run])).rows[0].status,'waiting_workers');
  assert.equal(modelCalls,0);
  // Two independent scheduler invocations, state recovered exclusively from DB.
  assert.deepEqual(await api.processCoworkSpecialistQueue(),{claimed:true,processed:1});
  assert.equal((await db.query('select status from cowork_runs where id=$1',[run])).rows[0].status,'waiting_workers');
  assert.deepEqual(await api.processCoworkSpecialistQueue(),{claimed:true,processed:1});
  assert.deepEqual(await api.processCoworkSpecialistQueue(),{claimed:false,processed:0});
  assert.equal(modelCalls,2);
  const operations=(await db.query("select capability,status,result from cowork_operations where run_id=$1",[run])).rows;
  assert.equal(operations.length,1);assert.equal(operations[0].capability,'metrics.overview');assert.equal(operations[0].status,'completed');
  const resumed=await api.loadCoworkSpecialistResume(client,{userId:owner,organizationId:org},run);
  assert.equal(resumed.length,2);assert.equal(resumed[1].result.length,2);
  assert.ok(resumed[1].result.every(item=>item.status==='completed'&&item.usage.totalTokens===30));
  const result=await api.runCoworkReadLoop({message:'Analiza y verifica',runId:run,resumedObservations:resumed,signal:new AbortController().signal,
    authorize:async()=>{},execute:async()=>{throw new Error('Unexpected read');},record:async()=>{throw new Error('Unexpected record');},
    decide:async(observations,mustAnswer)=>{assert.equal(mustAnswer,true);assert.equal(observations.length,2);
      return {action:'answer',query:null,leadId:null,answer:{reply:'Dos registros revisados',document:null}};},
  });
  assert.equal(result.reply,'Dos registros revisados');
  assert.equal((await db.query('select count(*)::int as n from cowork_model_calls where run_id=$1',[run])).rows[0].n,2);
  const usageRows=(await db.query('select usage,usage_recorded_at from cowork_model_calls where run_id=$1',[run])).rows;
  assert.ok(usageRows.every(row=>row.usage_recorded_at && row.usage.totalTokens===30 && row.usage.costUsd===null));
  assert.equal((await db.query("select cowork_record_model_usage(id,$2,'{}') as ok from cowork_model_calls where run_id=$1",[run,token])).rows[0].ok,false);
  assert.equal((await db.query('select status from cowork_runs where id=$1',[run])).rows[0].status,'queued');
  console.log('PASS: real agent admission -> PostgreSQL queue -> independent worker ticks -> durable usage/results -> resumed synthesis, no duplicate generation or refreshed budget.');
} finally {
  await db.close();delete globalThis.__coworkIntegration;
  for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
}

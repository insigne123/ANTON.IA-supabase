// Domain acceptance through the real agent -> registry -> authorization gateway.
// Synthetic data only. No env files, provider calls or production access.
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const owner = '00000000-0000-4000-8000-000000000001';
const org = '00000000-0000-4000-8000-000000000002';
const lead = '00000000-0000-4000-8000-000000000003';
const other = '00000000-0000-4000-8000-000000000004';
const scope = { userId: owner, organizationId: org, runId: 'fixture-run' };
const state = { rows: {}, failures: new Set(), queries: [], suppressed: false, suppressionFailure: false,
  inbox: { enabled: false, items: [], page: { hasMore: false } }, inboxCalls: [], suppressionCalls: [],
  plan: { enabled: false, plan: null }, planCalls: [], step: null, stepCalls: [] };
const client = { from(table) {
  const query = { table, filters: [], limit: null, columns: '' }; state.queries.push(query);
  const response = () => {
    if (query.table === 'unified_crm_data') {
      const gid = (query.filters.find(f => f[0] === 'id') || [])[1];
      return { data: (state.rows.unified_crm_data || {})[gid] ?? null,
        error: state.failures.has(table) ? {message:'private database error'} : null };
    }
    if (query.table === 'leads' && state.rows.leadsById) {
      const id = (query.filters.find(f => f[0] === 'id') || [])[1];
      return { data: (state.rows.leadsById || {})[id] ?? null,
        error: state.failures.has(table) ? {message:'private database error'} : null };
    }
    return { data: state.rows[table] ?? null, error: state.failures.has(table) ? {message:'private database error'} : null };
  };
  const chain = {
    select(columns) { query.columns=columns; return chain; },
    eq(key,value) { query.filters.push([key,value]); return chain; },
    order() { return chain; }, limit(value) { query.limit=value; return chain; },
    maybeSingle: async () => response(), then(resolve,reject) { return Promise.resolve(response()).then(resolve,reject); },
  }; return chain;
} };
globalThis.__coworkDomains = { state, client };
const fixtures = {
  '@/lib/server/campaigns-v2/inbox': `export const getCampaignV2Inbox=async input=>{globalThis.__coworkDomains.state.inboxCalls.push(input);return globalThis.__coworkDomains.state.inbox;};`,
  '@/lib/server/campaigns-v2/plan': `export const getFirstContactPlan=async input=>{globalThis.__coworkDomains.state.planCalls.push(input);return globalThis.__coworkDomains.state.plan;};`,
  '@/lib/server/campaigns-v2/send-context': `export const getCampaignV2RecipientStepSendContext=async input=>{globalThis.__coworkDomains.state.stepCalls.push(input);return globalThis.__coworkDomains.state.step;};`,
  '@/lib/server/privacy-subject-data': `export const isEmailSuppressedForScope=async(email,scope)=>{const s=globalThis.__coworkDomains.state;s.suppressionCalls.push({email,scope});if(s.suppressionFailure)throw new Error('suppression unavailable');return s.suppressed;};`,
  './extended-reads': 'export const queryCoworkExtendedReads=async()=>{throw new Error("unexpected extended read")};',
  './lead-tools': 'export const queryCoworkLeads=async()=>{throw new Error("unexpected lead read")};',
  './research-read': 'export const readCoworkResearch=async()=>{throw new Error("unexpected research")};',
};
const bundle = await build({ stdin: { contents: `
  export {coworkReadCapabilities} from './src/lib/server/cowork/read-capabilities';
  export {createCoworkGateway} from './src/lib/cowork/capabilities';
  export {runCoworkReadLoop} from './src/lib/cowork/agent-loop';
  export {queryCoworkDomainRead} from './src/lib/server/cowork/domain-reads';`, resolveDir:process.cwd() },
  bundle:true,write:false,platform:'node',format:'cjs',packages:'external',plugins:[{name:'domain-boundaries',setup(b){
    b.onResolve({filter:/.*/},args=>fixtures[args.path]?{path:args.path,namespace:'fixture'}:undefined);
    b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:fixtures[args.path]}));
  }}] });
const module={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
let allowed=true;
const gateway=module.exports.createCoworkGateway(module.exports.coworkReadCapabilities(client,scope),{
  authorize:async()=>{if(!allowed)throw new Error('revoked');},hasGrant:async()=>true,
  withOperation:async(_scope,operation,execute)=>{assert.equal(_scope,scope);return execute();},
});
const call=(action,input='')=>gateway.invoke(scope,{capability:action,input,operationId:`fixture:${action}`},new AbortController().signal);
const reset=()=>{state.rows={leadsById:{[lead]:{id:lead,email:'Ana@Example.com'}},organizations:{collaboration_v1_enabled:true}};state.failures.clear();state.queries=[];state.suppressed=false;state.suppressionFailure=false;};
try {
  reset();state.rows.antonia_missions=Array.from({length:21},(_,i)=>({id:`m${i}`,title:'Misión',status:'active',params:{secret:'NEVER'},goal_summary:'Meta'}));
  const missions=await call('missions.list');assert.equal(missions.items.length,20);assert.equal(missions.truncated,true);
  assert.equal(JSON.stringify(missions).includes('NEVER'),false);
  assert.deepEqual(state.queries[0].filters,[['organization_id',org],['user_id',owner]]);
  reset();state.rows.antonia_exceptions=[{id:'e',status:'open',title:'Incidencia',payload:{secret:'NEVER'}}];
  const exceptions=await call('exceptions.list');assert.equal(exceptions.scope,'organization_open_exceptions');
  assert.deepEqual(state.queries[0].filters,[['organization_id',org],['status','open']]);
  assert.equal(JSON.stringify(exceptions).includes('NEVER'),false);
  reset();const inbox=await call('campaigns.inbox');assert.equal(inbox.enabled,false);
  assert.deepEqual(state.inboxCalls[0].organizationIds,[org]);assert.equal(state.inboxCalls[0].userId,owner);
  reset();state.rows.organization_lead_collaboration={assigned_to_user_id:owner,claimed_by_user_id:null,private_note:'NEVER'};
  const collaboration=await call('crm.collaboration',lead);assert.equal(collaboration.collaboration.assignedToUserId,owner);
  assert.equal(JSON.stringify(collaboration).includes('NEVER'),false);
  for(const query of state.queries.filter(q=>q.table!=='organizations'))assert.ok(query.filters.some(([k,v])=>k==='organization_id'&&v===org));
  reset();state.rows.organizations.collaboration_v1_enabled=false;
  assert.equal((await call('crm.collaboration',lead)).enabled,false);
  assert.equal(state.queries.some(q=>q.table==='organization_lead_collaboration'),false);
  reset();state.suppressed=true;
  assert.equal((await call('privacy.contactability',lead)).status,'blocked');
  assert.deepEqual(state.suppressionCalls.at(-1),{email:'ana@example.com',scope});
  reset();state.rows.contacted_leads={bounced_at:'2026-09-20'};
  assert.equal((await call('privacy.contactability',lead)).status,'warning');
  reset();state.rows.leadsById[lead].email=null;
  assert.equal((await call('privacy.contactability',lead)).status,'missing_email');
  assert.equal(state.queries.length,1);
  reset();state.failures.add('excluded_domains');await assert.rejects(call('privacy.contactability',lead),/comprobar/);
  reset();state.suppressionFailure=true;await assert.rejects(call('privacy.contactability',lead));
  reset();state.rows.leadsById={};await assert.rejects(call('privacy.contactability',lead),/organización/);
  assert.equal(state.queries.length,1);
  reset();await assert.rejects(call('crm.collaboration','bad-id'));assert.equal(state.queries.length,0);
  await assert.rejects(call('missions.list','override'));assert.equal(state.queries.length,0);
  allowed=false;await assert.rejects(call('missions.list'),/revoked/);assert.equal(state.queries.length,0);allowed=true;
  for(const [action,fields] of [['missions.list',{}],['exceptions.list',{}],['campaigns.inbox',{}],
    ['crm.collaboration',{leadId:lead}],['privacy.contactability',{leadId:lead}],
    ['campaigns.plan',{draftId:lead}],['campaigns.step_context',{stepId:other}],['crm.record',{leadId:lead}],
    ['privacy.contactability_batch',{leadIds:[lead]}]]) {
    reset();state.rows.antonia_missions=[];state.rows.antonia_exceptions=[];
    state.rows.leadsById={[lead]:{id:lead,email:'a@example.com'}};
    state.rows.unified_crm_data={};
    state.plan={enabled:false,plan:null};
    state.step={stepId:'s',organizationId:org,state:'sending',nativeDraftId:null,nativeVersionId:null,dispatch:null};
    let decisions=0;const events=[];
    const result=await module.exports.runCoworkReadLoop({message:'Consulta',signal:new AbortController().signal,authorize:async()=>{},
      execute:call,record:async observation=>events.push(observation),
      decide:async()=>++decisions===1?{action,query:null,leadId:null,answer:null,...fields}
        :{action:'answer',query:null,leadId:null,answer:{reply:'Consulta completada',document:null}},
    });
    assert.equal(result.reply,'Consulta completada');assert.equal(events[0].action,action);
  }
  // Parallel plan across distinct domains, then synthesis from actual observations.
  reset();state.rows.antonia_missions=[];state.rows.antonia_exceptions=[];let turn=0;
  await module.exports.runCoworkReadLoop({message:'Resumen',signal:new AbortController().signal,authorize:async()=>{},execute:call,record:async()=>{},
    decide:async observations=>++turn===1?{action:'reads.plan',plan:[{id:'missions',dependsOn:[],read:{action:'missions.list',input:''}},
      {id:'incidents',dependsOn:[],read:{action:'exceptions.list',input:''}}],query:null,leadId:null,answer:null}
      :{action:'answer',query:null,leadId:null,answer:{reply:`${observations.length} consultas`,document:null}},
  });
  // campaigns.plan minimizes bodies and honors the v2 gate.
  reset();state.plan={enabled:true,plan:{campaignId:'c',campaignName:'Campaña',lifecycleState:'active',enrollmentId:'e',
    enrollmentState:'active',nextDueAt:null,autoSend:false,
    steps:[{id:'s',name:'Paso',state:'review_required',dueAt:null,nativeDraftId:'d',draftGeneration:{status:'ready',error:null}}]}};
  const plan=await call('campaigns.plan',lead);
  assert.equal(plan.plan.steps.length,1);
  assert.equal(JSON.stringify(plan).includes('draftGeneration'),false);
  assert.deepEqual([state.planCalls[0].draftId,state.planCalls[0].organizationId,state.planCalls[0].userId],[lead,org,owner]);
  reset();state.plan={enabled:false,plan:null};
  assert.equal((await call('campaigns.plan',lead)).plan,null);
  reset();const planCallsBefore=state.planCalls.length;await assert.rejects(call('campaigns.plan','bad'));assert.equal(state.planCalls.length,planCallsBefore);
  // campaigns.step_context exposes state, never provider internals.
  reset();state.step={stepId:'s',organizationId:org,state:'sending',nativeDraftId:'d',nativeVersionId:'v',
    dispatch:{id:'x',status:'sent',idempotencyKey:'k',provider:'google',providerMessageId:'mid',errorCode:null,errorMessage:null,retry:null}};
  const step=await call('campaigns.step_context','00000000-0000-4000-8000-000000000009');
  assert.equal(step.dispatch.status,'sent');
  assert.equal(JSON.stringify(step).includes('mid'),false);
  // crm.record reads both commercial identities for one lead.
  reset();state.rows.unified_crm_data={[`lead_saved|${lead}`]:{id:`lead_saved|${lead}`,stage:'nuevo',owner:'Ana',
    notes:'x'.repeat(3000),next_action:'Llamar',next_action_due_at:null,autopilot_status:null,updated_at:'t'},
    [`lead_enriched|${lead}`]:null};
  const record=await call('crm.record',lead);
  assert.equal(record.records.length,1);
  assert.equal(record.records[0].notes.length,2000);
  assert.ok(state.queries.some(q=>q.table==='unified_crm_data'&&q.filters.some(([k,v])=>k==='id'&&v===`lead_enriched|${lead}`)));
  reset();state.rows.unified_crm_data={};
  assert.equal((await call('crm.record',lead)).records.length,0);
  // Batch contactability: per-recipient results, bounded and fail-closed.
  reset();
  const batchCall=(ids)=>gateway.invoke(scope,{capability:'privacy.contactability_batch',input:JSON.stringify(ids),operationId:`fixture:batch:${ids.length}`},new AbortController().signal);
  const two=await batchCall([lead,other]);
  assert.equal(two.results.length,2);
  assert.equal(two.results[0].status,'ok');
  assert.equal(two.results[1].status,'unavailable');
  await assert.rejects(batchCall([lead,lead]),/duplicados/);
  await assert.rejects(batchCall([lead,other,'00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000006','00000000-0000-4000-8000-000000000007','00000000-0000-4000-8000-000000000008']),/5/);
  await assert.rejects(batchCall(['bad']));
  await assert.rejects(batchCall([]));
  console.log('PASS: 9 domain adapters through agent/gateway, scoped reads, service delegation, flags, minimization, failures, revocation and dependency plans.');
} finally {delete globalThis.__coworkDomains;}

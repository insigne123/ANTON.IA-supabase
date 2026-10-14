import assert from 'node:assert/strict';
import test from 'node:test';
import { runMirrorWorker,enqueueMirror } from './search';
import {cacheHash,mirrorCriteria,mirrorFingerprint} from './contracts';
import {normalizeLinkedinProfileUrl} from '@/lib/linkedin-url';
function env(t:{after:(fn:()=>void)=>void},name:string,value:string){const prior=process.env[name];process.env[name]=value;t.after(()=>{if(prior===undefined)delete process.env[name];else process.env[name]=prior;});}
const job={id:'job',organization_id:'org',company_domain:'demo.test',criteria:mirrorCriteria({domain:'demo.test',titles:['CEO']}),
  status:'submitting',claim_token:'claim',provider_run_id:null,created_at:'2026-10-01T00:00:00Z',expires_at:'2026-11-01T00:00:00Z'};
/** Tables answer reads with fixed rows; every call is recorded. */
function db(row:any,tables:Record<string,any>={}){const calls:any[]=[];let delivered=false;
  const query=(table:string)=>{const builder:any={};
    for(const method of ['select','eq','gt','in','limit','not','gte','lt'])builder[method]=()=>builder;
    builder.maybeSingle=async()=>({data:tables[table]??null,error:null});
    builder.then=(resolve:any)=>resolve({data:tables[table]??[],error:null});
    builder.upsert=async(data:any)=>{calls.push({name:'upsert',input:data});return {error:null};};
    return builder;};
  const value:any={
  rpc:async(name:string,input:any)=>{calls.push({name,input});if(name==='claim_microworlds_search_v1'){if(delivered)return {data:null};delivered=true;return {data:row};}
    if(name==='enqueue_microworlds_search_v1')return {data:{id:'queued-job'}};return {data:true};},
  from:(table:string)=>{calls.push({name:'from',input:table});return query(table);},
};return {value,calls};}
const limits=(used:number)=>Response.json({data:{limits:{maxMonthlyUsageUsd:5},current:{monthlyUsageUsd:used}}});
test('one paid start is bound durably; start uncertainty keeps its reserve and never issues an extra POST',async t=>{
  env(t,'MICROWORLDS_HYBRID_ENABLED','true');const fixture=db(job);let posted=0;
  await runMirrorWorker({db:fixture.value,token:'fixture',fetch:async(input:any,init:any)=>{
    const url=new URL(input);if(url.pathname==='/v2/users/me/limits')return limits(1);
    posted++;assert.equal(url.pathname,'/v2/acts/microworlds~leads-finder/runs');
    // A job queued before sizing buys the old 100, now with a ceiling at plan price instead of US$ 1.50.
    assert.equal(url.searchParams.get('maxTotalChargeUsd'),'0.34');assert.equal(url.searchParams.get('maxItems'),'100');
    assert.equal(JSON.parse(init.body).include_mobile,true);return Response.json({data:{id:'run',actId:'heLL6fUofdPgRXZie'}});
  },limit:3});assert.equal(posted,1);assert.ok(fixture.calls.some(c=>c.name==='record_microworlds_run_v1'&&c.input.p_run==='run'));
  const uncertain=db(job);posted=0;
  await runMirrorWorker({db:uncertain.value,token:'fixture',fetch:async(input:any)=>{
    if(String(input).includes('/users/me/limits'))return limits(1);posted++;throw Error('Connection lost');},limit:3});
  assert.equal(posted,1);const finish=uncertain.calls.find(c=>c.name==='finish_microworlds_search_v1');
  assert.equal(finish.input.p_status,'unknown');assert.equal(finish.input.p_billed,null);
});
test('definitive pre-start failure releases only the unspent reservation',async t=>{
  env(t,'MICROWORLDS_HYBRID_ENABLED','true');const fixture=db(job);
  await runMirrorWorker({db:fixture.value,token:'fixture',fetch:async(input:any)=>String(input).includes('/users/me/limits')?limits(1)
    :Response.json({error:{type:'invalid-input-schema'}},{status:400})});
  const finish=fixture.calls.find(c=>c.name==='finish_microworlds_search_v1');assert.equal(finish.input.p_billed,0);assert.equal(finish.input.p_status,'failed');
});
test('poll imports encrypted contacts with receipt, excludes foreign company and publishes under current lease',async t=>{
  env(t,'MICROWORLDS_HYBRID_ENABLED','true');env(t,'INTERNAL_API_SECRET','unit-test-key');env(t,'SUPABASE_SERVICE_ROLE_KEY','unit-encryption-key');
  const fixture=db({...job,status:'running',provider_run_id:'run'});const methods:string[]=[];
  const result=await runMirrorWorker({db:fixture.value,token:'fixture',fetch:async(input:any,init:any)=>{
    methods.push(init.method);if(String(input).includes('/dataset/items'))return Response.json([
      {first_name:'Ana',last_name:'Pérez',organization_primary_domain:'demo.test',email:'private@demo.test',linkedin_url:'https://linkedin.com/in/ana-demo'},
      {first_name:'Ana',last_name:'Pérez',organization_primary_domain:'demo.test',email:'private@demo.test',linkedin_url:'https://linkedin.com/in/ana-demo'},
      {first_name:'Other',last_name:'Person',organization_primary_domain:'foreign.test',email:'foreign@foreign.test'},
    ]);
    return Response.json({data:{id:'run',actId:'heLL6fUofdPgRXZie',status:'SUCCEEDED',finishedAt:'2026-01-01T00:00:00Z',usageTotalUsd:0.3}});
  }});
  assert.equal(result.processed,1);assert.deepEqual(methods,['GET','GET']);
  const published=fixture.calls.find(c=>c.name==='publish_microworlds_contacts_v1');assert.equal(published.input.p_rows.length,1);
  assert.equal(published.input.p_claim,'claim');assert.ok(published.input.p_rows[0].contact_encrypted.startsWith('enc:v1.'));
  assert.equal(JSON.stringify(published).includes('private@'),false);assert.equal(JSON.stringify(published).includes('foreign@'),false);
  assert.equal(fixture.calls.find(c=>c.name==='finish_microworlds_search_v1').input.p_billed,300000);
});
test('visible search only persists observations/queue; it never calls a provider or adds another app credit',async t=>{
  env(t,'MICROWORLDS_HYBRID_ENABLED','true');t.mock.method(globalThis,'fetch',async()=>{assert.fail('enqueue is not a paid search');});
  const fixture=db(null);
  await enqueueMirror({organizationId:'org',userId:'me',criteria:job.criteria,identities:[{id:'apollo',domain:'demo.test',fullName:'Ana Pe***z'}]},fixture.value);
  const rpcs=fixture.calls.filter(c=>c.name!=='from');
  assert.deepEqual(rpcs.map(c=>c.name),['record_apollo_search_observations_v1','enqueue_microworlds_search_v1']);
  assert.equal(rpcs[0].input.p_user,'me');assert.equal(rpcs[1].input.p_org,'org');
});
test('a sized run buys the people shown plus half, with a ceiling at plan price, and Apify stops there',async t=>{
  env(t,'MICROWORLDS_HYBRID_ENABLED','true');env(t,'INTERNAL_API_SECRET','unit-test-key');
  const people=Array.from({length:30},(_,i)=>({id:'apollo-'+i,domain:'demo.test',fullName:'Persona '+i,title:'CEO'}));
  const fixture=db(null);
  await enqueueMirror({organizationId:'org',userId:'me',criteria:job.criteria,identities:people},fixture.value);
  const queued=fixture.calls.find(c=>c.name==='enqueue_microworlds_search_v1');
  assert.equal(queued.input.p_criteria.limit,45);
  assert.equal(queued.input.p_fingerprint,mirrorFingerprint(job.criteria),'the size does not split the 30-day reuse');
  const started=db({...job,criteria:queued.input.p_criteria});let url:URL|undefined;
  await runMirrorWorker({db:started.value,token:'fixture',fetch:async(input:any,init:any)=>{
    if(String(input).includes('/users/me/limits'))return limits(1);url=new URL(input);
    assert.equal(JSON.parse(init.body).max_result,45);return Response.json({data:{id:'run',actId:'heLL6fUofdPgRXZie'}});}});
  assert.equal(url?.searchParams.get('maxItems'),'45');assert.equal(url?.searchParams.get('maxTotalChargeUsd'),'0.15');
});
test('nothing is bought when the cache has the people, an unfiltered full run covers the company, or the month is spent',async t=>{
  env(t,'MICROWORLDS_HYBRID_ENABLED','true');env(t,'INTERNAL_API_SECRET','unit-test-key');
  const people=Array.from({length:10},(_,i)=>({id:'apollo-'+i,domain:'demo.test',fullName:'Persona '+i,title:'CEO',
    linkedinUrl:i<9?'https://linkedin.com/in/persona-'+i:null}));
  const enqueued=(fixture:ReturnType<typeof db>)=>fixture.calls.some(c=>c.name==='enqueue_microworlds_search_v1');
  const cached=db(null,{microworlds_contact_cache:people.slice(0,8).map(p=>({profile_hash:cacheHash('profile',normalizeLinkedinProfileUrl(p.linkedinUrl)!,'org')}))});
  assert.equal(await enqueueMirror({organizationId:'org',userId:'me',criteria:job.criteria,identities:people},cached.value),null);
  assert.equal(enqueued(cached),false,'8 of 10 already cached: the other 2 go to Apollo');
  const halfCached=db(null,{microworlds_contact_cache:people.slice(0,5).map(p=>({profile_hash:cacheHash('profile',normalizeLinkedinProfileUrl(p.linkedinUrl)!,'org')}))});
  await enqueueMirror({organizationId:'org',userId:'me',criteria:job.criteria,identities:people},halfCached.value);
  assert.equal(halfCached.calls.find(c=>c.name==='enqueue_microworlds_search_v1').input.p_criteria.limit,20,'5 uncovered, never fewer than 20');
  const covered=db(null,{microworlds_search_jobs:[{criteria:mirrorCriteria({domain:'demo.test'})}]});
  assert.equal(await enqueueMirror({organizationId:'org',userId:'me',criteria:job.criteria,identities:people},covered.value),null);
  assert.equal(enqueued(covered),false);
  const small=db(null,{microworlds_search_jobs:[{criteria:mirrorCriteria({domain:'demo.test',limit:20})}]});
  await enqueueMirror({organizationId:'org',userId:'me',criteria:job.criteria,identities:people},small.value);
  assert.equal(enqueued(small),true,'a small unfiltered run is not a superset');
  const spent=db(null,{microworlds_search_budgets:{spent_micro_usd:3_950_000}});
  assert.equal(await enqueueMirror({organizationId:'org',userId:'me',criteria:job.criteria,identities:people},spent.value),null);
  assert.equal(enqueued(spent),false,'US$ 3.95 of the US$ 4 default spent');
  env(t,'MICROWORLDS_MONTH_USD','10');const raised=db(null,{microworlds_search_budgets:{spent_micro_usd:3_950_000}});
  await enqueueMirror({organizationId:'org',userId:'me',criteria:job.criteria,identities:people},raised.value);
  assert.equal(enqueued(raised),true);
});
test('a run that does not fit in what is left of the Apify plan is not started and releases its reserve',async t=>{
  env(t,'MICROWORLDS_HYBRID_ENABLED','true');const fixture=db(job);let posted=0;
  await runMirrorWorker({db:fixture.value,token:'fixture',fetch:async(input:any)=>{
    if(String(input).includes('/users/me/limits'))return limits(4.9);posted++;return Response.json({data:{id:'run',actId:'heLL6fUofdPgRXZie'}});}});
  assert.equal(posted,0);const finish=fixture.calls.find(c=>c.name==='finish_microworlds_search_v1');
  assert.equal(finish.input.p_status,'failed');assert.equal(finish.input.p_billed,0);assert.equal(finish.input.p_error,'MIRROR_PLAN_LIMIT');
  const unreadable=db(job);posted=0;
  await runMirrorWorker({db:unreadable.value,token:'fixture',fetch:async(input:any)=>{
    if(String(input).includes('/users/me/limits'))return Response.json({error:{}},{status:500});posted++;return Response.json({});}});
  assert.equal(posted,0);assert.equal(unreadable.calls.find(c=>c.name==='finish_microworlds_search_v1').input.p_billed,0);
});

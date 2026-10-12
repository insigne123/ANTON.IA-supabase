import assert from 'node:assert/strict';
import test from 'node:test';
import { runMirrorWorker,enqueueMirror } from './search';
import {mirrorCriteria} from './contracts';
function env(t:{after:(fn:()=>void)=>void},name:string,value:string){const prior=process.env[name];process.env[name]=value;t.after(()=>{if(prior===undefined)delete process.env[name];else process.env[name]=prior;});}
const job={id:'job',organization_id:'org',company_domain:'demo.test',criteria:mirrorCriteria({domain:'demo.test',titles:['CEO']}),
  status:'submitting',claim_token:'claim',provider_run_id:null,created_at:'2026-10-01T00:00:00Z',expires_at:'2026-11-01T00:00:00Z'};
function db(row:any){const calls:any[]=[];let delivered=false;const value:any={
  rpc:async(name:string,input:any)=>{calls.push({name,input});if(name==='claim_microworlds_search_v1'){if(delivered)return {data:null};delivered=true;return {data:row};}return {data:true};},
  from:()=>({upsert:async(data:any)=>{calls.push({name:'upsert',input:data});return {error:null};}}),
};return {value,calls};}
test('one paid start is bound durably; start uncertainty keeps its reserve and never issues an extra POST',async t=>{
  env(t,'MICROWORLDS_HYBRID_ENABLED','true');const fixture=db(job);let posted=0;
  await runMirrorWorker({db:fixture.value,token:'fixture',fetch:async(input:any,init:any)=>{
    posted++;const url=new URL(input);assert.equal(url.pathname,'/v2/acts/microworlds~leads-finder/runs');
    assert.equal(url.searchParams.get('maxTotalChargeUsd'),'1.5');assert.equal(url.searchParams.get('maxItems'),'100');
    assert.equal(JSON.parse(init.body).include_mobile,true);return Response.json({data:{id:'run',actId:'heLL6fUofdPgRXZie'}});
  },limit:3});assert.equal(posted,1);assert.ok(fixture.calls.some(c=>c.name==='record_microworlds_run_v1'&&c.input.p_run==='run'));
  const uncertain=db(job);posted=0;
  await runMirrorWorker({db:uncertain.value,token:'fixture',fetch:async()=>{posted++;throw Error('Connection lost');},limit:3});
  assert.equal(posted,1);const finish=uncertain.calls.find(c=>c.name==='finish_microworlds_search_v1');
  assert.equal(finish.input.p_status,'unknown');assert.equal(finish.input.p_billed,null);
});
test('definitive pre-start failure releases only the unspent reservation',async t=>{
  env(t,'MICROWORLDS_HYBRID_ENABLED','true');const fixture=db(job);
  await runMirrorWorker({db:fixture.value,token:'fixture',fetch:async()=>Response.json({error:{type:'invalid-input-schema'}},{status:400})});
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
  assert.deepEqual(fixture.calls.map(c=>c.name),['record_apollo_search_observations_v1','enqueue_microworlds_search_v1']);
  assert.equal(fixture.calls[0].input.p_user,'me');assert.equal(fixture.calls[1].input.p_org,'org');
});

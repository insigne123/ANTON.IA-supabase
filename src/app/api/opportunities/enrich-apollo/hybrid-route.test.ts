import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import * as crypto from 'node:crypto';
import ts from 'typescript';
import {normalizeLinkedinProfileUrl} from '@/lib/linkedin-url';
import {hybridFieldPlan} from '@/lib/server/microworlds/fulfillment';
import type {CachedContact} from '@/lib/server/microworlds/contracts';
import * as allocation from '@/lib/apollo-credit-allocation';
class ProviderError extends Error {constructor(readonly status:number,readonly code:string,readonly providerOutcomeUnknown:boolean){super(code);}}
class AllocationRefusal extends Error {}
const contact:CachedContact={firstName:'Ana',lastName:'Pérez',fullName:'Ana Pérez',domain:'demo.test',title:'CEO',linkedinUrl:'https://linkedin.com/in/ana-demo',email:'ana@demo.test',emailStatus:'unknown',mobile:'+56912345678'};
function fixture(options:{cache?:CachedContact|null;pending?:boolean;fail?:boolean;providerEmail?:string;shareUsed?:string}={}){
  const rows=new Map<string,any>(),callbacks:any[]=[],calls={claims:0,provider:[] as any[],registered:[] as any[],applied:[] as any[],share:[] as number[]};
  let claim:any=null,stored:any=null;
  const db:any={from(table:string){let value:any,selected:any,ids:any={};const chain:any={
    select(){return chain;},eq(k:string,v:any){ids[k]=v;return chain;},in(){return chain;},limit(){return chain;},order(){return chain;},
    insert(row:any){value=row;rows.set(row.id,{...row,phone_numbers:[],primary_phone:null});return chain;},
    update(patch:any){value=patch;return chain;},
    async maybeSingle(){selected=rows.get(ids.id||value?.id);if(value&&ids.id&&selected)Object.assign(selected,value);return {data:selected||null,error:null};},
    then(resolve:any){const data=table==='hybrid_enrichment_items'?calls.registered.map(c=>({target_id:c.target.id,client_ref:c.target.clientRef,requested_phone:c.requested.phone})):callbacks.map(c=>({target_lead_id:c.targetId,requested_fields:c.requestedFields}));return Promise.resolve({data,error:null}).then(resolve);},
  };return chain;},
  async rpc(name:string,p:any){if(name==='has_apollo_enrichment_email_suppression_v1')return {data:false};
    if(name==='apply_hybrid_apollo_fields_v1'){const row=rows.get(p.p_target);if(!row.email&&p.p_candidate.email)row.email=p.p_candidate.email;
      if(row.email===p.p_candidate.email&&p.p_candidate.email_status)row.email_status=p.p_candidate.email_status;
      if(!row.primary_phone&&p.p_candidate.primary_phone){row.primary_phone=p.p_candidate.primary_phone;row.phone_numbers=p.p_candidate.phone_numbers;}
      row.enrichment_status=p.p_pending_phone?'pending_phone':'completed';return {data:row,error:null};}
    assert.fail('Unexpected RPC '+name);
  }};
  const modules:Record<string,any>={
    'node:crypto':crypto,
    'next/server':{NextResponse:{json:(body:unknown,init?:ResponseInit)=>Response.json(body,init)}},
    '@/lib/linkedin-url':{normalizeLinkedinProfileUrl},
    '@/lib/server/lead-identity':{applyEnrichedIdentity:async()=>{},identityFromProvider:(value:any)=>value},
    '@/lib/server/antonia-event-ledger':{safeAppendAntoniaEvent:async()=>{}},
    '@/lib/server/request-auth':{requireSessionOrTrustedInternalRequest:async()=>({source:'session',user:{id:'me',email:'me@demo.test'},organizationId:'org'}),requestAuthErrorResponse:()=>null},
    '@/lib/server/supabase-admin':{getSupabaseAdminClient:()=>db},
    '@/lib/lead-claim':{leadClaimRefusal:()=>null},
    '@/lib/apollo-credit-allocation':allocation,
    '@/lib/server/apollo-credit-allocation':{ApolloAllocationRefusal:AllocationRefusal,assertApolloAllocationAllows:async(_org:string,needed:number)=>{
      calls.share.push(needed);if(options.shareUsed&&needed>0)throw new AllocationRefusal(options.shareUsed);return null;}},
    '@/lib/server/enrichment-search-access':{hasEnrichmentSearchCreditAccess:()=>true,hasUserEnrichmentSearchCreditAccess:async()=>true},
    '@/lib/server/provider-routing':{resolveLeadProvider:()=>({provider:'apollo',requestedProvider:'apollo',defaultProvider:'apollo'})},
    '@/lib/server/microworlds/contracts':{hybridEnabled:()=>true},
    '@/lib/server/microworlds/search':{observeConfirmedApolloIdentity:async()=>{}},
    '@/lib/server/microworlds/fulfillment':{
      findHybridHint:async()=>options.cache===null?null:{identity:{id:'apollo-person',domain:'demo.test'},contact:options.cache||contact},
      frozenHybridItems:async()=>[],hybridFieldPlan,
      registerHybridItem:async(scope:any,target:any,hint:any,requested:any)=>{calls.registered.push({scope,target,hint,requested});},
      applyHybridCache:async(scope:any,id:string,hint:any)=>{calls.applied.push(id);const row=rows.get(id);if(calls.registered[0].requested.email)row.email=hint.contact.email;
        if(calls.registered[0].requested.phone){row.primary_phone=hint.contact.mobile;row.phone_numbers=hint.contact.mobile?[{sanitized_number:hint.contact.mobile}]:[];}
        row.full_name=hint.contact.fullName;row.email_status=hint.contact.emailStatus;row.enrichment_status='completed';return true;},
      cancelHybridItems:async()=>{},settleHybrid:async()=>{if(options.pending)return false;claim.status='completed';stored={responsePayload:{operationStatus:'completed',queued:false},responseStatus:200};return true;},
    },
    '@/lib/server/daily-quota-store':{
      getEnrichmentQuotaOperation:async()=>claim?{...claim,...stored,reused:true}:null,
      getEffectiveDailyQuotaLimits:async()=>({enrich:50,research:50}),
      claimEnrichmentQuotaOperation:async(p:any)=>{calls.claims++;claim={operationId:p.operationId,claimToken:'claim',allowed:true,claimed:true,reused:false,consumed:p.count,count:p.count,limit:50,status:'claimed'};return claim;},
      markEnrichmentQuotaOperationSubmitted:async()=>{claim.status='submitted';},completeEnrichmentQuotaOperation:async(p:any)=>{claim.status='completed';stored=p;},releaseEnrichmentQuotaOperation:async()=>true,
    },
    '@/lib/server/apollo-enrichment':{ApolloEnrichmentError:ProviderError,assertApolloEnrichmentConfigured:()=>{},submitApolloEnrichment:async(p:any)=>{
      calls.provider.push(p);if(options.fail)throw new ProviderError(503,'APOLLO_CREDITS_EXHAUSTED',false);
      return {success:true,providerRequestId:options.pending?'request':undefined,extractedData:{source_provider_id:'apollo-person',full_name:'Ana Pérez',
        email:options.providerEmail||contact.email,email_status:'verified',primary_phone:options.pending?null:'+15550100123',phone_numbers:options.pending?[]:[{sanitized_number:'+15550100123'}]}};
    }},
    '@/lib/server/apollo-enrichment-callbacks':{
      APOLLO_REQUESTED_FIELDS:['person.email','person.phone_numbers'],
      createApolloEnrichmentCallback:async(p:any)=>{callbacks.push({targetId:p.targetId,...p});return {callbackId:'callback',tokenHash:'hash',webhookUrl:'https://app.test/hook'};},
      markApolloEnrichmentCallbackSubmitted:async()=>{claim.status='submitted';},bindApolloEnrichmentCallback:async()=> 'bound',
      applyApolloEnrichmentCandidate:async()=>({}),settleApolloEnrichmentCallback:async()=>({}),
    },
  };
  const code=ts.transpileModule(readFileSync('src/app/api/opportunities/enrich-apollo/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const exports:any={};new Function('require','exports',code)((name:string)=>{assert.ok(modules[name],name);return modules[name];},exports);
  const request=()=>new Request('https://app.test/api/opportunities/enrich-apollo',{method:'POST',headers:{'Idempotency-Key':'same-operation'},
    body:JSON.stringify({leads:[{sourceProviderId:'apollo-person',clientRef:'11111111-1111-4111-8111-111111111111',fullName:'Ana Pe***z',companyDomain:'demo.test'}],revealEmail:true,revealPhone:true,tableName:'enriched_leads'})});
  return {run:()=>exports.POST(request()),calls,callbacks,rows};
}
test('complete confirmed cache fulfills both selected fields, one app debit and zero Apollo calls; replay is canonical',async()=>{
  const f=fixture();const first=await f.run();assert.equal(first.status,200);const body=await first.json();
  assert.equal(body.queued,false);assert.equal(body.enriched[0].email,contact.email);assert.equal(body.enriched[0].primaryPhone,contact.mobile);
  assert.equal(body.enriched[0].emailStatus,'unknown');assert.equal(body.enriched[0].serverPersisted,true);assert.equal(f.calls.provider.length,0);assert.equal(f.calls.claims,1);
  const replay=await f.run();assert.equal(replay.status,200);assert.equal((await replay.json()).enriched[0].email,contact.email);assert.equal(f.calls.claims,1);
});
test('cached email and missing phone request only writable phone fallback; different email never marks cached address verified',async()=>{
  const f=fixture({cache:{...contact,mobile:null},providerEmail:'other@demo.test',pending:true});
  const response=await f.run();assert.equal(response.status,202);const body=await response.json();
  assert.equal(f.calls.provider.length,1);assert.equal(f.calls.provider[0].revealPhone,true);assert.equal(f.calls.provider[0].revealEmail,true,'observe email during fallback');
  assert.deepEqual(f.callbacks[0].requestedFields,['person.phone_numbers']);assert.equal(body.enriched[0].email,contact.email);assert.equal(body.enriched[0].emailStatus,'unknown');
  assert.equal(body.enriched[0].enrichmentStatus,'pending_phone');assert.equal(body.usage.consumed,1);
});
test('known Apollo failure preserves the cached email instead of turning a partial success into no data',async()=>{
  const f=fixture({cache:{...contact,mobile:null},fail:true});const response=await f.run();assert.equal(response.status,200);
  const body=await response.json();assert.equal(body.enriched[0].email,contact.email);assert.equal(f.calls.claims,1);assert.equal(f.calls.provider.length,1);
});
test('the organization Apollo share counts only what Apollo is asked: a full cache costs nothing, a missing phone costs 8',async()=>{
  const cached=fixture();assert.equal((await cached.run()).status,200);assert.deepEqual(cached.calls.share,[0]);
  const phone=fixture({cache:{...contact,mobile:null},pending:true});assert.equal((await phone.run()).status,202);assert.deepEqual(phone.calls.share,[8]);
  const none=fixture({cache:null,pending:true});await none.run();assert.deepEqual(none.calls.share,[8],'email and mobile together cost 8 (audit T5)');
});
test('a used organization share is said as it is, before any credit is claimed or Apollo is asked',async()=>{
  const message='Tu organización ya usó los 300 créditos de Apollo que tiene hasta el 1 de noviembre.';
  const f=fixture({cache:null,shareUsed:message});const response=await f.run();assert.equal(response.status,409);
  assert.deepEqual(await response.json(),{error:'APOLLO_CREDITS_ALLOCATION_USED',message});
  assert.equal(f.calls.claims,0);assert.equal(f.calls.provider.length,0);assert.equal(f.callbacks.length,0);
  const cached=fixture({shareUsed:message});assert.equal((await cached.run()).status,200,'what the cache already holds is still delivered');
});

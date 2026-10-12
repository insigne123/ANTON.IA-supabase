import { normalizeDomain } from '@/lib/domain';
import { normalizeLinkedinProfileUrl } from '@/lib/linkedin-url';
import { encryptStoredToken, decryptStoredToken } from '@/lib/server/token-crypto';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { hybridEnabled, residualFields, type CachedContact, type ApolloIdentity } from './contracts';
import { readCachedContact } from './search';
import { settleApolloEnrichmentCallback } from '@/lib/server/apollo-enrichment-callbacks';
type Db={from(table:string):any;rpc(name:string,body:Record<string,unknown>):any};
type Scope={organizationId:string;userId:string};
type Lead={clientRef?:string;existingRecordId?:string;sourceProviderId?:string;source_provider_id?:string;apolloId?:string;id?:string};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type HybridHint={identity:ApolloIdentity;contact:CachedContact};
export async function findHybridHint(scope:Scope,lead:Lead,db:Db=getSupabaseAdminClient() as any):Promise<HybridHint|null> {
  if(!hybridEnabled())return null;
  let row:any,observed:any;
  if(lead.existingRecordId&&uuid.test(lead.existingRecordId)){
    const result=await db.from('enriched_leads').select('source_provider,source_provider_id,full_name,linkedin_url,title,organization_domain,data,enrichment_status')
      .eq('id',lead.existingRecordId).eq('organization_id',scope.organizationId).eq('user_id',scope.userId).maybeSingle();
    if(result.error||!result.data||result.data.source_provider!=='apollo'||result.data.enrichment_status==='suppressed')return null;
    row=result.data;
  }else if(lead.clientRef&&uuid.test(lead.clientRef)){
    const result=await db.from('leads').select('source_provider,source_provider_id,apollo_id,name,linkedin_url,title,company_website')
      .eq('id',lead.clientRef).eq('organization_id',scope.organizationId).eq('user_id',scope.userId).maybeSingle();
    if(result.error||!result.data||result.data.source_provider!=='apollo')return null;row=result.data;
  }
  const id=String(row?.source_provider_id||row?.apollo_id||lead.sourceProviderId||lead.source_provider_id||lead.apolloId||'');
  if(!id||id.startsWith('lf_'))return null;
  const requested=lead.sourceProviderId||lead.source_provider_id||lead.apolloId;
  if(row&&requested&&id!==requested)throw Error('APOLLO_PERSON_IDENTITY_MISMATCH');
  const observation=await db.from('apollo_search_observations').select('company_domain,identity').eq('organization_id',scope.organizationId)
    .eq('user_id',scope.userId).eq('apollo_person_id',id).gt('expires_at',new Date().toISOString()).maybeSingle();
  if(!observation.error)observed=observation.data;
  if(!observed)return null;
  // Neither incoming fields nor user-editable persisted name/profile fields can
  // associate a known Apollo id with a different cached person.
  const domain=normalizeDomain(observed.company_domain||'');
  if(!domain)return null;
  const rowDomain=normalizeDomain(row?.organization_domain||row?.data?.companyDomain||row?.company_website||'');
  if(rowDomain&&rowDomain!==domain)return null;
  const identity:ApolloIdentity={id,domain,fullName:observed.identity?.fullName||'',
    linkedinUrl:normalizeLinkedinProfileUrl(observed.identity?.linkedinUrl||''),title:observed.identity?.title||''};
  const contact=await readCachedContact(scope,identity,db);
  if(contact?.email){const suppression=await db.rpc('has_apollo_enrichment_email_suppression_v1',{
    p_user_id:scope.userId,p_organization_id:scope.organizationId,p_emails:[contact.email]});
    if(suppression.error)throw Error('HYBRID_PRIVACY_UNAVAILABLE');
    if(suppression.data===true)throw Error('ENRICHMENT_TARGET_SUPPRESSED');}
  return contact?{identity,contact}:null;
}
export type HybridScope=Scope&{resource:'enrich'|'investigate';operationId:string;claimToken:string};
export async function frozenHybridItems(scope:Omit<HybridScope,'claimToken'>,db:Db=getSupabaseAdminClient() as any):Promise<Array<{targetId:string;clientRef:string;hint:HybridHint}>> {
  const result=await db.from('hybrid_enrichment_items').select('target_id,client_ref,plan_encrypted,apollo_person_id')
    .eq('organization_id',scope.organizationId).eq('user_id',scope.userId).eq('resource',scope.resource).eq('operation_id',scope.operationId);
  if(result.error)throw Error('HYBRID_PLAN_UNAVAILABLE');
  return (result.data||[]).map((row:any)=>{
    const plain=decryptStoredToken(row.plan_encrypted);if(!plain)throw Error('HYBRID_PLAN_UNAVAILABLE');
    const decoded=JSON.parse(plain);if(decoded.v!==1||decoded.hint?.identity?.id!==row.apollo_person_id)throw Error('HYBRID_PLAN_UNAVAILABLE');
    return {targetId:String(row.target_id),clientRef:String(row.client_ref||''),hint:decoded.hint as HybridHint};
  });
}
function params(scope:HybridScope){return {p_org:scope.organizationId,p_user:scope.userId,p_resource:scope.resource,p_operation:scope.operationId,p_claim:scope.claimToken};}
export async function registerHybridItem(scope:HybridScope,target:{id:string;clientRef?:string;sourceProviderId?:string},hint:HybridHint,
  requested:{email:boolean;phone:boolean},db:Db=getSupabaseAdminClient() as any) {
  const encrypted=encryptStoredToken(JSON.stringify({v:1,hint,requested}));
  if(!encrypted.startsWith('enc:v1.')||encrypted.length>16000)throw Error('HYBRID_PLAN_UNAVAILABLE');
  const result=await db.rpc('register_hybrid_enrichment_item_v1',{...params(scope),p_target:target.id,p_client_ref:target.clientRef||null,
    p_person:target.sourceProviderId,p_email:requested.email,p_phone:requested.phone,p_plan:encrypted});
  if(result.error||result.data!==true)throw Error('HYBRID_PLAN_UNAVAILABLE');
}
export async function applyHybridCache(scope:HybridScope,targetId:string,hint:HybridHint,db:Db=getSupabaseAdminClient() as any) {
  const result=await db.rpc('apply_hybrid_cached_fields_v1',{...params(scope),p_target:targetId,p_candidate:{...hint.contact,observedAt:new Date().toISOString()}});
  if(result.error||!['processed','replay','suppressed'].includes(result.data?.outcome))throw Error('HYBRID_CACHE_UNAVAILABLE');
  return result.data.cacheProcessed===true;
}
export function hybridFieldPlan(requested:{email:boolean;phone:boolean},row:Record<string,any>,hint:HybridHint) {
  return residualFields(requested,{email:row.email||null,phone:row.primary_phone||row.phone_numbers?.[0]?.sanitized_number||null},hint.contact);
}
export async function cancelHybridItems(scope:HybridScope,db:Db=getSupabaseAdminClient() as any) {
  const result=await db.from('hybrid_enrichment_items').update({state:'cancelled'}).eq('organization_id',scope.organizationId)
    .eq('user_id',scope.userId).eq('resource',scope.resource).eq('operation_id',scope.operationId).eq('state','planned');
  if(result.error)throw Error('HYBRID_PLAN_CANCEL_UNAVAILABLE');
}
export async function settleHybrid(scope:Omit<HybridScope,'claimToken'>,db:Db=getSupabaseAdminClient() as any) {
  const result=await db.rpc('settle_hybrid_enrichment_operation_v1',{p_org:scope.organizationId,p_user:scope.userId,p_resource:scope.resource,p_operation:scope.operationId});
  if(result.error)throw Error('HYBRID_SETTLEMENT_UNAVAILABLE');return result.data===true;
}

/** Resume only local fulfillment after a lost HTTP process. No Apollo/Apify POST
 * is ever replayed. Unsubmitted fallback callbacks are cancelled, posted ones
 * keep using the existing reconciliation worker. */
export async function recoverHybridFulfillment(db:Db=getSupabaseAdminClient() as any) {
  if(!hybridEnabled())return {recovered:0};
  const cutoff=new Date(Date.now()-15*60000).toISOString();
  const result=await db.from('hybrid_enrichment_items').select('*,antonia_quota_operations!inner(claim_token,status,submitted_at)')
    .eq('antonia_quota_operations.status','submitted').lt('antonia_quota_operations.submitted_at',cutoff).limit(25);
  if(result.error)throw Error('HYBRID_RECOVERY_UNAVAILABLE');
  const operations=new Map<string,HybridScope>();let recovered=0;
  for(const item of result.data||[]){
    const op=item.antonia_quota_operations;if(!op?.claim_token)continue;
    const scope:HybridScope={organizationId:item.organization_id,userId:item.user_id,resource:item.resource,
      operationId:item.operation_id,claimToken:op.claim_token};
    try{
      const plain=decryptStoredToken(item.plan_encrypted);if(!plain)throw Error();const plan=JSON.parse(plain);
      if(plan.v!==1||plan.hint?.identity?.id!==item.apollo_person_id)throw Error();
      await applyHybridCache(scope,item.target_id,plan.hint,db);recovered++;
    }catch{await db.from('hybrid_enrichment_items').update({state:'cancelled'}).eq('organization_id',scope.organizationId)
      .eq('user_id',scope.userId).eq('resource',scope.resource).eq('operation_id',scope.operationId).eq('target_id',item.target_id).eq('state','planned');}
    operations.set(JSON.stringify([scope.organizationId,scope.userId,scope.resource,scope.operationId]),scope);
  }
  for(const scope of operations.values()){
    const callbacks=await db.from('apollo_enrichment_callbacks').select('id').eq('organization_id',scope.organizationId)
      .eq('user_id',scope.userId).eq('quota_resource',scope.resource).eq('operation_id',scope.operationId).is('provider_queued_at',null).neq('status','terminal');
    if(callbacks.error)continue;
    for(const callback of callbacks.data||[])await settleApolloEnrichmentCallback({callbackId:callback.id,terminalState:'cancelled',errorCode:'hybrid_http_recovered'},db as any);
    await settleHybrid(scope,db);
  }
  return {recovered};
}

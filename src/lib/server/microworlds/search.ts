import { encryptStoredToken, decryptStoredToken } from '@/lib/server/token-crypto';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { normalizeLinkedinProfileUrl } from '@/lib/linkedin-url';
import { createHash } from 'node:crypto';
import { cacheHash, contactFromMicroworlds, chooseCachedContact, hybridEnabled, mirrorCriteria,
  mirrorFingerprint, microworldsInput, MICROWORLDS_ACTOR, MICROWORLDS_RUN_USD, type MirrorCriteria,
  type CachedContact, type ApolloIdentity } from './contracts';

type Db = {from(table:string):any;rpc(name:string,body:Record<string,unknown>):any};
type Job = {id:string;organization_id:string;company_domain:string;criteria:MirrorCriteria;status:string;
  claim_token:string;provider_run_id:string|null;created_at:string;expires_at:string;lease_until:string};
const now=()=>new Date().toISOString();
/** Bounded short RPCs only, never await an actor from the visible search. */
export async function enqueueMirror(input:{organizationId:string;userId:string;criteria:MirrorCriteria;identities:ApolloIdentity[]},db:Db=getSupabaseAdminClient() as any) {
  if(!hybridEnabled())return null;
  const criteria=mirrorCriteria(input.criteria);
  const rows=input.identities.filter(identity=>identity.id&&identity.domain===criteria.domain).map(identity=>({
    id:identity.id,fullName:identity.fullName||'',linkedinUrl:normalizeLinkedinProfileUrl(identity.linkedinUrl)||null,title:identity.title||'',
  }));
  if(rows.length){const stored=await db.rpc('record_apollo_search_observations_v1',{p_org:input.organizationId,p_user:input.userId,p_domain:criteria.domain,p_rows:rows,p_confirmed:false});
    if(stored.error)throw Error('MIRROR_OBSERVATION_UNAVAILABLE');}
  const {data,error}=await db.rpc('enqueue_microworlds_search_v1',{p_org:input.organizationId,p_user:input.userId,
    p_fingerprint:mirrorFingerprint(criteria),p_domain:criteria.domain,p_criteria:criteria});
  if(error)throw Error('MIRROR_QUEUE_UNAVAILABLE');return data?.id?String(data.id):null;
}

export async function observeConfirmedApolloIdentity(scope:{organizationId:string;userId:string},identity:ApolloIdentity,db:Db=getSupabaseAdminClient() as any) {
  if(!hybridEnabled()||!identity.id||!identity.domain||!identity.linkedinUrl)return;
  const result=await db.rpc('record_apollo_search_observations_v1',{p_org:scope.organizationId,p_user:scope.userId,p_domain:identity.domain,
    p_rows:[{id:identity.id,fullName:identity.fullName||'',linkedinUrl:normalizeLinkedinProfileUrl(identity.linkedinUrl),title:identity.title||''}],p_confirmed:true});
  if(result.error)throw Error('HYBRID_IDENTITY_OBSERVATION_UNAVAILABLE');
}

class ActorError extends Error {constructor(readonly status:number,readonly rejected:boolean){super('MICROWORLDS_HTTP_'+status);}}
async function actorRequest(path:string,options:{body?:unknown;fetch?:typeof fetch;token?:string}={}) {
  const token=options.token||process.env.APIFY_TOKEN;if(!token)throw new ActorError(503,true);
  if(!path.startsWith('/v2/'))throw Error('ACTOR_PATH');
  const res=await (options.fetch||fetch)('https://api.apify.com'+path,{method:options.body?'POST':'GET',
    headers:{authorization:'Bearer '+token,...(options.body?{'content-type':'application/json'}:{})},
    ...(options.body?{body:JSON.stringify(options.body)}:{}),redirect:'error',signal:AbortSignal.timeout(20000)});
  const data=await res.json().catch(()=>null);
  if(!res.ok){const code=data?.error?.type;const rejected=[401,402,403,404,429].includes(res.status)
    ||res.status===400&&typeof code==='string'&&(code.startsWith('invalid-')||code==='max-total-charge-usd-below-minimum');
    throw new ActorError(res.status,rejected);}
  if(data===null)throw Error('MICROWORLDS_INVALID_RESPONSE');return data;
}
async function finishJob(db:Db,job:Job,status:'completed'|'failed'|'unknown',billed:number|null,fetched=0,error?:string) {
  const result=await db.rpc('finish_microworlds_search_v1',{p_id:job.id,p_claim:job.claim_token,p_status:status,
    p_billed:billed===null?null:Math.ceil(billed*1000000),p_fetched:fetched,p_error:error||null});
  if(result.error||result.data!==true)throw Error('MIRROR_LEASE_LOST');
}
/** A worker tick starts once or polls an existing run. Never waits for completion,
 * never re-POSTs a submitting/unknown job, never logs provider messages/contacts. */
export async function runMirrorWorker(input:{id?:string;limit?:number;db?:Db;fetch?:typeof fetch;token?:string}={}) {
  if(!hybridEnabled())return {processed:0,skipped:true};
  const db=input.db||getSupabaseAdminClient() as any;let processed=0;
  const maintained=await db.rpc('maintain_microworlds_jobs_v1',{});if(maintained.error)throw Error('MIRROR_MAINTENANCE_UNAVAILABLE');
  for(let i=0;i<Math.min(5,Math.max(1,input.limit||1));i++) {
    const claim=await db.rpc('claim_microworlds_search_v1',{p_id:input.id||null});
    if(claim.error)throw Error('MIRROR_CLAIM_UNAVAILABLE');const job=claim.data as Job|null;if(!job)break;
    const http=(path:string,body?:unknown)=>actorRequest(path,{body,fetch:input.fetch,token:input.token});
    try {
      if(job.status==='submitting') {
        const criteria=mirrorCriteria(job.criteria);if(criteria.domain!==job.company_domain)throw new ActorError(400,true);
        const q=new URLSearchParams({timeout:'600',memory:'512',maxItems:'100',maxTotalChargeUsd:String(MICROWORLDS_RUN_USD),
          restartOnError:'false',forcePermissionLevel:'LIMITED_PERMISSIONS'});
        const created=(await http('/v2/acts/'+MICROWORLDS_ACTOR+'/runs?'+q,{...microworldsInput(criteria),file_name:'ANTON-mirror-'+job.id})).data;
        if(!created?.id||created.actId!=='heLL6fUofdPgRXZie')throw Error('MIRROR_RUN_IDENTITY_MISMATCH');
        const recorded=await db.rpc('record_microworlds_run_v1',{p_id:job.id,p_claim:job.claim_token,p_run:created.id});
        if(recorded.error||recorded.data!==true)throw Error('MIRROR_RUN_BIND_FAILED');
      }else{
        const run=(await http('/v2/actor-runs/'+encodeURIComponent(job.provider_run_id!))).data;
        if(run?.id!==job.provider_run_id||run?.actId!=='heLL6fUofdPgRXZie')throw Error('MIRROR_RUN_IDENTITY_MISMATCH');
        if(!['SUCCEEDED','FAILED','TIMED-OUT','ABORTED'].includes(run.status)){processed++;continue;}
        // Receipts can be preliminary immediately after a terminal run.
        if(Date.now()-Date.parse(run.finishedAt||'')<15000){processed++;continue;}
        if(typeof run.usageTotalUsd!=='number'||!Number.isFinite(run.usageTotalUsd)||run.usageTotalUsd<0) {
          await finishJob(db,job,'unknown',null,0,'MIRROR_RECEIPT_UNAVAILABLE');processed++;continue;
        }
        const items=await http('/v2/actor-runs/'+encodeURIComponent(job.provider_run_id!)+'/dataset/items?clean=true&format=json&limit=100&offset=0');
        if(!Array.isArray(items)||items.length>100)throw Error('MIRROR_INVALID_DATASET');
        const entries=items.flatMap(item=>{const parsed=contactFromMicroworlds(item,job.company_domain);return parsed?[parsed]:[];});
        const seen=new Set<string>(),observed=now(),expires=new Date(Date.now()+30*86400000).toISOString();
        const rows=entries.flatMap(contact=>{
          const key=cacheHash('contact',contact.linkedinUrl||contact.fullName+'|'+contact.domain,job.organization_id);
          if(seen.has(key))return [];seen.add(key);
          const encrypted=encryptStoredToken(JSON.stringify({v:1,contact}));
          if(!encrypted.startsWith('enc:v1.')||encrypted.length>16000)throw Error('MIRROR_ENCRYPTION_UNAVAILABLE');
          return [{organization_id:job.organization_id,contact_key:key,job_id:job.id,company_domain:contact.domain,
            profile_hash:contact.linkedinUrl?cacheHash('profile',contact.linkedinUrl,job.organization_id):null,
            email_subject_hash:contact.email?createHash('sha256').update(contact.email).digest('hex'):null,
            full_name_hash:cacheHash('name',contact.fullName,job.organization_id),contact_encrypted:encrypted,observed_at:observed,expires_at:expires}];
        });
        if(rows.length){const stored=await db.rpc('publish_microworlds_contacts_v1',{p_id:job.id,p_claim:job.claim_token,
          p_rows:rows});
          if(stored.error)throw Error('MIRROR_CACHE_WRITE_FAILED');}
        await finishJob(db,job,run.status==='SUCCEEDED'?'completed':'failed',run.usageTotalUsd,entries.length,
          run.status==='SUCCEEDED'?undefined:'MIRROR_PROVIDER_TERMINAL');
      }
      processed++;
    }catch(error){
      // A definite pre-start rejection is safe to release. Every other start
      // failure keeps the USD reservation; it is never replayed as a new run.
      if(job.status==='submitting')await finishJob(db,job,error instanceof ActorError&&error.rejected?'failed':'unknown',
        error instanceof ActorError&&error.rejected?0:null,0,'MIRROR_START_UNAVAILABLE').catch(()=>undefined);
      // Poll/import failures release the lease naturally and retry GET only.
      console.warn('[mirror] job deferred',{code:'MIRROR_WORK_UNAVAILABLE',jobId:job.id});
    }
  }
  return {processed,skipped:false};
}

/** Cache authority is an actual server observation or an owned persisted lead,
 * not client-supplied name/profile fields. Matching is scoped to company + tenant. */
export async function readCachedContact(scope:{organizationId:string;userId:string},identity:ApolloIdentity,db:Db=getSupabaseAdminClient() as any) {
  if(!hybridEnabled())return null;
  let query=db.from('microworlds_contact_cache').select('contact_encrypted').eq('organization_id',scope.organizationId)
    .eq('company_domain',identity.domain).gt('expires_at',now());
  if(identity.linkedinUrl)query=query.eq('profile_hash',cacheHash('profile',normalizeLinkedinProfileUrl(identity.linkedinUrl)||'',scope.organizationId));
  else if(identity.fullName)query=query.eq('full_name_hash',cacheHash('name',identity.fullName,scope.organizationId));
  else return null;
  const result=await query.limit(3);if(result.error)return null;
  const contacts:CachedContact[]=[];
  for(const row of result.data||[])try{const plain=decryptStoredToken(row.contact_encrypted);if(!plain)continue;
    const decoded=JSON.parse(plain);if(decoded.v===1&&decoded.contact)contacts.push(decoded.contact);}catch{}
  return chooseCachedContact(identity,contacts);
}

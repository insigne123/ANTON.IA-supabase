import { readCachedAuthScope } from './auth-scope-cache';
/** Keep a pending operation identity through uncertain HTTP responses and reloads.
 * Storage contains only opaque ids and field flags, never contact data or tokens. */
export async function enrichmentAttempt(provider:string,leads:Array<{id:string}>,fields:{revealEmail:boolean;revealPhone:boolean}) {
  const scope=readCachedAuthScope();
  const identity=JSON.stringify({v:1,scope,provider,ids:leads.map(l=>l.id).sort(),email:fields.revealEmail,phone:fields.revealPhone});
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(identity))),b=>b.toString(16).padStart(2,'0')).join('');
  const key='antonia:enrichment-attempt:'+hash;
  let id:string|undefined;
  try{const prior=JSON.parse(sessionStorage.getItem(key)||'null');if(prior?.id&&Date.now()-prior.at<24*3600000)id=prior.id;}catch{}
  id=id||crypto.randomUUID();
  try{sessionStorage.setItem(key,JSON.stringify({id,at:Date.now()}));}catch{}
  return {id,headers:{'Content-Type':'application/json','Idempotency-Key':id,...(scope?.organizationId?{'x-organization-id':scope.organizationId}:{})},
    complete:()=>{try{sessionStorage.removeItem(key);}catch{}}};
}

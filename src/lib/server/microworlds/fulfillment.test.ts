import assert from 'node:assert/strict';
import test from 'node:test';
import {findHybridHint} from './fulfillment';
import {cacheHash} from './contracts';
import {encryptStoredToken} from '@/lib/server/token-crypto';
function environment(t:{after:(fn:()=>void)=>void}){const names={MICROWORLDS_HYBRID_ENABLED:'true',INTERNAL_API_SECRET:'unit-key',SUPABASE_SERVICE_ROLE_KEY:'unit-encryption'};
  for(const [key,value] of Object.entries(names)){const prior=process.env[key];process.env[key]=value;t.after(()=>{if(prior===undefined)delete process.env[key];else process.env[key]=prior;});}}
function fixture(options:{masked?:boolean;suppressed?:boolean}={}){
  const contact={fullName:'Ana Pérez',firstName:'Ana',lastName:'Pérez',domain:'demo.test',linkedinUrl:'https://www.linkedin.com/in/ana-demo',
    title:'CEO',email:'ana@demo.test',emailStatus:'unknown',mobile:'+56912345678'};
  const tables:Record<string,any[]>={
    apollo_search_observations:[{organization_id:'org',user_id:'me',apollo_person_id:'apollo-ana',company_domain:'demo.test',identity:{
      fullName:options.masked?'Ana Pe***z':'Ana Pérez',title:'CEO',linkedinUrl:options.masked?null:contact.linkedinUrl}}],
    microworlds_contact_cache:[{organization_id:'org',company_domain:'demo.test',profile_hash:cacheHash('profile',contact.linkedinUrl,'org'),
      full_name_hash:cacheHash('name',contact.fullName,'org'),contact_encrypted:encryptStoredToken(JSON.stringify({v:1,contact}))}],
  };
  const db:any={rpc:async()=>({data:options.suppressed||false}),from(table:string){const filters:Array<[string,unknown]>=[];const chain:any={
    select:()=>chain,eq:(k:string,v:any)=>{filters.push([k,v]);return chain;},gt:()=>chain,limit:()=>chain,
    maybeSingle:async()=>({data:(tables[table]||[]).filter(row=>filters.every(([k,v])=>row[k]===v))[0]||null}),
    then:(resolve:any)=>Promise.resolve({data:(tables[table]||[]).filter(row=>filters.every(([k,v])=>row[k]===v))}).then(resolve),
  };return chain;}};return db;
}
test('cache authority comes from the authenticated server observation, not incoming name/domain/profile',async t=>{
  environment(t);const db=fixture();
  const hint=await findHybridHint({organizationId:'org',userId:'me'},{sourceProviderId:'apollo-ana',...{fullName:'Someone else',linkedinUrl:'https://linkedin.com/in/other',companyDomain:'foreign.test'}},db);
  assert.equal(hint?.identity.fullName,'Ana Pérez');assert.equal(hint?.contact.email,'ana@demo.test');
  assert.equal(await findHybridHint({organizationId:'foreign',userId:'me'},{sourceProviderId:'apollo-ana'},db),null);
  assert.equal(await findHybridHint({organizationId:'org',userId:'other'},{sourceProviderId:'apollo-ana'},db),null);
});
test('masked identity cannot be guessed; suppressed cached email blocks phone-only reuse too',async t=>{
  environment(t);assert.equal(await findHybridHint({organizationId:'org',userId:'me'},{sourceProviderId:'apollo-ana'},fixture({masked:true})),null);
  await assert.rejects(findHybridHint({organizationId:'org',userId:'me'},{sourceProviderId:'apollo-ana'},fixture({suppressed:true})),/ENRICHMENT_TARGET_SUPPRESSED/);
});

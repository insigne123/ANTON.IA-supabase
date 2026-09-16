import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
const id='00000000-0000-4000-8000-000000000001';
const fixture={observed:true,revoked:false,calls:[]}; globalThis.__researchFixture=fixture;
const mocks={
  './runs':`export const getCoworkRun=async()=>({run:{status:'completed'},events:globalThis.__researchFixture.observed?[{kind:'tool.completed',payload:{action:'leads.get',result:{scope:'own_saved_contacts',items:[{id:'${id}'}]}}}]:[]});`,
  '@/lib/server/native-research':`export const enqueueNativeResearch=async input=>{globalThis.__researchFixture.calls.push(input);return {reportId:'native:test',status:'queued',reused:true};};export const findNativeResearchJob=async()=>null;`,
  './access':'export const requireCoworkWorkerAccess=async()=>{if(globalThis.__researchFixture.revoked)throw new Error("revoked")};',
  '@/lib/server/supabase-admin':'export const getSupabaseAdminClient=()=>({});',
};
const bundle=await build({entryPoints:['src/lib/server/cowork/start-research.ts'],bundle:true,write:false,platform:'node',format:'cjs',packages:'external',plugins:[{name:'fixtures',setup(build){
  build.onResolve({filter:/.*/},args=>mocks[args.path]?{path:args.path,namespace:'fixture'}:undefined);
  build.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mocks[args.path]}));
}}]});
const module={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
const filters=[];
const auth={user:{id:'owner'},organizationId:'org',supabase:{from(){const where={};filters.push(where);const q={select:()=>q,eq:(k,v)=>{where[k]=v;return q;},maybeSingle:async()=>({data:{id,name:'Ana',company:'Empresa',email:null},error:null})};return q;}}};
try{
  fixture.observed=false;await assert.rejects(module.exports.startCoworkResearch(auth,'run',id),/UNAVAILABLE/);assert.equal(fixture.calls.length,0);
  fixture.observed=true;fixture.revoked=true;await assert.rejects(module.exports.startCoworkResearch(auth,'run',id),/revoked/);assert.equal(fixture.calls.length,0);
  fixture.revoked=false;await module.exports.startCoworkResearch(auth,'run',id);await module.exports.startCoworkResearch(auth,'run',id);
  assert.equal(fixture.calls[0].requestIdempotencyKey,fixture.calls[1].requestIdempotencyKey);
  assert.equal(fixture.calls[0].lead.email,null);assert.equal(fixture.calls[0].options.refresh,false);
  assert.deepEqual(fixture.calls[0].access,{userId:'owner',organizationId:'org'});
  assert.ok(filters.every(f=>f.user_id==='owner'&&f.organization_id==='org'));
  console.log('PASS: observed target, owner/org scope, fresh access, stable research identity, no forced refresh and no email prerequisite.');
}finally{delete globalThis.__researchFixture;}

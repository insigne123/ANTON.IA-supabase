import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
const state={ observed:true, saved:null, writes:0, queries:[] }; globalThis.__coworkSave=state;
const bundle=await build({entryPoints:['src/lib/server/cowork/save-contact.ts'],bundle:true,write:false,platform:'node',format:'cjs',packages:'external',plugins:[{name:'fixture',setup(build){
  build.onResolve({filter:/^\.\/runs$/},()=>({path:'runs',namespace:'fixture'}));
  build.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`export const getCoworkRun=async()=>({run:{status:'completed'},events:globalThis.__coworkSave.observed?[{kind:'tool.completed',payload:{action:'prospecting.search',result:{scope:'external_search',items:[{id:'apollo:test-1',name:'Ana',company:'Empresa',email:'unsafe@example.com'}]}}}]:[]});`}));
}}]});
const module={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
const auth={user:{id:'owner'},organizationId:'org',supabase:{from(table){assert.equal(table,'leads');const filters={};state.queries.push(filters);const q={
  select:()=>q,eq:(key,value)=>{filters[key]=value;return q;},order:()=>q,limit:()=>q,
  maybeSingle:async()=>({data:state.saved,error:null}),single:async()=>({data:state.saved,error:null}),
  upsert:async(row,options)=>{assert.equal(options.ignoreDuplicates,true);state.writes++;state.saved=row;return {error:null};},
};return q;}}};
try{
  state.observed=false;await assert.rejects(module.exports.saveCoworkContact(auth,'run',{providerId:'apollo:test-1'}),/NOT_OBSERVED/);assert.equal(state.writes,0);
  state.observed=true;
  const first=await module.exports.saveCoworkContact(auth,'run',{providerId:'apollo:test-1'});
  assert.equal(first.lead.email,null);assert.equal(first.lead.source_provider_id,'test-1');
  state.saved.name='Edited by user';
  const repeat=await module.exports.saveCoworkContact(auth,'run',{providerId:'apollo:test-1'});
  assert.equal(repeat.lead.id,first.lead.id);assert.equal(repeat.lead.name,'Edited by user');assert.equal(state.writes,1);
  await assert.rejects(module.exports.saveCoworkContact(auth,'run',{providerId:'apollo:test-1',name:'forged'}));
  assert.ok(state.queries.filter(q=>Object.keys(q).length).every(q=>q.organization_id==='org'&&q.user_id==='owner'));
  console.log('PASS: observed provider record only, no client payload override, no email claim, scoped lookup and retries preserve existing edits.');
}finally{delete globalThis.__coworkSave;}

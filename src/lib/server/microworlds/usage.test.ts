import assert from 'node:assert/strict';
import test from 'node:test';
import { mirrorUsage } from './usage';
function db(tables:Record<string,any[]>){const filters:any[]=[];return {filters,value:{from:(table:string)=>{const builder:any={};
  for(const method of ['select','eq','not','gte','lt','limit'])builder[method]=(...args:any[])=>{filters.push([table,method,...args]);return builder;};
  builder.then=(resolve:any)=>resolve({data:tables[table]||[],error:null});return builder;}}};}
test('the month weighs what Apify billed against the contacts the cache served instead of Apollo',async()=>{
  const fixture=db({microworlds_search_jobs:[{billed_micro_usd:70000,fetched:20},{billed_micro_usd:330000,fetched:100}],
    hybrid_enrichment_items:[{requested_phone:true},{requested_phone:false},{requested_phone:false},{requested_phone:false}]});
  assert.deepEqual(await mirrorUsage('2026-10',fixture.value),{period:'2026-10',runs:2,spentUsd:0.4,leadsBought:120,
    contactsFromCache:4,withPhoneFromCache:1,usdPerCachedContact:0.1});
  assert.ok(fixture.filters.some(f=>f[0]==='hybrid_enrichment_items'&&f[1]==='lt'&&f[3]==='2026-11-01T00:00:00.000Z'));
  assert.equal((await mirrorUsage('2026-12',db({}).value)).usdPerCachedContact,null);
  await assert.rejects(mirrorUsage('2026-13',db({}).value));
});

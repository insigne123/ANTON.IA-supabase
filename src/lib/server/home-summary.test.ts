import assert from 'node:assert/strict';import test from 'node:test';
import {loadHomeSummary} from './home-summary';
function client(tables:Record<string,any[]>,fail=''){return {from(table:string){const filters:Array<(row:any)=>boolean>=[];let head=false;const b:any={
  select(_c:string,o:any){head=o?.head;return b;},eq(k:string,v:any){filters.push(r=>r[k]===v);return b;},gte(k:string,v:string){filters.push(r=>r[k]&&Date.parse(r[k])>=Date.parse(v));return b;},lt(k:string,v:string){filters.push(r=>r[k]&&Date.parse(r[k])<Date.parse(v));return b;},order(){return b;},
  range(a:number,z:number){return Promise.resolve({data:(tables[table]||[]).filter(r=>filters.every(f=>f(r))).slice(a,z+1),error:table===fail?{}:null});},
  then(resolve:any){const rows=(tables[table]||[]).filter(r=>filters.every(f=>f(r)));return Promise.resolve({data:head?null:rows,count:rows.length,error:table===fail?{}:null}).then(resolve);}};return b;}} as never;}
const owner={organization_id:'org',user_id:'me'},now=new Date('2026-10-10T12:00:00Z');
const sent=(id:string,email:string,extra:any={})=>({...owner,id,status:'sent',channel:'email',completed_at:'2026-10-10T04:00:00Z',metadata:{recipient:{email}},...extra});
test('today is personal in every organization; imported history is not a confirmed app send',async()=>{
  const data=await loadHomeSummary(client({outbound_dispatches:[sent('a','a@test'),sent('b','a@test'),sent('foreign','other@test',{user_id:'other'}),sent('tenant','other@test',{organization_id:'other'}),sent('failed','x@test',{status:'failed'}),sent('late','z@test',{reconciliation_details:{sentAt:'2026-10-09T04:00:00Z'}})],
    contacted_leads:[...Array.from({length:600},(_,i)=>({...owner,id:String(i),sent_at:'2026-03-01T12:00:00Z'})),{...owner,id:'reply',email:'a@test',replied_at:'2026-10-10T05:00:00Z',reply_intent:'positive'},{...owner,id:'auto',email:'b@test',replied_at:'2026-10-10T05:00:00Z',reply_intent:'auto_reply'},{...owner,id:'other',user_id:'other',email:'c@test',replied_at:'2026-10-10T05:00:00Z',reply_intent:'positive'}],
    leads:[{...owner,id:'save',created_at:'2026-10-10T04:00:00Z'},{...owner,id:'before',created_at:'2026-10-10T02:59:59Z'}]}),{organizationId:'org',userId:'me'},now);
  assert.equal(data.sent,2);assert.equal(data.contacted,1);assert.equal(data.replied,1);assert.equal(data.automaticReplies,1);assert.equal(data.saved,1);assert.equal(data.scope.from,'2026-10-10T03:00:00.000Z');
});
test('all pages are counted and an unavailable source never becomes a zero success',async()=>{
  const data=await loadHomeSummary(client({outbound_dispatches:Array.from({length:1001},(_,i)=>sent(String(i),`${i}@test`))}),{organizationId:'org',userId:'me'},now);assert.equal(data.sent,1001);
  await assert.rejects(loadHomeSummary(client({},'outbound_dispatches'),{organizationId:'org',userId:'me'},now));
});

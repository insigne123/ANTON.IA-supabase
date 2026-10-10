import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
const ORG='00000000-0000-4000-8000-000000000001',OTHER='00000000-0000-4000-8000-000000000002',USER='00000000-0000-4000-8000-000000000003',FOREIGN='00000000-0000-4000-8000-000000000004';
const state:any={};
class Query{
  filters:Array<(row:any)=>boolean>=[];sort:string[]=[];take=500;
  constructor(public table:string,public selectColumns=''){}
  select(value:string){this.selectColumns=value;return this;}
  eq(key:string,value:unknown){this.filters.push(row=>row[key]===value);return this;}
  in(key:string,values:unknown[]){this.filters.push(row=>values.includes(row[key]));return this;}
  gt(key:string,value:string){this.filters.push(row=>row[key]>value);return this;}
  order(key:string){this.sort.push(key);return this;}
  limit(n:number){this.take=n;return this;}
  maybeSingle(){return this.result().then(result=>({...result,data:result.data[0]||null}));}
  or(value:string){const match=/^([^.]*)\.gt\.([^,]*),and\(\1\.eq\.[^,]*,([^.]*)\.gt\.([^)]*)\)$/.exec(value);assert.ok(match);const [,one,a,two,b]=match;this.filters.push(row=>row[one]>a||row[one]===a&&row[two]>b);return this;}
  async result(){state.reads.push({table:this.table,columns:this.selectColumns});let data=(state.tables[this.table]||[]).filter((row:any)=>this.filters.every(f=>f(row)));
    data=[...data].sort((a:any,b:any)=>{for(const key of this.sort){const d=String(a[key]).localeCompare(String(b[key]));if(d)return d;}return 0;}).slice(0,this.take);return {data,error:null};}
  then(resolve:any,reject:any){return this.result().then(resolve,reject);}
}
const dependencies:Record<string,string>={
  'request-auth':`export class RequestAuthError extends Error{constructor(message,status){super(message);this.status=status}}
    export async function requireSessionRequestAuth(){if(!globalThis.__adminUsage.signedIn)throw new RequestAuthError('Unauthorized',401);return {user:globalThis.__adminUsage.user,supabase:globalThis.__adminUsage.client}}
    export function requestAuthErrorResponse(error){return error instanceof RequestAuthError?Response.json({error:'Unauthorized'},{status:error.status,headers:{'cache-control':'private, no-store'}}):null}`,
  'organization-context':`export const resolveActiveOrganization=async()=>({active:globalThis.__adminUsage.active?{organizationId:globalThis.__adminUsage.active}:null,memberships:[]});`,
  'server':`export const NextResponse={json:(value,init)=>Response.json(value,init)};`,
  'supabase-admin':`export const getSupabaseAdminClient=()=>globalThis.__adminUsage.client;`,
  'admin-dashboard-auth':`export class AdminDashboardAuthError extends Error{constructor(message,status){super(message);this.status=status}}`,
};
const result=await build({stdin:{contents:`export * from './src/lib/server/admin-usage-auth';export * from './src/lib/server/admin-usage-data';export {GET as reportGet} from './src/app/api/dashboard/admin/usage/route';export {POST as capturePost} from './src/app/api/usage/view/route';`,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'node',format:'cjs',packages:'external',plugins:[{name:'fixture-services',setup(builder){
  builder.onResolve({filter:/.*/},args=>{const key=args.path.split('/').at(-1)!;return dependencies[key]?{path:key,namespace:'fixture'}:undefined;});
  builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:dependencies[args.path],loader:'js'}));
}}]});
const compiled={exports:{} as any};new Function('require','module','exports',result.outputFiles[0].text)(createRequire(import.meta.url),compiled,compiled.exports);
const api=compiled.exports;
function reset(){
  Object.assign(state,{signedIn:true,active:ORG,user:{id:USER,email:'operator@example.test',email_confirmed_at:'2026-01-01'},reads:[],calls:[],missing:false,
    payload:{facts:[],credits:[],cohort:[],pending:[],captureFrom:'2026-08-01T00:00:00Z',journalFrom:'2026-08-01T00:00:00Z',legacyReplies:0},
    tables:{organizations:[{id:ORG,name:'Demo'},{id:OTHER,name:'Other'}],organization_members:[{organization_id:ORG,user_id:USER,role:'owner'},{organization_id:OTHER,user_id:FOREIGN,role:'owner'}],organization_reporting_groups:[],organization_reporting_group_members:[]}});
  state.client={from:(table:string)=>new Query(table),rpc:async(name:string,args:any)=>{
    state.calls.push({name,args});if(name==='admin_usage_member_names_v1')return {data:state.tables.organization_members.filter((m:any)=>args.p_orgs.includes(m.organization_id)).map((m:any)=>({id:m.user_id,name:'Persona',email:'person@example.test'})),error:null};
    if(name==='get_antonia_credit_status_v2')return {data:{count:3,limit:100,mode:'user',binding:'user'},error:null};
    return state.missing?{data:null,error:{code:'PGRST202'}}:{data:state.payload,error:null};
  }};(globalThis as any).__adminUsage=state;delete process.env.ADMIN_USAGE_PLATFORM_USER_IDS;
}
const q={from:'2026-09-01',to:'2026-09-30',horizon:14};
test('verified company role is required; user metadata and credit-operator email are not global permissions',async()=>{
  reset();state.signedIn=false;await assert.rejects(api.requireAdminUsageAccess(),(e:any)=>e.status===401);
  reset();state.tables.organization_members[0].role='member';state.user.user_metadata={role:'owner',admin:true};process.env.ADMIN_DASHBOARD_ALLOWED_EMAILS=state.user.email;
  await assert.rejects(api.requireAdminUsageAccess(),(e:any)=>e.status===403);
  delete process.env.ADMIN_DASHBOARD_ALLOWED_EMAILS;
  reset();state.user.email_confirmed_at=null;await assert.rejects(api.requireAdminUsageAccess(),(e:any)=>e.status===403);
});
test('company administrators cannot request all companies, a foreign company or a foreign person',async()=>{
  reset();const access=await api.requireAdminUsageAccess();assert.equal(access.platform,false);
  await assert.rejects(api.loadAdminUsage(access,{...q,organizationId:'all'}),(e:any)=>e.status===403);
  await assert.rejects(api.loadAdminUsage(access,{...q,organizationId:OTHER}),(e:any)=>e.status===403);
  await assert.rejects(api.loadAdminUsage(access,{...q,userId:FOREIGN}),(e:any)=>e.status===404);
  assert.ok(state.calls.every((call:any)=>!call.args.p_orgs?.includes(OTHER)));
});
test('explicit platform permission is separate and works without a company admin role',async()=>{
  reset();state.tables.organization_members[0].role='member';process.env.ADMIN_USAGE_PLATFORM_USER_IDS=USER;
  const access=await api.requireAdminUsageAccess();assert.equal(access.platform,true);assert.equal(access.organizationAdmin,false);
  const report=await api.loadAdminUsage(access,q,new Date('2026-10-01T00:00:00Z'));
  assert.equal(report.organizations.length,2);assert.equal(report.people.length,2);
  const call=state.calls.find((call:any)=>call.name==='admin_usage_report_v1');assert.deepEqual(call.args.p_orgs,[ORG,OTHER]);assert.equal(call.args.p_legacy,true);
  delete process.env.ADMIN_USAGE_PLATFORM_USER_IDS;
});
test('SQL scope drift fails closed and a missing measurement schema is not reported as zero usage',async()=>{
  reset();const access=await api.requireAdminUsageAccess();state.payload.facts=[{organizationId:OTHER,userId:FOREIGN,groupId:null,day:'2026-09-01',module:'email',kind:'module_opened',status:'observed',actor:'user',count:1,firstAt:'2026-09-01T00:00:00Z',lastAt:'2026-09-01T00:00:00Z'}];
  await assert.rejects(api.loadAdminUsage(access,q),(e:any)=>e.status===503);
  reset();state.missing=true;const report=await api.loadAdminUsage(await api.requireAdminUsageAccess(),q);
  assert.equal(report.ready,false);assert.deepEqual(report.coverage.unavailable,['measurement_setup']);assert.equal(report.people.length,1);
});
test('roster pagination includes every person and old-member history never reads an outside Auth identity',async()=>{
  reset();state.tables.organization_members=Array.from({length:1101},(_,i)=>({organization_id:ORG,user_id:`${(i+16).toString(16).padStart(8,'0')}-0000-4000-8000-000000000000`,role:'member'}));
  state.tables.organization_members.push({organization_id:ORG,user_id:USER,role:'owner'});
  state.payload.facts=[{organizationId:ORG,userId:FOREIGN,groupId:null,day:'2026-09-01',module:'email',kind:'contact_sent',status:'recorded',actor:'system',count:1,firstAt:'2026-09-01T00:00:00Z',lastAt:'2026-09-01T00:00:00Z'}];
  const report=await api.loadAdminUsage(await api.requireAdminUsageAccess(),q);
  assert.equal(report.people.length,1103);assert.equal(report.people.find((person:any)=>person.id===FOREIGN).member,false);
  assert.ok(state.reads.filter((read:any)=>read.table==='organization_members').length>=4);
});
test('HTTP reports are private, deny forged scope and never return a success response for expired auth',async()=>{
  reset();const req=(query='')=>Object.assign(new Request('https://app.example.test/api/dashboard/admin/usage?from=2026-09-01&to=2026-09-30'+query),{nextUrl:new URL('https://app.example.test/api/dashboard/admin/usage?from=2026-09-01&to=2026-09-30'+query)});
  state.signedIn=false;let response=await api.reportGet(req());assert.equal(response.status,401);assert.match(response.headers.get('cache-control'),/private, no-store/);
  reset();response=await api.reportGet(req('&organizationId=all'));assert.equal(response.status,403);
  response=await api.reportGet(req('&horizon=999'));assert.equal(response.status,400);
  response=await api.reportGet(req());assert.equal(response.status,200);assert.equal((await response.json()).selectedOrganizationId,ORG);
});
test('view capture verifies the actor and membership server-side, rejects content, and cannot supply credit units',async()=>{
  reset();state.client.rpc=async(name:string,args:any)=>{assert.equal(name,'admin_record_usage_view_v1');assert.equal(args.p_user,USER);assert.equal(args.p_org,ORG);return {data:true,error:null};};
  const input={eventId:'00000000-0000-4000-8000-000000000088',sessionId:'00000000-0000-4000-8000-000000000089',organizationId:ORG,module:'search'};
  const req=(body:any)=>new Request('https://app.example.test/api/usage/view',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  let response=await api.capturePost(req({...input,userId:FOREIGN}));assert.equal(response.status,400);
  response=await api.capturePost(req({...input,credits:100}));assert.equal(response.status,400);
  response=await api.capturePost(req({...input,organizationId:OTHER}));assert.equal(response.status,403);
  response=await api.capturePost(req(input));assert.equal(response.status,200);assert.deepEqual(await response.json(),{recorded:true});
});

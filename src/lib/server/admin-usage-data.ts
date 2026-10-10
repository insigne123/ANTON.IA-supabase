import {z} from 'zod';
import { buildUsageReport, USAGE_MODULES, type UsageQuery, type UsagePerson, type AdminUsageReport } from '@/lib/admin/usage';
import {previousRange,dayStartInZone} from '@/lib/admin/chile-time';
import {authorizedUsageScope,type UsageAccess} from './admin-usage-auth';
import {AdminDashboardAuthError} from './admin-dashboard-auth';

const uuid=z.string().uuid(),nullableUuid=uuid.nullable(),day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const fact=z.object({organizationId:uuid,userId:nullableUuid,groupId:nullableUuid.optional(),day,
  module:z.enum(Object.keys(USAGE_MODULES) as [keyof typeof USAGE_MODULES,...Array<keyof typeof USAGE_MODULES>]),kind:z.string().max(80),status:z.string().max(80),
  actor:z.enum(['user','system','unknown']),count:z.number().int().nonnegative(),firstAt:z.string(),lastAt:z.string(),entityKeys:z.array(z.string().max(300)).optional()});
const payloadSchema=z.object({facts:z.array(fact),credits:z.array(z.object({organizationId:nullableUuid,userId:nullableUuid,groupId:nullableUuid,day,
  resource:z.enum(['search','enrich','investigate']),net:z.number().int(),debits:z.number().int().nullable(),refunds:z.number().int().nullable(),source:z.enum(['journal','counter','unattributed'])})),
  cohort:z.array(z.object({organizationId:uuid,userId:nullableUuid,recipientKey:z.string(),sentAt:z.string(),replyAt:z.string().nullable(),intent:z.string().nullable(),reliable:z.boolean(),interestedAt:z.string().nullable().optional(),interestReliable:z.boolean().optional()})),
  pending:z.array(z.object({organizationId:uuid,userId:nullableUuid,kind:z.string(),count:z.number().int().nonnegative(),href:z.string().optional()})),
  captureFrom:z.string().nullable(),journalFrom:z.string().nullable(),legacyReplies:z.number().int().nonnegative()});
function dataRows(result:{data:any;error:any}){if(result.error)throw new AdminDashboardAuthError('No pudimos cargar el alcance del informe.',503);return result.data||[];}
// Metadata rosters are keyset-paged, not silently truncated at a thousand accounts.
async function roster(client:any,table:string,select:string,column:string,scope:string[]|null,secondary?:string){
  const all:any[]=[];let cursor:string|null=null,secondCursor:string|null=null;
  for(;;){let query=client.from(table).select(select).order(column,{ascending:true}).limit(500);
    if(secondary)query=query.order(secondary,{ascending:true});
    if(scope)query=query.in(table==='organizations'?'id':'organization_id',scope);
    if(cursor)query=secondary?query.or(`${column}.gt.${cursor},and(${column}.eq.${cursor},${secondary}.gt.${secondCursor})`):query.gt(column,cursor);
    const rows=dataRows(await query);all.push(...rows);if(rows.length<500)break;
    const next=String(rows.at(-1)[column]),nextSecond=secondary?String(rows.at(-1)[secondary]):null;
    if(!uuid.safeParse(next).success||secondary&&!uuid.safeParse(nextSecond).success||next===cursor&&nextSecond===secondCursor)throw new AdminDashboardAuthError('No pudimos completar el informe.',503);cursor=next;secondCursor=nextSecond;
  }return all;
}
export async function loadAdminUsage(access:UsageAccess,query:UsageQuery,now=new Date()):Promise<AdminUsageReport> {
  const selected=authorizedUsageScope(access,query.organizationId),client=access.supabase;
  const orgRows=await roster(client,'organizations','id,name','id',access.platform?null:access.organizationIds);
  const organizations=orgRows.map(row=>({id:String(row.id),name:String(row.name||'Organización')}));
  if(selected!=='all'&&!organizations.some(org=>org.id===selected))throw new AdminDashboardAuthError('Empresa no disponible.',404);
  const ids=selected==='all'?organizations.map(org=>org.id):[selected];
  if(ids.length>1000)throw new AdminDashboardAuthError('Selecciona una empresa para abrir este período.',400);
  const groupRows=ids.length?await roster(client,'organization_reporting_groups','id,organization_id,name','id',ids):[];
  const groups=groupRows.map(row=>({id:String(row.id),organizationId:String(row.organization_id),name:String(row.name||'Equipo')}));
  if(query.groupId&&!groups.some(group=>group.id===query.groupId))throw new AdminDashboardAuthError('Equipo no disponible en este alcance.',404);
  const members=ids.length?await roster(client,'organization_members','user_id,organization_id,role','organization_id',ids,'user_id'):[];
  const assignments=(ids.length?await roster(client,'organization_reporting_group_members','user_id,organization_id,group_id,unassigned_at','group_id',ids,'user_id'):[]).filter(a=>!a.unassigned_at);
  const filtered=members.filter((m:any)=>(!query.userId||m.user_id===query.userId)&&(!query.groupId||assignments.some((a:any)=>a.user_id===m.user_id&&a.organization_id===m.organization_id&&a.group_id===query.groupId)));
  const identities=await client.rpc('admin_usage_member_names_v1',{p_orgs:ids});
  if(identities.error&&!['PGRST202','42883'].includes(identities.error.code))throw new AdminDashboardAuthError('No pudimos cargar las personas del informe.',503);
  const identity=new Map<string,any>((identities.data||[]).map((user:any)=>[String(user.id),user]));
  const people:UsagePerson[]=filtered.map((m:any)=>{
    const user=identity.get(m.user_id);return {id:m.user_id,organizationId:m.organization_id,
      name:String(user?.name||user?.email?.split('@')[0]||'Usuario · '+m.user_id.slice(0,6)),email:String(user?.email||''),member:true,
      groupIds:assignments.filter((a:any)=>a.user_id===m.user_id&&a.organization_id===m.organization_id).map((a:any)=>String(a.group_id))};
  });
  const previous=previousRange(query);
  const raw=await client.rpc('admin_usage_report_v1',{p_orgs:ids,p_from:previous.from,p_to:query.to,p_user:query.userId||null,p_group:query.groupId||null,
    p_horizon:query.horizon,p_legacy:access.platform&&selected==='all'&&!query.groupId});
  const missing=raw.error&&['PGRST202','PGRST205','42883','42P01'].includes(raw.error.code);
  if(raw.error&&!missing)throw new AdminDashboardAuthError('No pudimos actualizar el informe. Intenta nuevamente.',503);
  const payload=missing?{facts:[],credits:[],cohort:[],pending:[],captureFrom:null,journalFrom:null,legacyReplies:0}:payloadSchema.parse(raw.data);
  const allowed=new Set(ids);
  for(const row of [...payload.facts,...payload.cohort,...payload.pending])if(!allowed.has(row.organizationId)||query.userId&&row.userId!==query.userId)
    throw new AdminDashboardAuthError('El informe no coincide con el alcance solicitado.',503);
  for(const row of payload.credits)if(row.organizationId===null?!(access.platform&&selected==='all'&&!query.groupId):!allowed.has(row.organizationId))
    throw new AdminDashboardAuthError('El consumo no coincide con el alcance solicitado.',503);
  // Former members retain aggregate history. Do not fetch their current global Auth profile for a previous employer.
  for(const row of payload.facts){if(row.userId&&!people.some(p=>p.id===row.userId&&p.organizationId===row.organizationId)){
    const member=members.some((m:any)=>m.user_id===row.userId&&m.organization_id===row.organizationId),known=member?identity.get(row.userId):null;
    people.push({id:row.userId,organizationId:row.organizationId,name:known?.name||'Exintegrante · '+row.userId.slice(0,6),email:known?.email||'',member,groupIds:row.groupId?[row.groupId]:[]});
  }}
  if(query.userId&&!people.some(p=>p.id===query.userId))throw new AdminDashboardAuthError('Persona no disponible en este alcance.',404);
  const unavailable=missing?['measurement_setup']:[];
  if(payload.captureFrom&&Date.parse(payload.captureFrom)>dayStartInZone(query.from).getTime())unavailable.push('historical_navigation');
  if(payload.legacyReplies)unavailable.push('historical_reply_classification');
  const limits:AdminUsageReport['limits']=[];
  const current=people.filter(p=>p.member);
  for(let index=0;index<current.length;index+=8){
    limits.push(...await Promise.all(current.slice(index,index+8).map(async person=>{
      const status=await client.rpc('get_antonia_credit_status_v2',{p_organization_id:person.organizationId,p_user_id:person.id,p_day:now.toISOString().slice(0,10)});
      if(status.error||!status.data||!Number.isFinite(Number(status.data.count))||!Number.isFinite(Number(status.data.limit)))return null;
      return {organizationId:person.organizationId,userId:person.id,used:Number(status.data.count),limit:Number(status.data.limit),remaining:Math.max(0,Number(status.data.limit)-Number(status.data.count)),mode:String(status.data.mode),binding:String(status.data.binding)};
    })));
  }
  const report=buildUsageReport({...payload,people,organizations,groups,coverage:{captureFrom:payload.captureFrom,journalFrom:payload.journalFrom,
    unavailable,legacyReplies:payload.legacyReplies,unassignedCredits:payload.credits.filter(c=>!c.organizationId||!c.userId).reduce((n,c)=>n+c.net,0),source:missing?'unavailable':'sql'}},query,now);
  return {...report,platform:access.platform,viewerUserId:access.userId,activeOrganizationId:access.activeOrganizationId,selectedOrganizationId:selected,ready:!missing,limits};
}

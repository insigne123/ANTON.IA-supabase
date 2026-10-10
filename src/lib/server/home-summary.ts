import type {SupabaseClient} from '@supabase/supabase-js';
import {homeScope,type HomeScope} from '@/lib/home/scope';
export type HomeSummary={scope:HomeScope;contacted:number;sent:number;replied:number;saved:number;
  automaticReplies:number;unclassifiedReplies:number;activity:Array<{hour:string;sent:number;replied:number}>;partial:boolean};
const HUMAN=new Set(['positive','meeting_request','neutral','negative','unsubscribe']);
/** Scoped metadata reads only. RLS visibility never substitutes personal attribution. */
export async function loadHomeSummary(client:SupabaseClient,{organizationId,userId}:{organizationId:string;userId:string},now=new Date()):Promise<HomeSummary>{
  const scope=homeScope(userId,organizationId,now);
  const own=(table:string,columns:string)=>client.from(table).select(columns).eq('organization_id',organizationId).eq('user_id',userId);
  const all=async(build:()=>any)=>{const rows:any[]=[];for(let page=0;page<20;page++){
    const result=await build().range(page*1000,page*1000+999);if(result.error)throw Error('No pudimos consultar tu actividad de hoy.');
    rows.push(...result.data||[]);if((result.data||[]).length<1000)return rows;
  }throw Error('Tu actividad necesita un rango más acotado para contarse completamente.');};
  const [dispatches,replies,saved]=await Promise.all([
    all(()=>own('outbound_dispatches','id,channel,metadata,completed_at,reconciliation_details').eq('status','sent').gte('completed_at',scope.from).lt('completed_at',scope.to).order('id')),
    all(()=>own('contacted_leads','id,email,reply_intent,replied_at,thread_key').gte('replied_at',scope.from).lt('replied_at',scope.to).order('id')),
    client.from('leads').select('id',{count:'exact',head:true}).eq('organization_id',organizationId).eq('user_id',userId).gte('created_at',scope.from).lt('created_at',scope.to),
  ]);
  if(saved.error)throw Error('No pudimos contar tus contactos guardados hoy.');
  const activity=new Map<string,{hour:string;sent:number;replied:number}>();
  const hour=(at:string)=>new Intl.DateTimeFormat('es-CL',{timeZone:scope.timeZone,hour:'2-digit',hourCycle:'h23'}).format(new Date(at))+':00';
  const add=(at:string,key:'sent'|'replied')=>{const label=hour(at);const row=activity.get(label)||{hour:label,sent:0,replied:0};row[key]++;activity.set(label,row);};
  const recipients=new Set<string>(),seen=new Set<string>();let sent=0,partial=false;
  for(const row of dispatches){
    const at=row.reconciliation_details?.sentAt||row.completed_at;
    if(!at||!Number.isFinite(Date.parse(at))){partial=true;continue;}
    if(Date.parse(at)<Date.parse(scope.from)||Date.parse(at)>=Date.parse(scope.to)||row.channel!=='email'||seen.has(row.id))continue;
    seen.add(row.id);sent++;add(at,'sent');const email=String(row.metadata?.recipient?.email||'').trim().toLowerCase();
    if(email)recipients.add(email);else partial=true;
  }
  const responded=new Set<string>(),automatic=new Set<string>(),unknown=new Set<string>();
  for(const row of replies){const key=String(row.email||row.id).trim().toLowerCase();
    if(HUMAN.has(row.reply_intent)){if(!responded.has(key))add(row.replied_at,'replied');responded.add(key);}
    else if(row.reply_intent==='auto_reply')automatic.add(key);
    else if(!['bounce','delivery_failure'].includes(row.reply_intent))unknown.add(key);
  }
  return {scope,contacted:recipients.size,sent,replied:responded.size,saved:saved.count||0,automaticReplies:automatic.size,
    unclassifiedReplies:unknown.size,activity:[...activity.values()].sort((a,b)=>a.hour.localeCompare(b.hour)),partial};
}

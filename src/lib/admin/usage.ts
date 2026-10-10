import { z } from 'zod';
import { dayInZone, dayStartInZone, daysBetween, shiftDay } from './chile-time';

export const USAGE_MODULES = {
  home: 'Inicio',
  search: 'Buscar contactos', contacts: 'Contactos', research: 'Investigación', email: 'Correos',
  campaigns: 'Campañas', linkedin: 'LinkedIn', crm: 'CRM y seguimiento', cowork: 'Cowork',
  opportunities: 'Oportunidades', settings: 'Perfil y conexiones', help: 'Ayuda', admin: 'Administración',
} as const;
export type UsageModule = keyof typeof USAGE_MODULES;
export function usageModuleForPath(path: string): UsageModule | null {
  if (path.startsWith('/dashboard/admin')) return 'admin';
  if(path==='/dashboard')return 'home';
  if(path==='/sheet')return 'contacts';
  for (const [prefix, module] of [['/search','search'],['/saved','contacts'],['/leads','contacts'],['/research','research'],
    ['/contact/','email'],['/contacted','email'],['/campaigns','campaigns'],['/extension','linkedin'],['/crm','crm'],
    ['/cowork','cowork'],['/opportunities','opportunities'],['/profile','settings'],['/connections','settings'],
    ['/settings','settings'],['/gmail','settings'],['/outlook','settings'],['/ayuda','help']] as const) {
    if (path === prefix || path.startsWith(prefix.endsWith('/') ? prefix : prefix + '/')) return module;
  }
  return null;
}
const validDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(day => {
  const date = new Date(`${day}T12:00:00Z`); return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === day;
});
export const usageQuerySchema = z.object({ from: validDay, to: validDay,
  organizationId: z.union([z.string().uuid(), z.literal('all')]).optional(),
  userId: z.string().uuid().optional(), groupId: z.string().uuid().optional(),
  horizon: z.coerce.number().refine(n => [7,14,30,60].includes(n)).default(14),
}).refine(q => q.from <= q.to && daysBetween(q.from,q.to) <= 366, {message:'Selecciona un rango de hasta un año.'});
export type UsageQuery = z.infer<typeof usageQuerySchema>;
export type UsageFact = { organizationId: string; userId: string | null; day: string; module: UsageModule; kind: string;
  status: string; actor: 'user'|'system'|'unknown'; count: number; firstAt: string; lastAt: string; groupId?: string | null; entityKeys?:string[] };
export type CreditDay = { organizationId: string | null; userId: string | null; groupId: string | null; day: string;
  resource: 'search'|'enrich'|'investigate'; net: number; debits: number | null; refunds: number | null; source: 'journal'|'counter'|'unattributed' };
export type CohortContact = { organizationId: string; userId: string | null; recipientKey: string; sentAt: string;
  replyAt: string | null; intent: string | null; reliable: boolean; interestedAt?:string|null;interestReliable?:boolean };
export type UsagePerson = { id: string; organizationId: string; name: string; email: string; member: boolean; groupIds: string[] };
export type UsageCoverage = { captureFrom: string | null; journalFrom: string | null; unavailable: string[];
  legacyReplies: number; unassignedCredits: number; source: 'sql'|'unavailable' };
const HUMAN = new Set(['positive','meeting_request','neutral','negative','unsubscribe']);
const INTEREST = new Set(['positive','meeting_request']);
const FAILED = new Set(['failed','error','timeout']);
export function cohortConversion(contacts: CohortContact[], query: Pick<UsageQuery,'from'|'to'|'horizon'>, now: Date) {
  const start = dayStartInZone(query.from).getTime(), end = dayStartInZone(shiftDay(query.to,1)).getTime();
  const unique = new Map<string,CohortContact>();
  for (const contact of contacts) {
    const at = Date.parse(contact.sentAt); if (!Number.isFinite(at) || at < start || at >= end) continue;
    const key = `${contact.organizationId}:${contact.recipientKey}`;
    const previous = unique.get(key);
    if (!previous || at < Date.parse(previous.sentAt)) unique.set(key,contact);
  }
  const horizonMs = query.horizon * 86400000;
  const mature = [...unique.values()].filter(c => Date.parse(c.sentAt)+horizonMs <= now.getTime());
  let replies=0, interested=0, unknown=0,interestUnknown=0;
  for (const contact of mature) {
    const reply = Date.parse(contact.replyAt || '');
    const inWindow=(at:number)=>Number.isFinite(at)&&at>=Date.parse(contact.sentAt)&&at<=Date.parse(contact.sentAt)+horizonMs;
    if(!contact.reliable)unknown++;
    else if(inWindow(reply)){if(HUMAN.has(contact.intent||''))replies++;else if(!['auto_reply','bounce','delivery_failure'].includes(contact.intent||''))unknown++;}
    if(!(contact.interestReliable??contact.reliable))interestUnknown++;
    else if(contact.interestedAt!==undefined){if(inWindow(Date.parse(contact.interestedAt||'')))interested++;}
    else if(inWindow(reply)&&INTEREST.has(contact.intent||''))interested++;
  }
  const rate = (n:number,missing:number) => mature.length && !missing ? Math.round(n/mature.length*1000)/10 : null;
  return { contacted: unique.size, mature: mature.length, observing: unique.size-mature.length, replies, interested, unknown,
    interestUnknown,replyRate: rate(replies,unknown), interestRate: rate(interested,interestUnknown), horizon: query.horizon };
}
export type CommercialCounts = { saved:number; researchCompleted:number; drafts:number; contacted:number; humanReplies:number;
  interested:number; meetingRequested:number; meetingRegistered:number; meetingCompleted:number; linkedinConfirmed:number; qualified:number; negotiating:number; won:number; lost:number };
export type UsageDiagnostic = { id:string; category:'technical'|'setup'|'pending'|'protection'|'strategy'|'observing';
  title:string; detail:string; count:number; organizationId:string | null; userId:string | null; href:string; };
export type PendingSignal = { organizationId:string; userId:string | null; kind:string; count:number; href?:string };
export function commercialCounts(facts: UsageFact[]): CommercialCounts {
  const count = (kind:string) => {
    const rows=facts.filter(f=>f.kind===kind), keys=new Set<string>();let unkeyed=0;
    for(const row of rows){if(row.entityKeys?.length)for(const entity of row.entityKeys)keys.add(`${row.organizationId}:${entity}`);else unkeyed+=row.count;}
    return keys.size+unkeyed;
  };
  return { saved:count('contact_saved'), researchCompleted:count('research_completed'), drafts:count('draft_prepared'),
    contacted:count('contact_sent'), humanReplies:count('human_reply'), interested:count('interest'),
    meetingRequested:count('meeting_requested'), meetingRegistered:count('meeting_registered'), meetingCompleted:count('meeting_completed'),
    linkedinConfirmed:count('linkedin_sent'),qualified:count('qualified'),negotiating:count('negotiation'),won:count('closed_won'), lost:count('closed_lost') };
}
export function usageDiagnostics(facts: UsageFact[], pending: PendingSignal[], conversion: ReturnType<typeof cohortConversion>): UsageDiagnostic[] {
  const diagnostics:UsageDiagnostic[]=[];
  const definitions:Record<string,{category:UsageDiagnostic['category'];title:string;detail:string;href:string}>={
    awaiting_approval:{category:'pending',title:'Trabajo esperando revisión',detail:'Hay propuestas o borradores que necesitan una decisión para continuar.',href:'/saved/leads/enriched'},
    positive_pending:{category:'pending',title:'Interés pendiente de atender',detail:'Hay conversaciones con interés que todavía necesitan atención del responsable.',href:'/contacted?view=replied'},
    overdue_commitment:{category:'pending',title:'Compromisos vencidos',detail:'Revisa las llamadas, reuniones o recordatorios que tienen una fecha vencida.',href:'/contacted?view=replied'},
    unknown_send:{category:'technical',title:'Envíos por comprobar',detail:'La salida no está confirmada. Revisa el estado antes de volver a enviar.',href:'/contacted'},
    failed_send:{category:'technical',title:'Envíos que no se completaron',detail:'Revisa el motivo registrado y la recuperación disponible.',href:'/contacted'},
    safety_hold:{category:'protection',title:'Contactos detenidos por protección',detail:'Hay contactos bloqueados por respuesta, baja o relación comercial previa.',href:'/campaigns'},
    mail_missing:{category:'setup',title:'Conexión de correo pendiente',detail:'No hay una conexión de correo registrada para estas personas.',href:'/connections'},
    sync_gap:{category:'technical',title:'Conversaciones por actualizar',detail:'La última sincronización no se completó. Comprueba la conexión antes de interpretar ausencia de respuestas.',href:'/contacted'},
    profile_missing:{category:'setup',title:'Oferta del perfil por completar',detail:'Hay personas con trabajo de correo y sin una oferta registrada en su perfil.',href:'/profile'},
    prepared_not_contacted:{category:'pending',title:'Contactos preparados por trabajar',detail:'Hay borradores disponibles para revisar. Comprueba qué canal y siguiente paso corresponde.',href:'/saved/leads/enriched'},
  };
  for (const signal of pending) {
    const definition=definitions[signal.kind]; if (!definition || signal.count<=0) continue;
    diagnostics.push({id:`${signal.organizationId}:${signal.userId||'all'}:${signal.kind}`,count:signal.count,
      organizationId:signal.organizationId,userId:signal.userId,...definition,href:signal.href||definition.href});
  }
  const failures=facts.filter(f=>FAILED.has(f.status) && !['contact_sent','human_reply'].includes(f.kind)).reduce((n,f)=>n+f.count,0);
  if (failures) diagnostics.push({id:'preparation_failures',category:'technical',title:'Preparación que no terminó',
    detail:'Hay investigaciones o trabajos con un fallo registrado. No incluye falta de datos ni trabajo pendiente de aprobar.',
    count:failures,organizationId:null,userId:null,href:'/dashboard/admin/usage?view=people'});
  if (conversion.observing || conversion.unknown||conversion.interestUnknown) diagnostics.push({id:'observation',category:'observing',title:'Resultados todavía por observar',
    detail:`${conversion.observing} contactos no completaron la ventana de ${conversion.horizon} días; hay ${conversion.unknown} respuestas y ${conversion.interestUnknown} resultados de interés con observación incompleta.`,
    count:conversion.observing+Math.max(conversion.unknown,conversion.interestUnknown),organizationId:null,userId:null,href:'/dashboard/admin/usage?view=commercial'});
  if (conversion.mature>0 && !conversion.unknown && !conversion.interestUnknown&&conversion.interested===0) diagnostics.push({id:'review_strategy',category:'strategy',
    title:'Revisar audiencia, oferta y mensaje',detail:`No se registró interés en ${conversion.mature} contactos con ${conversion.horizon} días de observación. Es una señal para revisar, no una causa demostrada.`,
    count:conversion.mature,organizationId:null,userId:null,href:'/dashboard/admin/usage?view=commercial'});
  return diagnostics.sort((a,b)=>['technical','pending','setup','protection','strategy','observing'].indexOf(a.category)-['technical','pending','setup','protection','strategy','observing'].indexOf(b.category));
}
export function buildUsageReport(input:{facts:UsageFact[];credits:CreditDay[];cohort:CohortContact[];people:UsagePerson[];pending:PendingSignal[];
  coverage:UsageCoverage;organizations:Array<{id:string;name:string}>;groups:Array<{id:string;organizationId:string;name:string}>},query:UsageQuery,now=new Date()) {
  const inRange=(day:string)=>day>=query.from&&day<=query.to;
  const facts=input.facts.filter(f=>inRange(f.day));
  const credits=input.credits.filter(c=>inRange(c.day));
  const sumCredits=(rows:CreditDay[])=>rows.reduce((sum,c)=>sum+c.net,0);
  const workCount=(rows:UsageFact[])=>{const keys=new Set<string>();let unknown=0;for(const row of rows.filter(f=>f.kind!=='module_opened')){
    if(row.entityKeys?.length)for(const id of row.entityKeys)keys.add(`${row.organizationId}:${row.module}:${id}`);else unknown+=row.count;
  }return keys.size+unknown;};
  const human=facts.filter(f=>f.actor==='user');
  const active = new Set(human.filter(f=>f.userId).map(f=>f.userId!));
  const cohort=cohortConversion(input.cohort,query,now);
  const people=input.people.map(person=>{
    const rows=facts.filter(f=>f.organizationId===person.organizationId&&f.userId===person.id);
    const humanRows=rows.filter(f=>f.actor==='user');
    const userCredits=credits.filter(c=>c.organizationId===person.organizationId&&c.userId===person.id);
    const usedModules=[...new Set(humanRows.map(f=>f.module))];
    const lastAt=humanRows.reduce<string|null>((at,f)=>!at||f.lastAt>at?f.lastAt:at,null);
    return {...person,activeDays:new Set(humanRows.map(f=>f.day)).size,lastAt,modules:usedModules,
      credits:userCredits.length?sumCredits(userCredits):null,commercial:commercialCounts(rows),
      pending:input.pending.filter(p=>p.organizationId===person.organizationId&&p.userId===person.id).reduce((n,p)=>n+p.count,0)};
  }).sort((a,b)=>(b.lastAt||'').localeCompare(a.lastAt||'')||a.name.localeCompare(b.name,'es'));
  const daily=[];
  for (let day=query.from;day<=query.to;day=shiftDay(day,1)) {
    const rows=facts.filter(f=>f.day===day), users=new Set(rows.filter(f=>f.actor==='user'&&f.userId).map(f=>f.userId!));
    daily.push({day,active:users.size,credits:sumCredits(credits.filter(c=>c.day===day)),commercial:commercialCounts(rows),
      modules:[...new Set(rows.filter(f=>f.actor==='user').map(f=>f.module))],
      firstAt:rows.filter(f=>f.actor==='user').map(f=>f.firstAt).sort()[0]||null,
      lastAt:rows.filter(f=>f.actor==='user').map(f=>f.lastAt).sort().at(-1)||null,
      actions:workCount(rows),people:input.people.filter(p=>rows.some(f=>f.organizationId===p.organizationId&&f.userId===p.id)).map(p=>{
        const own=rows.filter(f=>f.organizationId===p.organizationId&&f.userId===p.id),visits=own.filter(f=>f.actor==='user');
        return {id:p.id,organizationId:p.organizationId,name:p.name,active:visits.length>0,modules:[...new Set(visits.map(f=>f.module))],commercial:commercialCounts(own)};
      })});
  }
  const modules=(Object.keys(USAGE_MODULES) as UsageModule[]).map(module=>{
    const rows=facts.filter(f=>f.module===module);
    return {id:module,label:USAGE_MODULES[module],users:new Set(rows.filter(f=>f.actor==='user'&&f.userId).map(f=>f.userId!)).size,
      visits:rows.filter(f=>f.kind==='module_opened').reduce((n,f)=>n+f.count,0),operations:workCount(rows)};
  }).sort((a,b)=>b.users-a.users||b.operations-a.operations);
  const previous= {from:shiftDay(query.from,-daysBetween(query.from,query.to)),to:shiftDay(query.from,-1),horizon:query.horizon};
  return {range:{from:query.from,to:query.to},generatedAt:now.toISOString(),activityZone:'America/Santiago',creditZone:'UTC',
    organizations:input.organizations,groups:input.groups,coverage:input.coverage,
    summary:{active:active.size,people:new Set(people.map(p=>p.id)).size,activeDays:new Set(human.map(f=>f.day)).size,credits:sumCredits(credits),commercial:commercialCounts(facts)},
    modules,daily,people,conversion:cohort,previousConversion:cohortConversion(input.cohort,previous,now),
    creditResources:(['search','enrich','investigate'] as const).map(resource=>({resource,net:sumCredits(credits.filter(c=>c.resource===resource))})),
    diagnostics:usageDiagnostics(facts,input.pending,cohort),today:dayInZone(now)};
}
export type AdminUsageReport = ReturnType<typeof buildUsageReport> & {platform:boolean;viewerUserId:string;activeOrganizationId:string|null;selectedOrganizationId:string;ready:boolean;
  limits:Array<{organizationId:string;userId:string;used:number;limit:number;remaining:number;mode:string;binding:string}|null>};
export function usageReportCsv(report:AdminUsageReport) {
  const cell=(value:unknown)=>`"${String(value??'').replace(/^\s*[=+\-@\t\r]/,"'$&").replace(/"/g,'""')}"`;
  return '\uFEFF'+[['Empresa','Persona','Correo','Días con uso','Última actividad','Funciones','Créditos atribuidos','Contactados','Interesados registrados','Reuniones registradas','Cierres registrados'],
    ...report.people.map(p=>[report.organizations.find(o=>o.id===p.organizationId)?.name||'',p.name,p.email,p.activeDays,p.lastAt,
      p.modules.map(m=>USAGE_MODULES[m]).join(' · '),p.credits,p.commercial.contacted,p.commercial.interested,p.commercial.meetingRegistered,p.commercial.won])]
    .map(row=>row.map(cell).join(',')).join('\r\n');
}

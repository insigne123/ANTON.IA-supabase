import {createHash} from 'node:crypto';
import type {SupabaseClient} from '@supabase/supabase-js';
import {searchSerper} from '@/lib/server/serper-search';
import {fetchReportV2Source} from '@/lib/server/research-report-v2-research';
import {opportunityDb} from './workspace-store';
import {saveOpportunityDocument} from './workspace-documents';
import type {OpportunityJob} from './workspace-ai';

/** Only public buyer identity enters external queries, never the private invitation or its attachments. */
export async function gatherOpportunityBuyerContext(client:SupabaseClient,job:OpportunityJob,buyer:{name:string;domain:string|null},started:number){
 const price=Number(process.env.OPPORTUNITIES_SERPER_USD_PER_REQUEST);
 if(!process.env.SERPER_API_KEY||!Number.isFinite(price)||price<=0)return ['La investigación web del cliente no está conectada con una tarifa confirmada.'];
 const scope={organizationId:job.organization_id,userId:job.requested_by};const warnings:string[]=[];
 const name=buyer.name.replace(/["<>\r\n]/g,' ').trim().slice(0,200);
 if(!name)return ['Falta identificar al cliente para la investigación pública.'];
 const queries=[`"${name}" sitio oficial servicios proyectos`,`"${name}" contratos adjudicaciones noticias`];
 const retrieved=new Set<string>();
 for(const query of queries){
  if(Date.now()-started>70_000){warnings.push('Quedó contexto público por consultar.');break;}
  const step='buyer-search:'+createHash('sha256').update(query).digest('hex');
  const reservation=opportunityDb(await client.rpc('opportunity_budget_reserve',{p_org:job.organization_id,p_job:job.id,p_step:step,p_category:'research',p_micro:Math.ceil(price*1e6),p_lease:job.lease_token}));
  if(!reservation?.admitted){warnings.push('El presupuesto disponible no permitió ampliar el contexto público.');break;}
  let search;
  if(!reservation.fresh){
   const cached=opportunityDb(await client.from('opportunity_ai_results').select('data').eq('organization_id',job.organization_id).eq('reservation_id',reservation.id).maybeSingle());
   if(!cached){warnings.push('Una consulta pública anterior sigue pendiente de comprobación.');continue;}search=cached.data;
  }else{
   try{
    search=await searchSerper({organizationId:job.organization_id,kind:'organic',query,countryCode:'cl',language:'es',limit:4},{maxRetries:0});
    opportunityDb(await client.rpc('opportunity_budget_settle',{p_id:reservation.id,p_cost:Math.ceil(price*1e6),p_receipt:{provider:'serper',queries:1,costKind:'configured_rate',price},p_data:search}));
   }catch{
    opportunityDb(await client.rpc('opportunity_budget_settle',{p_id:reservation.id,p_cost:null,p_receipt:{provider:'serper',status:'uncertain',price},p_data:null}));
    warnings.push('Una consulta pública no terminó; su reserva se conserva.');continue;
   }
  }
  for(const item of search.items||[]){
   if(!item.link||retrieved.size>=4||Date.now()-started>90_000)break;
   try{
    const url=new URL(item.link);if(url.protocol!=='https:'||retrieved.has(url.href))continue;retrieved.add(url.href);
    const page=await fetchReportV2Source({url:url.href,domain:buyer.domain||url.hostname});
    await saveOpportunityDocument(client,scope,job.opportunity_id!,{name:`Contexto público ${retrieved.size}.txt`,bytes:Buffer.from(`Fuente pública: ${page.source.url}\nConsultada: ${new Date().toISOString()}\nLectura acotada de la página; verificar identidad del cliente antes de atribuir hechos.\n\n${page.blocks.join('\n\n')}`),sourceKind:'public_web',sourceUrl:url.href});
   }catch{warnings.push('Una fuente pública no pudo leerse.');}
  }
 }
 return [...new Set(warnings)];
}

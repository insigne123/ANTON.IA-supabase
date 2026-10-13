import {JSDOM} from 'jsdom';
import {createOpportunityPublicSession,downloadOpportunitySource} from './workspace-download';

const HOST='www.mercadopublico.cl';
const FORM_PATH='/Procurement/Modules/Attachment/VerAntecedentes.aspx';
export function publicMercadoDocumentIndex(html:string,base:string){
 const url=new URL(base);if(url.hostname!==HOST||url.protocol!=='https:'||url.pathname!=='/Procurement/Modules/RFB/DetailsAcquisition.aspx')return null;
 const dom=new JSDOM(html);
 try{
  const code=dom.window.document.querySelector('#lblNumLicitacion')?.textContent?.trim()||'';
  if(!/^\d+-\d+-[A-Z0-9]+$/.test(code))return null;
  const forms=[...dom.window.document.querySelectorAll('input.fancyAdjunto[href]')].flatMap(e=>{
   try{const link=new URL(e.getAttribute('href')||'',base);return link.hostname===HOST&&link.protocol==='https:'&&link.pathname===FORM_PATH?[link.href]:[];}catch{return[];}
  });
  let forum:string|null=null;try{const href=dom.window.document.querySelector('#imgPreguntasLicitacion')?.getAttribute('href');if(href){const q=new URL(href,base);if(q.hostname===HOST&&q.protocol==='https:'&&q.pathname==='/Foros/Modules/FNormal/PopUps/PublicView.aspx')forum=q.href;}}catch{/* invalid link stays absent */}
  return {code,forms:[...new Set(forms)].slice(0,12),forum};
 }finally{dom.window.close();}
}
export function publicMercadoDownloadControls(html:string,base:string){
 const url=new URL(base);if(url.hostname!==HOST||url.protocol!=='https:'||url.pathname!==FORM_PATH)return [];
 const dom=new JSDOM(html);
 try{
  const form=dom.window.document.querySelector('form');if(!form)return[];
  const action=new URL(form.getAttribute('action')||base,base);if(action.hostname!==HOST||action.protocol!=='https:'||action.pathname!==FORM_PATH)return[];
  const hidden:Record<string,string>={};
  for(const input of form.querySelectorAll<HTMLInputElement>('input[type=hidden][name]'))if(/^__(?:VIEWSTATE(?:\d+|GENERATOR|FIELDCOUNT)?|EVENTVALIDATION|EVENTTARGET|EVENTARGUMENT)$/.test(input.name))hidden[input.name]=input.value;
  return [...form.querySelectorAll<HTMLInputElement>('input[type=image][name]')].flatMap(button=>{
   if(!/^grdAttachment\$ctl\d+\$grdIbtnView$/.test(button.name))return[];
   const name=button.closest('tr')?.querySelector('[id*=grdLblSourceFileName]')?.textContent?.trim()||'';
   if(!/\.(pdf|docx|xlsx)$/i.test(name))return[];
   return [{name,action:action.href,body:{...hidden,[button.name+'.x']:'1',[button.name+'.y']:'1'}}];
  }).slice(0,12);
 }finally{dom.window.close();}
}
export function publicMercadoQuestions(value:unknown){
 if(!Array.isArray(value)||value.length>1000)throw new Error('OPPORTUNITY_FORUM_RESPONSE_INVALID');
 return value.flatMap(q=>{
  if(!q||typeof q!=='object'||typeof q.Descripcion!=='string'||!q.RespuestaPublicada||typeof q.RespuestaPublicada.Descripcion!=='string')return[];
  return [`Pregunta ${String(q.Numero||q.idP).slice(0,30)} (${String(q.FechaHora||'').slice(0,60)}):\n${q.Descripcion.slice(0,12000)}\nRespuesta publicada (${String(q.RespuestaPublicada.FechaHora||'').slice(0,60)}):\n${q.RespuestaPublicada.Descripcion.slice(0,12000)}`];
 }).join('\n\n');
}
/** Read the public controls as published. Never request the protected inventory behind reCAPTCHA. */
export async function readPublicMercadoDocuments(base:string,save:(file:{name:string;bytes:Uint8Array;sourceUrl:string})=>Promise<void>,options:{download?:typeof downloadOpportunitySource;deadline?:number}={}){
 const download=options.download||downloadOpportunitySource;const session=createOpportunityPublicSession();const deadline=options.deadline||Date.now()+90000;
 const warnings:string[]=['El inventario completo de bases y modificaciones no está certificado. Las descargas corresponden a formularios públicos y al foro accesible.'];
 const root=await download(base,{session});const index=publicMercadoDocumentIndex(root.bytes.toString('utf8'),root.url);
 if(!index)return {downloaded:0,questions:false,warnings:['No se pudo reconocer la ficha pública de esta licitación.']};
 let downloaded=0,questions=false;
 for(const link of index.forms){
  if(Date.now()>deadline){warnings.push('Quedaron formularios públicos por descargar.');break;}
  try{
   const page=await download(link,{session});const controls=publicMercadoDownloadControls(page.bytes.toString('utf8'),page.url);
   if(!controls.length)warnings.push('Un formulario público no mostró controles de descarga legibles.');
   for(const control of controls){
    if(Date.now()>deadline){warnings.push('Quedaron formularios públicos por descargar.');break;}
    const file=await download(control.action,{session,publicForm:control.body,expectedName:control.name});
    if(file.mime.includes('html'))throw new Error('OPPORTUNITY_DOCUMENT_DOWNLOAD_UNAVAILABLE');
    await save({name:control.name,bytes:file.bytes,sourceUrl:link});downloaded++;
   }
  }catch{warnings.push('Un formulario público no pudo descargarse.');}
 }
 if(index.forum&&Date.now()<deadline){
  try{
   const page=await download(index.forum,{session});const dom=new JSDOM(page.bytes.toString('utf8'));
   const code=dom.window.document.querySelector<HTMLInputElement>('#h_intRBFCode')?.value||'';
   const external=dom.window.document.querySelector('#externaCode')?.textContent?.trim();dom.window.close();
   if(external!==index.code||!/^\d{1,12}$/.test(code))throw new Error('OPPORTUNITY_FORUM_IDENTITY_MISMATCH');
   const source='https://www.mercadopublico.cl/Foros/Modules/FNormal/servicesPub.aspx';
   const response=await download(source,{session,publicForm:{opt:'101',RFBCode:code},expectedName:'Preguntas y respuestas.txt'});
   const text=publicMercadoQuestions(JSON.parse(response.bytes.toString('utf8')));
   if(text){await save({name:'Preguntas y respuestas públicas.txt',bytes:Buffer.from(text),sourceUrl:index.forum});questions=true;}
  }catch{warnings.push('No se pudieron leer las preguntas y respuestas públicas.');}
 }else if(index.forum)warnings.push('Quedó pendiente consultar el foro público.');
 return {downloaded,questions,warnings:[...new Set(warnings)]};
}

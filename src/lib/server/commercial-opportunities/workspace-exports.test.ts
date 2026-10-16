import assert from 'node:assert/strict';
import test from 'node:test';
import {opportunityReportExcel,opportunityReportMarkdown,opportunityReportPdf} from './workspace-exports';
import type {OpportunityReport} from '@/lib/commercial-opportunities/expedient';
const report:OpportunityReport={title:'Oportunidad de demostración',executive:'Informe de demostración con decisión condicionada.',recommendation:'conditional',reasons:['Falta confirmar alcance.'],
 sections:Array.from({length:12},(_,i)=>({id:`s${i}`,title:`Sección ${i+1}`,paragraphs:Array.from({length:4},()=>('Texto de análisis en español. Requisitos documentados y propuestas de ejecución. ').repeat(8)),facts:[{text:'El cierre consta en la invitación.',state:'documented',citations:[{chunkId:'c1',quote:'El cierre es el 1 de noviembre.'}]}]})),
 requirements:[{title:'Confirmar alcance',status:'pending',action:'Solicitar anexo',role:'Comercial',due:'Antes de ofertar',evidence:[]}],tasks:[{title:'Preparar propuesta',role:'Comercial',due:'Por confirmar',dependency:'Alcance',evidence:'Propuesta revisada'}],milestones:[{label:'Cierre',date:'1 nov 2026',state:'documented',citations:[]}],
 risks:[{title:'Alcance incompleto',impact:'high',basis:'documented',mitigation:'Solicitar documentación',citations:[]}],
 scenarios:[{name:'Escenario condicionado',monthlyCost:820,months:24,overheadPercent:8,marginPercent:10,taxPercent:null,paymentDelayMonths:4,guaranteePercent:5,assumptions:['Valores de demostración, no costos de una empresa real.']}],
 questions:['¿Cuál es el alcance?'],warnings:['Anexo pendiente'],generatedAt:'2026-10-12T10:00:00Z',coverage:[{id:'d1',name:'Invitación.txt',status:'read',pagesRead:0,pagesTotal:null}],sources:[{id:'c1',documentId:'d1',name:'Invitación.txt',locator:'Texto recibido'}]};
test('complete report exports paginate and preserve every section and textual source without model calls',async()=>{
 const bytes=await opportunityReportPdf(report);assert.ok(Buffer.from(bytes).subarray(0,5).toString()==='%PDF-');
 const {extractText}=await import('unpdf');const parsed=await extractText(bytes,{mergePages:true});
 const text=String(parsed.text);assert.match(text,/Sección 12/);assert.match(text,/Precio neto total/);assert.match(text,/Capital de trabajo/);assert.match(text,/Invitación.txt/);assert.ok(parsed.totalPages>5);
 const md=opportunityReportMarkdown(report);assert.match(md,/Sección 12/);assert.match(md,/Texto recibido/);assert.match(md,/garantía|guarantee/i);
});
test('workbook keeps scenario arithmetic as numbers, unknown taxes blank and formula-like descriptions as inert strings',async()=>{
 const XLSX=await import('xlsx');const bytes=await opportunityReportExcel({...report,requirements:[{...report.requirements[0],title:'=WEBSERVICE("https://invalid.test")'}]});
 const book=XLSX.read(bytes,{type:'array'});assert.equal(book.Sheets.Requisitos.A2.t,'s');assert.equal(book.Sheets.Requisitos.A2.f,undefined);
 const rows=XLSX.utils.sheet_to_json<any[]>(book.Sheets.Escenarios,{header:1,defval:null});assert.equal(rows[1][5],null);assert.ok(Math.abs(rows[1][8]-24000)<1e-7);
});
test('unsupported PDF glyphs are not silently dropped; editable Markdown preserves them',async()=>{
 await assert.rejects(opportunityReportPdf({...report,title:'日本語'}),/caracteres/);assert.match(opportunityReportMarkdown({...report,title:'日本語'}),/日本語/);
});
test('the real pilot summation notation exports legibly without losing its financial operands',async()=>{
 const sample={...report,scenarios:[],sections:[{id:'finance',title:'Modelo económico',paragraphs:['Oferta neta = Σ(P x Q). Capital de trabajo ≈ costo mensual x desfase.'],facts:[]}]};
 const {extractText}=await import('unpdf');const parsed=await extractText(await opportunityReportPdf(sample),{mergePages:true});
 assert.match(String(parsed.text),/sumatoria\(P x Q\)/);assert.match(String(parsed.text),/Capital de trabajo/);
 assert.match(String(parsed.text),/No hay escenarios numéricos disponibles/);
 assert.match(opportunityReportMarkdown(sample),/Σ\(P x Q\)/,'editable source keeps the original mathematical notation');
});

test('the first page reads as a decision: what to do, the key dates and plain Spanish, no internal ids or ISO dates',async()=>{
 const opportunity={title:'Servicio de verificación de antecedentes',buyer:'Hospital Demo',deadline:'2026-10-28T18:00:00Z',amount:15000000,currency:'CLP'};
 const {extractText}=await import('unpdf');const first=await extractText(await opportunityReportPdf({...report,nextSteps:['Enviar consultas antes del 20 de octubre']},opportunity),{mergePages:false});
 const page1=String((first.text as string[])[0]);
 assert.match(page1,/Postular si se resuelve lo pendiente/);assert.match(page1,/Qué hacer ahora/);assert.match(page1,/Enviar consultas antes del 20 de octubre/);
 assert.match(page1,/Preparado el 12 de octubre de 2026/);assert.match(page1,/28 de octubre de 2026, 15:00/);assert.match(page1,/15\.000\.000 CLP/);
 const all=(first.text as string[]).join('\n');
 assert.doesNotMatch(all,/2026-10-12T10:00:00Z|Índice de fuentes|c1:|Impacto high/);assert.match(all,/Impacto alto/);
 const md=opportunityReportMarkdown(report,opportunity);
 assert.match(md,/^# Servicio de verificación de antecedentes/);assert.match(md,/\*\*Postular si se resuelve lo pendiente\*\*/);assert.doesNotMatch(md,/Fecha de corte|pending ·|high/);
});

test('the download keeps what the team marked: checks, highlights, the progress, the route and the notes with their author',async()=>{
 const {reportItemKey,marksFromRows}=await import('@/lib/commercial-opportunities/report-marks');
 const marked={...report,nextSteps:['Pedir la boleta al banco'],reviewers:['Requisitos y documentos','Contrato y garantías'],
  milestones:[{label:'Fin de consultas',date:'20-10-2026 12:00',state:'documented' as const,citations:[]},{label:'Cierre',date:'1 nov 2026',state:'documented' as const,citations:[]}]};
 const marks={names:{u1:'Ana Soto'},items:marksFromRows([
  {item_key:reportItemKey('requirement','Confirmar alcance'),done:true,highlight:true,note:'Lo pidió Ana por correo al comprador.',updated_by:'u1',updated_at:'2026-10-16T15:00:00Z'},
  {item_key:reportItemKey('step','Pedir la boleta al banco'),done:false,highlight:false,note:''}])};
 const md=opportunityReportMarkdown(marked,undefined,marks);
 assert.match(md,/\*\*Avance:\*\* 1 de 3 listos/);
 assert.match(md,/- \[ \] Pedir la boleta al banco/);
 assert.match(md,/- \[x\] \*\*Confirmar alcance\*\* \*\*\(destacado\)\*\*/);
 assert.match(md,/## Ruta de la postulación/);
 assert.match(md,/## Notas del equipo\n\n> \*\*Confirmar alcance\*\* \(destacado\)\n> Lo pidió Ana por correo al comprador\.\n> — Ana Soto · 16 de octubre de 2026, 12:00/);
 assert.match(md,/Revisaron: Requisitos y documentos, Contrato y garantías\./);
 const {extractText}=await import('unpdf');const text=String((await extractText(await opportunityReportPdf(marked,undefined,marks),{mergePages:true})).text);
 assert.match(text,/Avance: 1 de 3 listos/);assert.match(text,/Notas del equipo/);assert.match(text,/Lo pidió Ana por correo al comprador/);assert.match(text,/Ana Soto/);
 assert.match(text,/Ruta de la postulación/);assert.match(text,/Revisaron antes de escribir/);
 // Without marks the export reads exactly as before.
 assert.doesNotMatch(opportunityReportMarkdown(marked),/\[x\]|\[ \]|Notas del equipo|Avance:/);
});
test('«Cómo postular» travels in the download: each document with its folder, its tick and whether it leaves the offer out',async()=>{
 const {reportItemKey,marksFromRows}=await import('@/lib/commercial-opportunities/report-marks');
 const submission={channel:'portal' as const,channelDetail:'Mercado Público, en carpetas de anexos administrativos, técnicos y económicos.',
  folders:[{name:'Económicos',documents:[{title:'Anexo 4 Formato Oficial de Oferta Económica',source:'annex' as const,signed:true,validity:'',excludesIfMissing:true,howTo:'Neto y total con IVA deben coincidir.',evidence:[]},
   {title:'Certificado F30',source:'certificate' as const,signed:false,validity:'No más de 30 días antes de la apertura',excludesIfMissing:false,howTo:'Dirección del Trabajo, en línea.',evidence:[]}]}],
  rules:[{text:'Sueldo líquido de al menos $620.000: menos deja la oferta fuera de bases.',kind:'minimum' as const,evidence:[]}],
  numbers:{budget:212000000,budgetLabel:'$212.000.000 impuestos incluidos',currency:'CLP',budgetIncludesTax:true,portalValue:'net' as const,notes:[]},
  guarantees:[{kind:'Fiel cumplimiento',amount:'5% del valor contratado',validity:'Contrato más 60 días hábiles',when:'A la firma',payableTo:'Ilustre Municipalidad de Dalcahue'}],
  afterSubmit:[],inconsistencies:[{text:'Dos carpetas o tres.',question:'¿Se entregan en dos o en tres carpetas?'}]};
 const marks={items:marksFromRows([{item_key:reportItemKey('document','Anexo 4 Formato Oficial de Oferta Económica'),done:true,highlight:false,note:''}])};
 const markdown=opportunityReportMarkdown({...report,submission},undefined,marks);
 assert.match(markdown,/## Cómo postular/);
 assert.match(markdown,/- \[x\] \*\*Anexo 4 Formato Oficial de Oferta Económica\*\*.*si falta, quedas fuera/);
 assert.match(markdown,/- \[ \] \*\*Certificado F30\*\* · Certificado · No más de 30 días/);
 assert.match(markdown,/Sueldo líquido de al menos \$620\.000/);
 assert.match(markdown,/¿Se entregan en dos o en tres carpetas\?/);
 const {extractText}=await import('unpdf');const text=String((await extractText(await opportunityReportPdf({...report,submission},undefined,marks),{mergePages:true})).text);
 assert.match(text,/Cómo postular/);
 assert.match(text,/Quedas\s+fuera/);
 assert.match(text,/Fiel\s+cumplimiento/);
});

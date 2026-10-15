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

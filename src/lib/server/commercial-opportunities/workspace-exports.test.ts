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
 const text=String(parsed.text);assert.match(text,/Sección 12/);assert.match(text,/Precio neto total/);assert.match(text,/Capital de trabajo/);assert.match(text,/Invitación.txt/);assert.ok(parsed.totalPages>10);
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

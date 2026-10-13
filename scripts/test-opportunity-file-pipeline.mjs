// Binary extraction and resumable AI boundary with injected services. Synthetic documents; no providers/DB network.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
const entry=await build({stdin:{contents:`export {extractOpportunityFile,opportunityTextChunks} from './src/lib/server/commercial-opportunities/workspace-documents';export {opportunityGenerate} from './src/lib/server/commercial-opportunities/workspace-ai';`,loader:'ts',resolveDir:process.cwd()},bundle:true,write:false,format:'cjs',platform:'node',packages:'external',plugins:[{name:'auth-fixture',setup(b){b.onResolve({filter:/auth-utils|workspace-store|workspace-access/},a=>({path:a.path,namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'js',contents:a.path.includes('auth-utils')?`export class AuthError extends Error{constructor(message,status){super(message);this.status=status}}`:a.path.includes('workspace-access')?`export async function assertOpportunityRead(){throw Error('No database access permitted in extraction test')}`:`export function opportunityDb(r){if(r.error)throw Error('Fixture DB rejected');return r.data}` }));}}]});
const require=createRequire(import.meta.url);const mod={exports:{}};
new Function('require','module','exports',entry.outputFiles[0].text)(require,mod,mod.exports);
const {extractOpportunityFile,opportunityTextChunks,opportunityGenerate}=mod.exports;
const {jsPDF}=require('jspdf');const doc=new jsPDF();
for(let i=0;i<45;i++){if(i)doc.addPage();doc.text(`Pagina ${i+1}: requisito de prueba. La garantia requerida consta en esta pagina y debe revisarse.`,15,25);}
const pdf=await extractOpportunityFile('Bases.pdf',new Uint8Array(doc.output('arraybuffer')));
assert.equal(pdf.status,'read');assert.equal(pdf.total,45);assert.equal(pdf.read,45);assert.match(pdf.sections[44].text,/Pagina 45/);
const {Document,Packer,Paragraph,Table,TableRow,TableCell}=require('docx');
const word=await Packer.toBuffer(new Document({sections:[{children:[new Paragraph('Invitación'),new Table({rows:[new TableRow({children:[new TableCell({children:[new Paragraph('Requisito')]}),new TableCell({children:[new Paragraph('Evidencia') ]})]})]})]}]}));
const extracted=await extractOpportunityFile('Invitación.docx',word);assert.match(extracted.sections[0].text,/Requisito \| Evidencia/);
const XLSX=require('xlsx'),book=XLSX.utils.book_new();for(const name of ['Administrativo','Tecnico'])XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Requisito','Valor'],[name,'=HYPERLINK("https://invalid.test")']]),name);
const sheet=await extractOpportunityFile('Anexos.xlsx',XLSX.write(book,{type:'buffer',bookType:'xlsx'}));assert.equal(sheet.sections.length,2);assert.match(sheet.sections[1].text,/Tecnico/);
const chunks=opportunityTextChunks(pdf.sections);assert.ok(chunks.some(c=>c.locator==='Página 45'));
const {z}=require('zod');const schema=z.object({verdict:z.string()});
const job={id:'job',organization_id:'org',lease_token:'lease',payload:{},kind:'criteria'};
let calls=0,reservation=null,result=null,settlement=null;
const client={from(table){const b={update(){return b},select(){return b},eq(){return b},gt(){return b},async maybeSingle(){return {data:table==='opportunity_jobs'?{id:'job'}:result,error:null}}};return b},async rpc(name,args){
 if(name==='opportunity_budget_reserve'){const fresh=!reservation;reservation??={id:'r',admitted:true};return {data:{...reservation,fresh},error:null};}
 if(name==='opportunity_budget_settle'){settlement=args;result=args.p_data?{data:args.p_data}:null;return {data:true,error:null};}throw Error('Unexpected RPC');}};
process.env.ANTHROPIC_API_KEY='synthetic-not-a-credential';
const generate=async()=>{calls++;return {data:{verdict:'review'},telemetry:{modelName:'claude-haiku-5-5',durationMs:1,usage:{prompt_tokens:100,completion_tokens:50,prompt_tokens_details:{cached_tokens:0}}}};};
await opportunityGenerate(client,job,{step:'screen',category:'evaluation',role:'screen',schema,prompt:'Datos sintéticos'},generate);
await opportunityGenerate(client,job,{step:'screen',category:'evaluation',role:'screen',schema,prompt:'Datos sintéticos'},generate);
assert.equal(calls,1,'a recovered result does not invoke another paid call');assert.ok(settlement.p_cost>0);
result=null;await assert.rejects(opportunityGenerate(client,job,{step:'screen',category:'evaluation',role:'screen',schema,prompt:'Datos sintéticos'},generate),/conciliación/);assert.equal(calls,1);
reservation=null;const timeout=async()=>{calls++;throw Error('Uncertain timeout');};
await assert.rejects(opportunityGenerate(client,job,{step:'other',category:'evaluation',role:'screen',schema,prompt:'Datos sintéticos'},timeout));assert.equal(settlement.p_cost,null,'unknown usage never settles as zero');
console.log('PASS: all 45 PDF pages, Word tables, workbook sheets/formula-like text, page locators, cached AI replay and uncertain-spend fencing. Provider calls=0.');

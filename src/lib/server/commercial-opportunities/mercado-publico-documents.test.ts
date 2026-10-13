import assert from 'node:assert/strict';
import test from 'node:test';
import {publicMercadoDocumentIndex,publicMercadoDownloadControls,publicMercadoQuestions,readPublicMercadoDocuments} from './mercado-publico-documents';
import {assertOpportunityPublicForm} from './workspace-download';
const base='https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=123-4-LR26';
const form='https://www.mercadopublico.cl/Procurement/Modules/Attachment/VerAntecedentes.aspx?enc=public-reference';
const forum='https://www.mercadopublico.cl/Foros/Modules/FNormal/PopUps/PublicView.aspx?qs=public-reference';
const root=`<span id="lblNumLicitacion">123-4-LR26</span><input class="fancyAdjunto" href="${form}"><input class="fancyAdjunto" href="${form}"><input class="fancyAdjunto" href="https://attacker.test/files"><input id="imgPreguntasLicitacion" href="${forum}"><input id="imgAdjuntos" onclick="open('/protected/ViewAttachment.aspx')">`;
const metadata=`<form action="${form}"><input type="hidden" name="__VIEWSTATE" value="public-state"><input type="hidden" name="password" value="must-not-forward"><table><tr><td><span id="grdAttachment_ctl02_grdLblSourceFileName">FORMULARIO 3.docx</span></td><td><input type="image" name="grdAttachment$ctl02$grdIbtnView"></td></tr></table></form>`;
test('only same-site published public controls are discovered; protected inventory is not followed',()=>{
 const index=publicMercadoDocumentIndex(root,base)!;assert.equal(index.code,'123-4-LR26');assert.deepEqual(index.forms,[form]);assert.equal(index.forum,forum);
 assert.equal(publicMercadoDocumentIndex(root,'https://attacker.test/detail'),null);
 assert.equal(publicMercadoDocumentIndex(root.replace('123-4-LR26','unknown'),base),null);
});
test('download form preserves server state and image coordinates, never user fields or another form action',()=>{
 const controls=publicMercadoDownloadControls(metadata,form);assert.equal(controls.length,1);
 assert.equal(controls[0].body.__VIEWSTATE,'public-state');assert.equal(controls[0].body.password,undefined);
 assert.equal(controls[0].body['grdAttachment$ctl02$grdIbtnView.x'],'1');
 assert.deepEqual(publicMercadoDownloadControls(metadata.replace(`action="${form}"`,'action="https://attacker.test/steal"'),form),[]);
});
test('POST is limited to two source read operations, refuses portal mutations and arbitrary params',()=>{
 assert.doesNotThrow(()=>assertOpportunityPublicForm(new URL(form),publicMercadoDownloadControls(metadata,form)[0].body));
 const service='https://www.mercadopublico.cl/Foros/Modules/FNormal/servicesPub.aspx';
 assert.doesNotThrow(()=>assertOpportunityPublicForm(new URL(service),{opt:'101',RFBCode:'9707260'}));
 assert.throws(()=>assertOpportunityPublicForm(new URL(service),{opt:'102',RFBCode:'9707260'}));
 assert.throws(()=>assertOpportunityPublicForm(new URL('https://www.mercadopublico.cl/portal/login'),{password:'value'}));
 assert.throws(()=>assertOpportunityPublicForm(new URL(form),{__VIEWSTATE:'public-state',other:'unsafe'}));
});
test('questions and answers retain paired wording and dates; a malformed result does not mean no questions',()=>{
 const text=publicMercadoQuestions([{Numero:1,Descripcion:'¿Cuántos profesionales?',FechaHora:'09-09-2026',RespuestaPublicada:{Descripcion:'SE REQUIEREN 9 PROFESIONALES',FechaHora:'16-09-2026'}}]);
 assert.match(text,/Pregunta 1/);assert.match(text,/SE REQUIEREN 9 PROFESIONALES/);assert.match(text,/16-09-2026/);
 assert.throws(()=>publicMercadoQuestions({status:403}));
});
test('retriever saves actual binaries and paired public responses, declares incomplete inventory and shares only its own anonymous session',async()=>{
 const calls:any[]=[],saved:any[]=[];
 const download:any=async(url:string,options:any)=>{
  calls.push({url,options});let content,mime='text/html';
  if(url===base)content=root;
  else if(url===form&&!options.publicForm)content=metadata;
  else if(url===form){mime='application/octet-stream';content=Buffer.from([80,75,3,4]);}
  else if(url===forum)content='<span id="externaCode">123-4-LR26</span><input id="h_intRBFCode" value="9707260">';
  else{mime='application/json';content=JSON.stringify([{Numero:1,Descripcion:'Dotación',RespuestaPublicada:{Descripcion:'9 profesionales'}}]);}
  return{url,bytes:Buffer.from(content),mime,name:options.expectedName||'Fuente.html'};
 };
 const result=await readPublicMercadoDocuments(base,async file=>{saved.push(file);},{download});
 assert.equal(result.downloaded,1);assert.equal(result.questions,true);assert.equal(saved.length,2);assert.match(Buffer.from(saved[1].bytes).toString(),/9 profesionales/);
 assert.ok(result.warnings.some(w=>/inventario completo/.test(w)));assert.equal(calls.some(c=>c.url.includes('/protected/')),false);
 assert.ok(calls.every(c=>c.options.session===calls[0].options.session));
});
test('a login/challenge HTML masquerading as a file never counts as a downloaded annex',async()=>{
 const download:any=async(url:string,options:any)=>({url,bytes:Buffer.from(url===base?root.replace(/<input id="imgPreguntasLicitacion"[^>]+>/,''):options.publicForm?'<html>Access denied</html>':metadata),mime:'text/html',name:'Fuente.html'});
 let saved=0;const result=await readPublicMercadoDocuments(base,async()=>{saved++;},{download});assert.equal(saved,0);assert.equal(result.downloaded,0);assert.ok(result.warnings.some(w=>/no pudo descargarse/.test(w)));
});

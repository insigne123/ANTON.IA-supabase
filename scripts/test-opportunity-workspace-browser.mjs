// Render actual components; all APIs synthetic. No env files, provider traffic or production data.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const require=createRequire(import.meta.url);
if(!process.env.PLAYWRIGHT_MODULE||!process.env.AXE_MODULE)throw Error('Explicit browser and axe modules required');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE);
const out=process.argv.find(a=>a.startsWith('--output='))?.slice(9);if(!out)throw Error('Explicit output required');mkdirSync(out,{recursive:true});
const compiled=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {OpportunityWorkWorkspace} from './src/components/commercial-opportunities/OpportunityWorkWorkspace';createRoot(document.getElementById('root')).render(<OpportunityWorkWorkspace/>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"test"','process.env':'{}'},plugins:[{name:'next-link',setup(b){b.onResolve({filter:/^next\/link$/},()=>({path:'link',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`import React from 'react';export default function Link(props){return <a {...props}/>}`,loader:'jsx',resolveDir:process.cwd()}));}}]});
execFileSync(process.execPath,['node_modules/tailwindcss/lib/cli.js','-i','src/app/globals.css','-o',path.join(out,'ui.css')],{stdio:'pipe'});
const css=readFileSync('src/styles/design-tokens.css','utf8')+readFileSync(path.join(out,'ui.css'),'utf8');
const axe=readFileSync(require.resolve(process.env.AXE_MODULE),'utf8');
const op='11111111-1111-4111-8111-111111111111',user='22222222-2222-4222-8222-222222222222';
const item={id:op,kind:'private',title:'Servicio de evaluaciones · invitación privada',company_name:'Empresa de demostración',buyer_name:null,company_domain:null,url:null,score:50,reasons:['Se relaciona con el servicio confirmado del workspace.'],deadline_at:'2026-11-01T17:00:00Z',amount:null,currency:'CLP',data:{evaluation:'review',description:'Texto de invitación de demostración.'},updated_at:'2026-10-12T10:00:00Z'};
const report={title:item.title,executive:'El expediente requiere confirmar el alcance antes de presentar la propuesta. Este escenario es sintético para probar la lectura, la navegación y las acciones.',recommendation:'conditional',reasons:['Falta el anexo de alcance.'],sections:Array.from({length:12},(_,i)=>({id:'s'+i,title:['Contexto y encaje','Alcance solicitado','Requisitos','Estrategia','Condiciones contractuales','Solución y recursos','Hoja de ruta','Finanzas','Riesgos','Preguntas','Documentos','Fuentes'][i],paragraphs:['Desarrollo completo de la sección con consecuencias y próximos pasos.'],facts:[{text:'La fecha consta en la invitación.',state:'documented',citations:[{chunkId:'chunk1',quote:'El cierre es el 1 de noviembre.'}]}]})),requirements:[{title:'Confirmar alcance',status:'pending',action:'Obtener el anexo de alcance',role:'Responsable comercial',due:'Antes de la propuesta',evidence:[]}],tasks:[{title:'Preparar propuesta',role:'Comercial',due:'Tras confirmar alcance',dependency:'Anexo recibido',evidence:'Propuesta revisada'}],milestones:[{label:'Cierre',date:'1 nov 2026',state:'documented',citations:[]}],risks:[{title:'Alcance incompleto',impact:'high',basis:'documented',mitigation:'Solicitar anexo',citations:[]}],scenarios:[],questions:['¿Cuál es el alcance?'],warnings:['El anexo de alcance aún no se recibió.'],generatedAt:'2026-10-12T10:00:00Z',coverage:[{id:'doc1',name:'Invitación.txt',status:'read',pagesRead:0,pagesTotal:null}],sources:[{id:'chunk1',documentId:'doc1',locator:'Texto recibido',name:'Invitación.txt'}]};
const browser=await chromium.launch({headless:true}),evidence=[];
try{
 for(const admin of [false,true])for(const theme of ['light','dark'])for(const width of [390,1440]){
  const context=await browser.newContext({viewport:{width,height:950},reducedMotion:'reduce'});const page=await context.newPage();const errors=[];const actions=[];let revoked=false;
  page.on('pageerror',e=>errors.push(e.message));
  const work={opportunity_id:op,state:'assigned',revision:1,team_id:null,responsible_id:user,objective:'Preparar una evaluación inicial',due_at:'2026-10-25T17:00:00Z'};
  await page.route('**/*',async route=>{
   const r=route.request(),url=new URL(r.url());if(url.hostname!=='opportunities.test')return route.abort();
   if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="es" class="${theme==='dark'?'dark':''}"><head><title>Oportunidades</title><style>${css}</style></head><body><main id="root"></main></body></html>`});
   if(r.method()==='POST'){actions.push(r.postDataJSON());return route.fulfill({json:{ok:true,jobId:'test-job'}});}
   if(url.pathname.endsWith('/workspace')&&url.pathname.includes(op))return route.fulfill(revoked?{status:404,json:{error:'No encontramos esa oportunidad.'}}:{json:{item,work,participants:[{user_id:user,name:'Persona del equipo',role:'member'}],activity:[],tasks:[],documents:[],reports:[{id:'report1',report}],jobs:[],contacts:[],decisionMakerTitles:['Gerente de Personas']}});
   if(url.pathname.endsWith('/chat'))return route.fulfill({json:{messages:[]}});
   if(url.pathname==='/api/commercial-opportunities/workspace')return route.fulfill({json:{mode:admin?'management':'assigned',items:revoked?[]:[item],work:[work],notifications:revoked?[]:[{id:'33333333-3333-4333-8333-333333333333',opportunity_id:op,title:'Oportunidad asignada: '+item.title,created_at:'2026-10-12T10:00:00Z',read_at:null}],members:admin?[{user_id:user,name:'Persona del equipo',role:'member'}]:[],groups:[],context:{offer:'Oferta de demostración confirmada',revision:1,services:['Evaluaciones'],automation:true},budget:{spent:1,reserved:.1,cap:20},sourceStatus:{automation:true}}});
   return route.abort();
  });
  await page.goto('https://opportunities.test/');await page.addScriptTag({content:compiled.outputFiles[0].text});
  await page.getByRole('heading',{name:admin?'Gestionar oportunidades':'Mis oportunidades asignadas',exact:true}).waitFor();
  if(!admin){assert.equal(await page.getByRole('button',{name:'Cargar oportunidad',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Empresa del workspace',exact:true}).count(),0);}
  else {await page.getByRole('button',{name:'Cargar oportunidad',exact:true}).click();await page.getByRole('dialog').waitFor();await page.getByLabel('Nombre de la oportunidad',{exact:true}).fill('Invitación de demostración');await page.getByLabel('Cliente o entidad convocante',{exact:true}).fill('Cliente de prueba');await page.keyboard.press('Escape');}
  await page.getByRole('button',{name:'Oportunidad asignada:',exact:false}).click();
  await page.getByRole('button',{name:'Decisión ejecutiva',exact:true}).waitFor();
  await page.getByRole('button',{name:'Asignar equipo',exact:true}).count().then(n=>assert.equal(n,admin?1:0));
  await page.getByRole('button',{name:'Requisitos y plan',exact:true}).click();
  await page.getByRole('button',{name:'Crear tarea',exact:true}).first().click();await page.getByRole('dialog').waitFor();
  await page.getByLabel('Acción',{exact:true}).fill('Obtener el anexo');await page.getByRole('button',{name:'Guardar',exact:true}).click();
  assert.ok(actions.some(a=>a.action==='task'&&a.data.title==='Obtener el anexo'));
  await page.getByRole('button',{name:'Decisión ejecutiva',exact:true}).click();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.addScriptTag({content:axe});const violations=await page.evaluate(async()=> (await window.axe.run(document,{resultTypes:['violations']})).violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})));
  assert.deepEqual(violations,[]);assert.deepEqual(errors,[]);
  await page.screenshot({path:path.join(out,`${admin?'admin':'member'}-${theme}-${width}.png`),fullPage:true});
  // Revocation removes the private report on the next object poll, not only a menu button.
  revoked=true;await page.waitForTimeout(8500);assert.equal(await page.getByRole('button',{name:'Decisión ejecutiva',exact:true}).count(),0);
  evidence.push({admin,theme,width,overflow:false,axeViolations:0,pageErrors:0,task:true,revocation:true});await context.close();
 }
 console.log(JSON.stringify({scenarios:evidence.length,providerCalls:0,productionWrites:0,output:out}));
}finally{await browser.close();writeFileSync(path.join(out,'evidence.json'),JSON.stringify(evidence,null,2));}

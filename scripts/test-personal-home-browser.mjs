// Personal Today components and hook with deliberately stale responses/scopes. No real data or sends.
import {build} from 'esbuild';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';import path from 'node:path';
const require=createRequire(import.meta.url);const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const out=process.argv.find(a=>a.startsWith('--output='))?.slice(9);if(!out)throw Error('Explicit output required');mkdirSync(out,{recursive:true});
const mock={'next/link':`import React from 'react';export default function Link(props){return <a {...props}/>}`,
  '@/context/AuthContext':`export const useAuth=()=>window.fixtureAuth;`,
  '@/lib/authenticated-api-fetch':`export const authenticatedApiFetch=(path,init)=>fetch(path,init);`};
const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {HomeSummary} from './src/components/home/HomeSummary';import {TodayPanel} from './src/components/home/TodayPanel';import {PersonalCredits} from './src/components/home/PersonalCredits';
  const root=createRoot(document.getElementById('root'));window.homeRender=()=>root.render(<React.StrictMode><main className="mx-auto max-w-5xl space-y-5 p-4"><h1>Hoy</h1><TodayPanel/><HomeSummary/><PersonalCredits/></main></React.StrictMode>);window.homeRender();`,loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"test"'},plugins:[{name:'fixture',setup(b){b.onResolve({filter:/.*/},args=>mock[args.path]?{path:args.path,namespace:'fixture'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture'},args=>({loader:'jsx',resolveDir:process.cwd(),contents:mock[args.path]}));}}]});
execFileSync(process.execPath,['node_modules/tailwindcss/lib/cli.js','-i','src/app/globals.css','-o',path.join(out,'ui.css')],{stdio:'pipe'});
const css=readFileSync('src/styles/design-tokens.css','utf8')+readFileSync(path.join(out,'ui.css'),'utf8');const evidence=[];const browser=await chromium.launch({headless:true});
const axe=process.env.AXE_MODULE?readFileSync(require.resolve(process.env.AXE_MODULE),'utf8'):null;
try{for(const theme of ['light','dark'])for(const width of [390,1440]){
  const context=await browser.newContext({viewport:{width,height:1000},ignoreHTTPSErrors:true,reducedMotion:'reduce'}),page=await context.newPage();
  await page.addInitScript(()=>{window.fixtureAuth={user:{id:'me'},organizationId:'org-a',loading:false};});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));let invalid=false;const delayed=[];
  await page.route('**/*',async route=>{const req=route.request(),url=new URL(req.url());
    if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="es" class="${theme==='dark'?'dark':''}"><head><title>Hoy</title><style>${css}</style></head><body><div id="root"></div></body></html>`});
    const org=req.headers()['x-organization-id'];assert.ok(org,'every read pins its selected tenant');
    if(org==='org-slow')await new Promise(resolve=>{delayed.push(resolve);});
    const scope={userId:invalid?'another':'me',organizationId:org,dayKey:new Intl.DateTimeFormat('en-CA',{timeZone:'America/Santiago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),timeZone:'America/Santiago'};
    if(url.pathname==='/api/home/summary')return route.fulfill({json:{scope,sent:org==='org-a'?2:0,contacted:org==='org-a'?1:0,replied:0,saved:0,partial:false,automaticReplies:0,unclassifiedReplies:0,activity:[]}});
    if(url.pathname==='/api/home/credits')return route.fulfill({json:{scope,personal:{count:org==='org-a'?3:0,limit:50},mode:'user',legacy:false,resetAtISO:'2026-10-11T00:00:00Z'}});
    if(url.pathname==='/api/home/today')return route.fulfill({json:{scope,firstName:'Nicolas',setupDone:0,setup:[],queue:[{id:'older',kind:'reply',title:'Daniela M. te respondió',description:'Léelo y contesta en el mismo hilo.',urgent:false,href:'/contacted?c=older',occurredAt:'2026-03-01T10:00:00Z'}],primary:{title:'Daniela M. te respondió',description:'Pendiente anterior',href:'/contacted?c=older',cta:'Abrir conversación'}}});
    return route.abort();
  });
  await page.goto('https://home.test/');await page.addScriptTag({content:bundle.outputFiles[0].text});
  await page.getByRole('link',{name:/Correos enviados hoy/}).getByText('2',{exact:true}).waitFor();
  await page.locator('time[datetime="2026-03-01T10:00:00Z"]').waitFor();assert.equal(await page.getByText('Daniela Ma***o',{exact:true}).count(),0);
  await page.evaluate(()=>{window.fixtureAuth={...window.fixtureAuth,organizationId:'org-b'};window.homeRender();});
  await page.getByRole('link',{name:/Correos enviados hoy/}).getByText('0',{exact:true}).waitFor();
  assert.equal(await page.getByRole('link',{name:/Correos enviados hoy/}).getByText('2',{exact:true}).count(),0);
  await page.screenshot({path:path.join(out,`today-${theme}-${width}.png`),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  if(axe){await page.addScriptTag({content:axe});const violations=await page.evaluate(async()=>(await window.axe.run(document,{resultTypes:['violations']})).violations.map(v=>({id:v.id,html:v.nodes.map(n=>n.html)})));assert.deepEqual(violations,[]);}
  await page.evaluate(()=>{window.fixtureAuth={...window.fixtureAuth,organizationId:'org-slow'};window.homeRender();});
  for(let i=0;i<100&&delayed.length<3;i++)await page.waitForTimeout(10);assert.ok(delayed.length>=3);
  await page.evaluate(()=>{window.fixtureAuth={...window.fixtureAuth,organizationId:'org-a'};window.homeRender();});
  await page.getByRole('link',{name:/Correos enviados hoy/}).getByText('2',{exact:true}).waitFor();
  delayed.forEach(resolve=>resolve());await page.waitForTimeout(100);
  assert.equal(await page.getByRole('link',{name:/Correos enviados hoy/}).getByText('2',{exact:true}).count(),1,'late old-workspace responses cannot replace the current figures');
  // Scope mismatches must remove personal figures rather than using the payload's identity.
  invalid=true;await page.evaluate(()=>{window.fixtureAuth={...window.fixtureAuth,organizationId:'org-c'};window.homeRender();});
  await page.getByText('No pudimos actualizar tu actividad de hoy.',{exact:true}).waitFor();
  assert.equal(await page.getByRole('link',{name:/Correos enviados hoy/}).count(),0);invalid=false;
  await page.evaluate(()=>{window.fixtureAuth={...window.fixtureAuth,user:{id:'someone'},organizationId:'org-b',loading:true};window.homeRender();});
  assert.equal(await page.getByRole('link',{name:/Correos enviados hoy/}).getByText('2',{exact:true}).count(),0);assert.deepEqual(errors,[]);
  evidence.push({theme,width,personalOnly:true,day:true,olderPendingDated:true,scopeChange:'discard',wrongUserPayload:'rejected',loadingNewUser:'privateResultsRemoved',overflow:false,errors});await context.close();
}
console.log(JSON.stringify({renders:evidence.length,realProviderCalls:0,output:out}));}finally{await browser.close();writeFileSync(path.join(out,'evidence.json'),JSON.stringify(evidence,null,2));}

// Rendered real components + synthetic API fixture. No env files, models, providers or production writes.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
const require=createRequire(import.meta.url);
if(!process.env.PLAYWRIGHT_MODULE||!process.env.AXE_MODULE)throw Error('Explicit PLAYWRIGHT_MODULE and AXE_MODULE required');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE);
const directory=process.argv.find(arg=>arg.startsWith('--output='))?.slice(9);if(!directory)throw Error('Explicit output directory required');mkdirSync(directory,{recursive:true});
const source=await build({entryPoints:['src/lib/admin/usage.ts'],bundle:true,write:false,platform:'node',format:'cjs',packages:'external'});
const loaded={exports:{}};new Function('require','module','exports',source.outputFiles[0].text)(require,loaded,loaded.exports);
const {buildUsageReport}=loaded.exports;
const org='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002',user='00000000-0000-4000-8000-000000000003',user2='00000000-0000-4000-8000-000000000004';
const fact=(extra={})=>({organizationId:org,userId:user,day:'2026-09-01',module:'email',kind:'module_opened',status:'observed',actor:'user',count:1,firstAt:'2026-09-01T12:00:00Z',lastAt:'2026-09-01T13:00:00Z',entityKeys:['one'],...extra});
const input={facts:[fact(),fact({day:'2026-09-02',module:'search'}),fact({kind:'contact_sent',actor:'system',entityKeys:['contact1','contact2'],count:2}),
  fact({kind:'interest',actor:'system',entityKeys:['contact1']}),fact({kind:'meeting_registered',module:'crm',actor:'system',entityKeys:['meeting1']}),fact({organizationId:other,userId:user2,module:'cowork'})],
  credits:[{organizationId:org,userId:user,groupId:null,day:'2026-09-01',resource:'enrich',net:8,debits:10,refunds:2,source:'journal'}],
  cohort:[{organizationId:org,userId:user,recipientKey:'contact1',sentAt:'2026-09-01T12:00:00Z',replyAt:'2026-09-02T12:00:00Z',intent:'positive',reliable:true}],
  people:[{id:user,organizationId:org,name:'Ana Ejemplo',email:'ana@example.test',member:true,groupIds:[]},{id:user2,organizationId:other,name:'Beto Ejemplo',email:'beto@example.test',member:true,groupIds:[]}],
  pending:[{organizationId:org,userId:user,kind:'positive_pending',count:1}],organizations:[{id:org,name:'Empresa demo'},{id:other,name:'Segunda empresa'}],groups:[],
  coverage:{captureFrom:'2026-08-01T00:00:00Z',journalFrom:'2026-08-01T00:00:00Z',unavailable:[],legacyReplies:0,unassignedCredits:0,source:'sql'}};
const mocks={'next/navigation':`export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);export const useRouter=()=>({replace:path=>history.replaceState({},'',path)});`,
  'next/link':`import React from 'react';export default function Link(props){return <a {...props}/>}`,
  '@/context/AuthContext':`export const useAuth=()=>window.usageAuth;`};
const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {UsageDashboard} from './src/components/admin/UsageDashboard';import {UsageCapture} from './src/components/admin/UsageCapture';
  const root=createRoot(document.getElementById('root'));window.renderUsage=()=>root.render(<React.StrictMode><main><UsageDashboard/></main></React.StrictMode>);
  window.renderCapture=()=>root.render(<React.StrictMode><UsageCapture/></React.StrictMode>);window.renderUsage();`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"test"'},
  plugins:[{name:'fixture-next',setup(builder){builder.onResolve({filter:/.*/},args=>mocks[args.path]?{path:args.path,namespace:'fixture'}:undefined);builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mocks[args.path],loader:'jsx',resolveDir:process.cwd()}));}}]});
execFileSync(process.execPath,['node_modules/tailwindcss/lib/cli.js','-i','src/app/globals.css','-o',path.join(directory,'ui.css')],{stdio:'pipe'});
const css=readFileSync('src/styles/design-tokens.css','utf8')+readFileSync(path.join(directory,'ui.css'),'utf8'),axe=readFileSync(require.resolve(process.env.AXE_MODULE),'utf8');
const browser=await chromium.launch({headless:true});const evidence=[];
try{
  for(const theme of ['light','dark'])for(const width of [360,390,768,1440]){
    const context=await browser.newContext({viewport:{width,height:1000},colorScheme:theme,reducedMotion:'reduce',ignoreHTTPSErrors:true});
    const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    let mode='normal',platform=true;const capture=[];
    await page.route('**/*',async route=>{
      const url=new URL(route.request().url());if(url.hostname!=='usage.test')return route.abort();
      if(url.pathname==='/api/usage/view'){capture.push(route.request().postDataJSON());return route.fulfill({json:{recorded:true}});}
      if(url.pathname==='/api/dashboard/admin/usage'){
        await new Promise(resolve=>setTimeout(resolve,130));
        if(mode==='revoked')return route.fulfill({status:403,json:{error:'Acceso administrativo retirado.'}});
        if(mode==='error')return route.fulfill({status:503,json:{error:'La actualización no se completó.'}});
        const q={from:url.searchParams.get('from'),to:url.searchParams.get('to'),horizon:Number(url.searchParams.get('horizon'))};
        const selected=url.searchParams.get('organizationId')||(platform?'all':org),uid=url.searchParams.get('userId');
        const scoped={...input,facts:input.facts.filter(f=>(selected==='all'||f.organizationId===selected)&&(!uid||f.userId===uid)),
          credits:input.credits.filter(c=>(selected==='all'||c.organizationId===selected)&&(!uid||c.userId===uid)),
          cohort:input.cohort.filter(c=>(selected==='all'||c.organizationId===selected)&&(!uid||c.userId===uid)),
          pending:input.pending.filter(c=>(selected==='all'||c.organizationId===selected)&&(!uid||c.userId===uid)),
          people:input.people.filter(p=>(selected==='all'||p.organizationId===selected)&&(!uid||p.id===uid))};
        const data=buildUsageReport(scoped,q,new Date('2026-10-10T12:00:00Z'));
        return route.fulfill({json:{...data,organizations:platform?data.organizations:data.organizations.filter(o=>o.id===org),groups:[],platform,viewerUserId:user,activeOrganizationId:org,selectedOrganizationId:selected,ready:mode!=='setup',limits:[{organizationId:org,userId:user,used:8,limit:100,remaining:92,mode:'user',binding:'user'}]}});
      }
      return route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="es" class="${theme==='dark'?'dark':''}"><head><title>Administración · prueba</title><style>${css}</style></head><body><div id="root" class="mx-auto max-w-[1400px] p-4"></div></body></html>`});
    });
    await page.goto('https://usage.test/dashboard/admin?from=2026-09-01&to=2026-09-30');await page.addScriptTag({content:bundle.outputFiles[0].text});
    await page.getByRole('heading',{name:'Uso, resultados y créditos'}).waitFor();await page.getByText('Personas activas',{exact:true}).waitFor();
    const colors=await page.evaluate(()=>{const probe=document.createElement('div');probe.style.backgroundColor='hsl(var(--background))';document.body.append(probe);const token=getComputedStyle(probe).backgroundColor;probe.remove();return {body:getComputedStyle(document.body).backgroundColor,token,defined:getComputedStyle(document.documentElement).getPropertyValue('--background').trim()};});
    assert.ok(colors.defined);assert.equal(colors.body,colors.token,'render actual light/dark tokens, not unthemed fixture CSS');
    const channels=colors.body.match(/\d+/g).map(Number);assert.ok(channels.every(value=>theme==='dark'?value<40:value>230),'the themes must have different backgrounds');
    await page.locator('.recharts-area-curve').waitFor();
    assert.match(await page.locator('.recharts-area-curve').getAttribute('d'),/^M/,'the trend renders actual data, not only axes');
    await page.screenshot({path:path.join(directory,`summary-${theme}-${width}.png`),fullPage:true});
    await page.getByRole('tab',{name:'Personas',exact:true}).click();await page.getByRole('button',{name:'Ana Ejemplo',exact:true}).waitFor();
    await page.getByLabel('Buscar persona').fill('missing');await page.getByRole('heading',{name:'No encontramos personas'}).waitFor();await page.getByRole('button',{name:'Limpiar filtros'}).click();
    await page.getByRole('button',{name:'Ana Ejemplo',exact:true}).click();await page.getByRole('heading',{name:'Ana Ejemplo'}).waitFor();
    assert.equal(new URL(page.url()).searchParams.get('userId'),user);assert.equal(new URL(page.url()).searchParams.get('organizationId'),org);
    await page.getByRole('tab',{name:'Histórico diario',exact:true}).click();
    await page.getByRole('region',{name:'Resúmenes diarios'}).getByRole('button').last().click();await page.getByRole('dialog').waitFor();
    await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});
    assert.equal(await page.getByRole('region',{name:'Resúmenes diarios'}).getByRole('button').last().evaluate(node=>node===document.activeElement),true,'closing the day returns focus to its button');
    await page.getByRole('tab',{name:'Comercial',exact:true}).click();await page.getByRole('heading',{name:'Conversión de correo'}).waitFor();
    await page.addScriptTag({content:axe});const violations=await page.evaluate(async()=>(await window.axe.run(document,{resultTypes:['violations']})).violations.map(item=>({id:item.id,nodes:item.nodes.map(n=>n.target)})));
    assert.deepEqual(violations,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({path:path.join(directory,`commercial-${theme}-${width}.png`),fullPage:true});
    mode='error';await page.getByRole('button',{name:'Actualizar',exact:true}).click();await page.getByRole('alert').getByText('La actualización no se completó.').waitFor();
    assert.equal(await page.getByRole('heading',{name:'Conversión de correo'}).count(),1,'refresh failure keeps observed data');
    mode='revoked';await page.getByRole('button',{name:'Reintentar',exact:true}).click();await page.getByRole('alert').getByText('Acceso administrativo retirado.').waitFor();
    assert.equal(await page.getByRole('heading',{name:'Conversión de correo'}).count(),0,'revocation removes private results');
    mode='setup';await page.getByRole('button',{name:'Reintentar',exact:true}).click();await page.getByRole('heading',{name:'Estamos preparando la medición'}).waitFor();
    assert.equal(await page.getByText('Personas activas',{exact:true}).count(),0,'missing schema does not render zero usage');
    assert.deepEqual(errors,[]);
    evidence.push({width,theme,overflow:false,axeViolations:0,peopleDrilldown:'passed',daySheetEscape:'passed',refreshError:'keeps_data',revocation:'removes_data',setup:'not_zero',errors});
    // Real capture component: StrictMode, rerenders, URL queries and company changes.
    await page.evaluate(({user,org})=>{window.usageAuth={user:{id:user},organizationId:org,loading:false};history.replaceState({},'','/search?private=sensitive');window.renderCapture();},{user,org});
    await page.waitForFunction(()=>document.querySelector('main')===null);await page.waitForTimeout(150);
    assert.equal(capture.length,1);assert.deepEqual(Object.keys(capture[0]).sort(),['eventId','module','organizationId','sessionId']);assert.equal(capture[0].module,'search');
    await page.evaluate(()=>{history.replaceState({},'','/search?private=other');window.renderCapture();});await page.waitForTimeout(80);assert.equal(capture.length,1);
    await page.evaluate(()=>{history.replaceState({},'','/research?content=private');window.renderCapture();});await page.waitForTimeout(120);assert.equal(capture.length,2);
    await page.evaluate(other=>{window.usageAuth={...window.usageAuth,organizationId:other};window.renderCapture();},other);await page.waitForTimeout(120);assert.equal(capture.length,3);assert.equal(capture[2].organizationId,other);
    assert.equal(JSON.stringify(capture).includes('sensitive'),false);assert.equal(JSON.stringify(capture).includes('content'),false);
    mode='normal';platform=false;
    await page.evaluate(()=>{history.replaceState({},'','/dashboard/admin?from=2026-09-01&to=2026-09-30');window.renderUsage();});
    await page.getByText('Personas activas',{exact:true}).waitFor();assert.equal(await page.getByLabel('Empresa',{exact:true}).count(),0,'company admins have no global company selector');
    await page.getByRole('tab',{name:'Personas',exact:true}).click();await page.getByRole('button',{name:'Ana Ejemplo',exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Beto Ejemplo',exact:true}).count(),0);
    await context.close();
  }
  console.log(JSON.stringify({renders:evidence.length,axeViolations:0,modelCalls:0,providerCalls:0,capturePrivacy:'passed',output:directory}));
}finally{await browser.close();writeFileSync(path.join(directory,'evidence.json'),JSON.stringify({mode:'rendered_fixture_not_production',evidence},null,2));}

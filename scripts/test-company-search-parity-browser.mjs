// Actual search page and clients. Synthetic APIs only; no credentials, providers, costs or remote writes.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
const require=createRequire(import.meta.url);
if(!process.env.PLAYWRIGHT_MODULE)throw Error('Explicit PLAYWRIGHT_MODULE required');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE);
const out=process.argv.find(a=>a.startsWith('--output='))?.slice(9);if(!out)throw Error('Explicit output required');mkdirSync(out,{recursive:true});
const mocks={
  'next/navigation':`export const useRouter=()=>({push(){}});`,
  'next/link':`import React from 'react';export default function Link(props){return <a {...props}/>}`,
  'next/image':`import React from 'react';export default function Image({unoptimized,...props}){return <img {...props}/>}`,
  '@/lib/supabase':`export const supabase={auth:{getSession:async()=>({data:{session:{access_token:'fixture-session',user:{id:'user-a'}}}}),refreshSession:async()=>({data:{session:null}})}};`,
  '@/lib/supabase-service':`export const supabaseService={getLeads:async()=>[],addLeadsDedup:async rows=>{window.saved.push(...rows);return {addedCount:rows.length,duplicateCount:0}}};`,
  '@/lib/services/enriched-leads-service':`export const enrichedLeadsStorage={get:async()=>[],addDedup:async()=>{throw Error('Shallow results must go to saved contacts')}};`,
  '@/lib/services/contacted-leads-service':`export const contactedLeadsStorage={get:async()=>[]};`,
  '@/lib/services/saved-searches-service':`export class DuplicateSavedSearchNameError extends Error{}export const savedSearchesService={getSavedSearches:async()=>[]};`,
  '@/lib/services/organization-service':`export const organizationService={listOrganizations:async()=>({activeOrganizationId:'org-a',organizations:[{id:'org-a',name:'Demo'}]}),getCurrentOrganizationId:async()=> 'org-a',subscribeToCurrentOrganizationChanges:()=>()=>{}};`,
  '@/lib/services/profile-service':`export const profileService={getProfile:async()=>null};`,
  '@/hooks/use-team-locks':`export const useTeamLocks=()=>null;`,
  '@/lib/quota-client':`export const canUseClientQuota=()=>true;export const incClientQuota=()=>{};export const getClientLimit=()=>50;`,
  '@/hooks/use-toast':`export const useToast=()=>({toast:value=>window.notices.push(value)});`,
  '@/lib/auth-scope-cache':`export const readCachedAuthScope=()=>({userId:'user-a',organizationId:'org-a'});`,
};
const compiled=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import Page from './src/app/(app)/search/page';createRoot(document.getElementById('root')).render(<Page/>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"test"','process.env':'{}'},plugins:[{name:'fixture',setup(b){
  b.onResolve({filter:/.*/},args=>args.path==='./supabase'&&args.importer.endsWith('authenticated-api-fetch.ts')?{path:'@/lib/supabase',namespace:'fixture'}:mocks[args.path]?{path:args.path,namespace:'fixture'}:undefined);
  b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mocks[args.path],resolveDir:process.cwd(),loader:'jsx'}));
}}]});
execFileSync(process.execPath,['node_modules/tailwindcss/lib/cli.js','-i','src/app/globals.css','-o',path.join(out,'ui.css')],{stdio:'pipe'});
const css=readFileSync('src/styles/design-tokens.css','utf8')+readFileSync(path.join(out,'ui.css'),'utf8');
const axe=process.env.AXE_MODULE?readFileSync(require.resolve(process.env.AXE_MODULE),'utf8'):null;
const company={id:'apollo-company',name:'Empresa Seleccionada',primary_domain:'selected.example.test',country:'Chile',contact_scope:'signed-selected-domain'};
const leads=Array.from({length:75},(_,i)=>({id:'lf_'+String(i).padStart(24,'0'),name:'Persona '+i+' Pé***z',title:'Gerente',source_provider:'leads_finder',source_provider_id:'lf_'+String(i).padStart(24,'0'),has_email:true,organization_domain:'selected.example.test'}));
const browser=await chromium.launch({headless:true}),evidence=[];
try{
  for(const scenario of [{owner:false,source:'apollo',mode:'filters',width:390,theme:'light'},
    {owner:false,source:'apollo',mode:'company',width:1440,theme:'dark'},
    {owner:true,source:'leads_finder',mode:'filters',width:390,theme:'dark'},
    {owner:true,source:'leads_finder',mode:'company',width:1440,theme:'light'}]){
    const context=await browser.newContext({viewport:{width:scenario.width,height:1000},ignoreHTTPSErrors:true,reducedMotion:'reduce'}),page=await context.newPage();
    const errors=[],calls=[];let checkpoint=null,revision=0,ownerAvailability=scenario.owner;page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>{window.saved=[];window.notices=[];});
    await page.route('**/*',async route=>{
      const request=route.request(),url=new URL(request.url());if(url.hostname!=='search.test')return route.abort();
      if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="es" class="${scenario.theme==='dark'?'dark':''}"><head><title>Buscar prospectos</title><style>${css}</style></head><body><main class="mx-auto max-w-[1440px] p-4"><div id="root"></div></main></body></html>`});
      if(url.pathname==='/api/leads/leads-finder/status')return route.fulfill({json:{available:ownerAvailability}});
      if(url.pathname==='/api/leads/search/checkpoint'){
        if(request.method()==='PUT'){const body=request.postDataJSON();checkpoint=body.snapshot;revision++;return route.fulfill({json:{revision}});}
        return route.fulfill({json:{revision,snapshot:checkpoint,scope:'org-a:user-a'}});
      }
      if(url.pathname==='/api/leads/search'){
        const body=request.postDataJSON();calls.push({path:url.pathname,body});
        if(body.search_mode==='companies')return route.fulfill({json:{count:1,organizations:[company],total_pages:1,page:1,total_entries:1}});
        assert.equal(body.search_mode,'company_people');assert.equal(body.organization_id,company.id);
        return route.fulfill({json:{count:1,leads:[{id:'apollo-person',name:'Persona Apollo',title:'Gerente',source_provider:'apollo'}],total_pages:1,total_entries:1,raw_count:1}});
      }
      if(url.pathname==='/api/leads/leads-finder/search'){
        const body=request.postDataJSON();calls.push({path:url.pathname,body});assert.equal(body.company_scope,company.contact_scope);
        assert.deepEqual(body.company_location,[]);assert.deepEqual(body.company_keywords,[]);assert.equal(body.max_results,100);
        return route.fulfill({json:{leads,count:75,not_applied:[],already_saved:0}});
      }
      return route.abort();
    });
    const mount=async()=>{await page.goto('https://search.test/');await page.addScriptTag({content:compiled.outputFiles[0].text});await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(button=>button.textContent.trim()==='Buscar empresas'&&!button.disabled));};
    await mount();
    if(scenario.owner){await page.getByRole('button',{name:'Leads Finder (prueba)',exact:true}).waitFor();await page.getByRole('button',{name:'Leads Finder (prueba)',exact:true}).click();}
    else {assert.equal(await page.getByText('Fuente de los contactos',{exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Apollo',exact:true}).count(),0);}
    if(scenario.mode==='company'){await page.getByRole('button',{name:'Empresa',exact:true}).click();await page.getByLabel('Empresa *',{exact:true}).fill('Empresa Seleccionada');}
    else await page.getByLabel('Palabras clave de empresa',{exact:true}).fill('logística');
    await page.getByRole('button',{name:'Buscar empresas',exact:true}).click();await page.getByRole('checkbox',{name:'Marcar Empresa Seleccionada'}).waitFor();
    assert.equal(calls.length,1);assert.equal(calls[0].body.search_mode,'companies');
    await page.getByRole('checkbox',{name:'Marcar Empresa Seleccionada'}).check();await page.getByRole('button',{name:'Buscar contactos',exact:true}).click();
    await page.getByRole('heading',{name:'Contactos por empresa'}).waitFor();await page.getByRole('list',{name:'Contactos de Empresa Seleccionada'}).waitFor();
    if(scenario.owner){
      assert.equal(await page.getByRole('list',{name:'Contactos de Empresa Seleccionada'}).locator('li').count(),50);
      const before=calls.filter(c=>c.path.includes('leads-finder')).length;await page.getByRole('button',{name:'Traer 50 más',exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('ul[aria-label="Contactos de Empresa Seleccionada"]')?.children.length===75);
      assert.equal(calls.filter(c=>c.path.includes('leads-finder')).length,before,'showing buffered contacts must not repeat paid search');
      assert.equal(await page.getByRole('button',{name:'Traer 50 más',exact:true}).isDisabled(),true);
      await page.waitForTimeout(700);assert.equal(checkpoint.searchSource,'leads_finder');
      const searches=calls.length;await mount();await page.getByRole('list',{name:'Contactos de Empresa Seleccionada'}).waitFor();
      assert.equal(await page.getByRole('list',{name:'Contactos de Empresa Seleccionada'}).locator('li').count(),75);assert.equal(calls.length,searches,'restore does not call providers');
    }
    await page.getByRole('button',{name:'Marcar todos',exact:true}).click();await page.getByRole('button',{name:scenario.owner?'Guardar 75':'Guardar 1',exact:true}).click();
    const saved=await page.evaluate(()=>window.saved);assert.equal(saved.length,scenario.owner?75:1);assert.ok(saved.every(p=>!p.email&&!p.primaryPhone));
    if(scenario.owner)assert.ok(saved.every(p=>p.sourceProvider==='leads_finder'));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
    if(axe){await page.addScriptTag({content:axe});const violations=await page.evaluate(async()=>(await window.axe.run(document,{resultTypes:['violations']})).violations.map(v=>({id:v.id,targets:v.nodes.map(n=>({target:n.target,html:n.html,summary:n.failureSummary}))})));if(violations.length)console.log(JSON.stringify({scenario,violations}));assert.deepEqual(violations,[]);}
    await page.screenshot({path:path.join(out,`${scenario.source}-${scenario.mode}-${scenario.width}-${scenario.theme}.png`),fullPage:true});
    if(scenario.owner){ownerAvailability=false;await mount();await page.waitForTimeout(250);
      assert.equal(await page.getByRole('button',{name:'Leads Finder (prueba)',exact:true}).count(),0);
      assert.equal(await page.getByRole('list',{name:'Contactos de Empresa Seleccionada'}).count(),0,'revoked source removes its restored contact windows');}
    evidence.push({...scenario,companyFirst:true,save:true,providerCalls:scenario.owner?2:2,bufferNoPaidRepeat:scenario.owner,restoreNoQueries:scenario.owner,overflow:false,pageErrors:0});await context.close();
  }
  console.log(JSON.stringify({scenarios:evidence.length,providerNetworkCalls:0,productionWrites:0,axe:axe?'measured':'not_measured',output:out}));
}finally{await browser.close();writeFileSync(path.join(out,'evidence.json'),JSON.stringify(evidence,null,2));}

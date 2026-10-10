// Actual contact-data dialog in Chrome. No credentials, provider calls or writes.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const out=process.argv.find(a=>a.startsWith('--output='))?.slice(9);
if(!out)throw Error('Explicit output required');mkdirSync(out,{recursive:true});
const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {EnrichmentOptionsDialog} from './src/components/enrichment/enrichment-options-dialog';createRoot(document.getElementById('root')).render(<main><h1>Completar contactos</h1><EnrichmentOptionsDialog open onOpenChange={()=>{}} leadCount={2} onConfirm={value=>window.confirmed=value}/></main>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"test"'}});
execFileSync(process.execPath,['node_modules/tailwindcss/lib/cli.js','-i','src/app/globals.css','-o',path.join(out,'ui.css')],{stdio:'pipe'});
const css=readFileSync('src/styles/design-tokens.css','utf8')+readFileSync(path.join(out,'ui.css'),'utf8');
const axe=process.env.AXE_MODULE?readFileSync(require.resolve(process.env.AXE_MODULE),'utf8'):null;
const browser=await chromium.launch({headless:true}),evidence=[];
try{
  for(const theme of ['light','dark'])for(const width of [390,1440]){
    const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'}),page=await context.newPage();
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',route=>new URL(route.request().url()).pathname==='/'?route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="es" class="${theme==='dark'?'dark':''}"><head><title>Completar contactos</title><style>${css}</style></head><body><div id="root"></div></body></html>`}):route.abort());
    await page.goto('https://credits.test/');await page.addScriptTag({content:bundle.outputFiles[0].text});
    const dialog=page.getByRole('dialog');await dialog.waitFor();
    await dialog.getByText('2 créditos de ANTON.IA',{exact:true}).waitFor();
    await dialog.getByRole('checkbox',{name:/Obtener teléfono móvil/}).check();
    assert.equal(await dialog.getByText('2 créditos de ANTON.IA',{exact:true}).count(),1,'requesting both fields does not invent 22 internal credits');
    await dialog.getByRole('checkbox',{name:/Obtener correo laboral/}).uncheck();
    assert.equal(await dialog.getByText('2 créditos de ANTON.IA',{exact:true}).count(),1);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    if(axe){await page.addScriptTag({content:axe});const violations=await page.evaluate(async()=>(await window.axe.run(document,{resultTypes:['violations']})).violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})));assert.deepEqual(violations,[]);}
    await page.screenshot({path:path.join(out,`credits-${theme}-${width}.png`),fullPage:true});
    await dialog.getByRole('button',{name:'Completar datos',exact:true}).click();
    assert.deepEqual(await page.evaluate(()=>window.confirmed),{revealEmail:false,revealPhone:true});assert.deepEqual(errors,[]);
    evidence.push({theme,width,internalCredits:2,fields:'phone',overflow:false,pageErrors:0,axe:axe?'measured':'not_measured'});await context.close();
  }
  console.log(JSON.stringify({renders:evidence.length,providerCalls:0,productionWrites:0,output:out}));
}finally{await browser.close();writeFileSync(path.join(out,'evidence.json'),JSON.stringify(evidence,null,2));}

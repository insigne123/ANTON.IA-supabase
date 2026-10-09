// Rendered multi-file acceptance and preview states. No model, provider or production writes.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const require=createRequire(import.meta.url);
if(!process.env.PLAYWRIGHT_MODULE||!process.env.AXE_MODULE)throw Error('Explicit PLAYWRIGHT_MODULE and AXE_MODULE required');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE);
const directory=process.argv.find(arg=>arg.startsWith('--output='))?.slice(9);
if(!directory)throw Error('Explicit --output directory required');mkdirSync(directory,{recursive:true});
const serverBundle=await build({entryPoints:['src/lib/server/cowork/static-preview.ts'],bundle:true,write:false,platform:'node',format:'cjs',packages:'external'});
const loaded={exports:{}};new Function('require','module','exports',serverBundle.outputFiles[0].text)(require,loaded,loaded.exports);
const css=readFileSync('src/styles/design-tokens.css','utf8')+`body{margin:0;background:var(--cw-bg);color:var(--cw-text);font:16px/1.55 system-ui}main{max-width:720px;margin:auto;padding:24px}h1{font-size:28px}p{color:var(--cw-muted)}label{display:block;margin-top:20px;font-weight:600}input{box-sizing:border-box;width:100%;padding:10px;background:var(--cw-panel);color:var(--cw-text);border:1px solid var(--cw-border);border-radius:10px;font:inherit}button{padding:10px 18px;min-height:44px;margin-top:16px;background:var(--cw-accent);color:var(--cw-on-accent);border:0;border-radius:10px;font:inherit;font-weight:600}output{display:block;font-size:24px;margin-top:20px}:focus-visible{outline:3px solid var(--cw-accent);outline-offset:3px}`;
const js=`document.documentElement.classList.toggle('dark',matchMedia('(prefers-color-scheme:dark)').matches);document.getElementById('calculator').addEventListener('submit',e=>{e.preventDefault();document.getElementById('result').textContent=Number(document.getElementById('records').value)*2+' minutos estimados';});window.parentReadable=false;try{void parent.document.body;window.parentReadable=true}catch{};`;
const files=new Map([['styles.css',Buffer.from(css)],['app.js',Buffer.from(js)]]);
const manifest=[...files].map(([name,bytes])=>({name,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),at:''}));
const html=Buffer.from('<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Miniapp comercial</title><link rel="stylesheet" href="styles.css"></head><body><main><h1>Estimar esfuerzo</h1><p>Define tu número de registros. Cada registro usa el supuesto de dos minutos para este ejemplo.</p><form id="calculator"><label for="records">Registros</label><input id="records" type="number" min="0" max="1000" required><button>Calcular</button></form><output id="result" role="status" aria-live="polite">Completa tus supuestos.</output></main><script src="app.js"></script></body></html>');
const assembled=await loaded.exports.buildCoworkStaticPreview(html,manifest,async file=>files.get(file.name));
const clientBundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {ArtifactPreview} from './src/components/cowork/ArtifactPreview';const root=createRoot(document.getElementById('root'));window.renderPreview=id=>root.render(<main className="mx-auto max-w-3xl p-4"><h1 className="text-xl font-semibold mb-4">Resultado del trabajo</h1><ArtifactPreview key={id} runId={id} name="miniapp.html" defaultOpen onAccessDenied={()=>window.accessDenied=true}/></main>);window.renderPreview('valid');`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"test"'}});
execFileSync(process.execPath,['node_modules/tailwindcss/lib/cli.js','-i','src/app/globals.css','-o',path.join(directory,'ui.css')],{stdio:'pipe'});
const uiCss=readFileSync(path.join(directory,'ui.css'),'utf8')+readFileSync('src/styles/design-tokens.css','utf8');
const axe=readFileSync(require.resolve(process.env.AXE_MODULE),'utf8');
const csp="sandbox allow-scripts allow-forms; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; base-uri 'none'; form-action 'none'";
const evidence=[];const browser=await chromium.launch({headless:true});
try{
  for(const theme of ['light','dark'])for(const width of [360,390,768,1024,1440]){
    const page=await browser.newPage({viewport:{width,height:900},colorScheme:theme,reducedMotion:'reduce'});const external=[],errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    const consoleErrors=[];page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});
    await page.route('**/*',async route=>{
      const url=new URL(route.request().url());if(url.hostname!=='cowork.test'){external.push(url.href);return route.abort();}
      if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="es" class="${theme}"><head><title>Vista de trabajo</title><style>${uiCss}</style></head><body><div id="root"></div></body></html>`});
      if(url.pathname.includes('/broken/'))return route.fulfill({status:422,json:{error:'Falta la revisión publicada de styles.css.'}});
      if(url.pathname.includes('/revoked/'))return route.fulfill({status:403,json:{error:'Acceso revocado'}});
      await new Promise(resolve=>setTimeout(resolve,150));
      return route.fulfill({contentType:'text/html',headers:{'Content-Security-Policy':csp,'X-ANTON-Preview':'assembled-not-verified'},body:assembled.bytes.toString('utf8')});
    });
    await page.goto('http://cowork.test/');await page.addScriptTag({content:clientBundle.outputFiles[0].text});
    await page.getByText('Preparando la vista previa…').waitFor();
    const frame=page.frameLocator('iframe');await frame.getByRole('heading',{name:'Estimar esfuerzo'}).waitFor();
    assert.equal(await page.locator('iframe').getAttribute('sandbox'),'allow-scripts allow-forms');
    await frame.getByLabel('Registros').fill('12');await frame.getByRole('button',{name:'Calcular'}).click();
    const value=await frame.locator('#result').innerText();
    if(value!=='24 minutos estimados')console.log(JSON.stringify({diagnostic:'calculator_did_not_update',consoleErrors,errors}));
    assert.equal(value,'24 minutos estimados');
    const inner=page.frames().find(frame=>frame.url().includes('/artifacts'));
    assert.equal(await inner.evaluate(()=>window.parentReadable),false);
    assert.equal(await inner.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await inner.evaluate(()=>{const form=document.createElement('form');form.action='https://outside.test/submit';form.method='POST';document.body.append(form);form.submit();form.remove();});
    assert.equal(await frame.locator('#result').innerText(),'24 minutos estimados','form-action blocks external submit without replacing the preview');
    await frame.getByLabel('Registros').focus();await page.keyboard.press('Tab');assert.equal(await frame.getByRole('button',{name:'Calcular'}).evaluate(node=>node===document.activeElement),true);
    await inner.evaluate(axe);const violations=await inner.evaluate(async()=> (await window.axe.run(document,{resultTypes:['violations']})).violations.map(item=>item.id));
    await page.addScriptTag({content:axe});
    const parentViolations=await page.evaluate(async()=> (await window.axe.run(document,{resultTypes:['violations']})).violations.map(item=>item.id));
    await page.screenshot({path:path.join(directory,`multi-${theme}-${width}.png`),fullPage:true});
    await page.evaluate(()=>window.renderPreview('broken'));await page.getByRole('alert').waitFor();assert.equal(await page.locator('iframe').count(),0);
    assert.equal(await page.getByRole('button',{name:'Reintentar vista previa'}).isVisible(),true);
    await page.evaluate(()=>window.renderPreview('revoked'));await page.getByText('Acceso revocado',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.accessDenied),true);assert.equal(await page.locator('iframe').count(),0);
    assert.deepEqual(external,[]);assert.deepEqual(errors,[]);assert.deepEqual(violations,[]);assert.deepEqual(parentViolations,[]);
    evidence.push({theme,width,assembledFiles:assembled.assets,computedOutput:'24 minutos estimados',overflow:false,axeViolations:violations,parentAxeViolations:parentViolations,errors,externalRequests:external,loading:'passed',errorRecovery:'passed',revocation:'passed',keyboard:'passed',opaqueOrigin:'passed',externalFormSubmission:'blocked_by_csp'});await page.close();
  }
}finally{await browser.close();writeFileSync(path.join(directory,'evidence.json'),JSON.stringify({mode:'rendered-fixture-not-production',evidence},null,2));}
console.log(JSON.stringify({renders:evidence.length,sourceFiles:3,modelCalls:0,remoteJobs:0,violations:0,output:directory}));

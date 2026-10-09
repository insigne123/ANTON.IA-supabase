// Full workspace DOM acceptance of older pages. Fixture reads only; no credentials, database or model calls.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
const id=index=>`00000000-0000-4000-8000-${String(index).padStart(12,'0')}`;
const run=index=>({id:id(index),root_run_id:id(1),parent_run_id:index>1?id(index-1):null,message:`Solicitud ${index}`,mode:'approval',status:'completed',created_at:'2026-10-09T00:00:00Z'});
const events=index=>[{sequence:1,kind:'run.completed',created_at:'2026-10-09T00:00:00Z',payload:{reply:`Respuesta ${index}`,document:index===1?{title:'Informe inicial recuperable',content:'Contenido del resultado antiguo.'}:null}}];
const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {CoworkWorkspace} from './src/components/cowork/CoworkWorkspace';createRoot(document.getElementById('root')).render(<CoworkWorkspace/>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"test"'}});
const dom=new JSDOM('<div id="root"></div>',{url:`http://localhost/cowork?work=${id(12)}`,runScripts:'outside-only',pretendToBeVisual:true});
const {window}=dom;const calls=[];let denied=false;let failPage=true;
const json=(body,status=200)=>({ok:status<400,status,json:async()=>body});
window.fetch=async(url,init={})=>{
  calls.push({url,method:init.method||'GET'});
  if(denied)return json({error:'Acceso revocado'},403);
  if(url==='/api/cowork/runs')return json({runs:[run(12)],canSubmit:true});
  if(url.endsWith('/versions'))return json({versions:[],currentRevision:null});
  const match=/\/runs\/([0-9a-f-]{36})$/.exec(url);
  if(match){const index=Number(match[1].slice(-12));if(index===4&&failPage)return json({error:'No pudimos recuperar esa página.'},503);
    const first=Math.max(1,index-8),ancestors=Array.from({length:index-first},(_,i)=>({run:run(first+i),events:events(first+i)}));
    return json({run:run(index),events:events(index),ancestors,olderTurnsOmitted:first>1});}
  return json({});
};
const wait=async(predicate,label)=>{for(let i=0;i<300;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,10));}throw Error(`Timed out: ${label}`);};
const button=text=>[...window.document.querySelectorAll('button')].find(node=>node.textContent.trim()===text);
try{
  window.eval(bundle.outputFiles[0].text);await wait(()=>button('Ver mensajes anteriores'),'older action');
  button('Ver mensajes anteriores').click();await wait(()=>window.document.body.textContent.includes('No pudimos recuperar esa página'),'error');
  assert.match(window.document.body.textContent,/Respuesta 12/,'failure preserves recent messages');
  failPage=false;button('Ver mensajes anteriores').click();
  await wait(()=>window.document.querySelector('[aria-label="Abrir Informe inicial recuperable"]'),'old artifact');
  assert.equal(button('Ver mensajes anteriores'),undefined,'beginning reached');
  await wait(()=>window.document.activeElement?.getAttribute('data-cowork-turn')===id(4),'focus after the history action leaves');
  window.document.querySelector('[aria-label="Abrir Informe inicial recuperable"]').click();
  await wait(()=>window.document.body.textContent.includes('Contenido del resultado antiguo.'),'opened old document');
  assert.equal(new URL(window.location.href).searchParams.get('work'),id(12),'old results do not replace active conversation');
  assert.equal(calls.filter(call=>call.url.includes('/wake')).length,0,'history pagination does not run workers');
  assert.equal(calls.some(call=>call.method==='POST'),false);
  denied=true;window.document.querySelector('[aria-label="Cerrar resultado"]')?.click();
  window.history.pushState(null,'',`?work=${id(11)}`);window.dispatchEvent(new window.PopStateEvent('popstate'));
  await wait(()=>window.document.body.textContent.includes('Acceso revocado'),'revocation');
  await wait(()=>!window.document.body.textContent.includes('Contenido del resultado antiguo.'),'private result withdrawn');
  assert.equal(window.document.body.textContent.includes('Contenido del resultado antiguo.'),false);
  console.log('PASS: older pages, retry without losing current context, opening old results, stable active URL, no writes/wake and access revocation.');
}finally{window.close();}

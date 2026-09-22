import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const { chromium } = await import(pathToFileURL(process.argv[2]).href);
const compiled = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import Workspace from './src/components/contacted/ConversationsWorkspace'; createRoot(document.getElementById('root')).render(<Workspace/>);`, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"test"', 'process.env.NEXT_PUBLIC_SUPABASE_URL': '"https://example.supabase.co"', 'process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY': '"fixture"' } });
const files = await readdir('.next/static/css');
const css = (await Promise.all(files.filter(f => f.endsWith('.css')).map(f => readFile(resolve('.next/static/css', f),'utf8')))).join('\n');
const server = createServer((req,res) => { res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript': 'text/html'); res.end(req.url==='/bundle.js' ? compiled.outputFiles[0].text : `<html><head><style>${css}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>`); }).listen(0,'127.0.0.1');
await new Promise(r => server.once('listening',r));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const row = { id:'contact-1',user_id:'owner',organization_id:'org',name:'Ana Prueba',email:'ana@example.test',company:'Demo',provider:'gmail',sent_at:'2026-09-20T12:00:00Z',replied_at:'2026-09-22T12:00:00Z',reply_intent:'meeting_request',subject:'Propuesta',reply_preview:'Conversemos',reply_sync_succeeded_at:'2026-09-22T12:05:00Z' };
try {
  for (const width of [360,768,1440]) for (const theme of ['light','dark']) {
    const page=await browser.newPage({viewport:{width,height:900}});
    await page.addInitScript(() => { window.process = { env: { NODE_ENV: 'test' } }; });
    page.on('pageerror', error => console.error(error.message));
    await page.route('**/api/**', async route => {
      const path=new URL(route.request().url()).pathname;
      let data={ok:true};
      if(path==='/api/contacted/conversations') data={rows:[row],plans:{touches:[],complete:true},coverageComplete:true,nextOffset:null,userId:'owner'};
      if(path.endsWith('/conversation')) data={messages:[{id:'m',direction:'inbound',receivedAt:row.replied_at,text:'Podemos reunirnos mañana',source:'stored'}],plans:{touches:[],complete:true},canResolve:true,trackingEvents:[],providerComplete:false,work:{}};
      if(path.endsWith('/work')) data={ok:true,value:{action:'meeting',title:'Coordinar una reunión',reason:'Solicitó conversar',replyId:'reply',confidence:0.9}};
      await route.fulfill({json:data});
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.evaluate(theme => document.documentElement.classList.toggle('dark',theme==='dark'),theme);
    await page.getByRole('button',{name:/Ana Prueba/}).click();
    await page.getByRole('heading',{name:'Siguiente acción'}).waitFor();
    await page.getByRole('button',{name:'Analizar respuesta con IA'}).click();
    await page.getByRole('heading',{name:'Coordinar una reunión'}).waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${width}/${theme} horizontal overflow`);
    await page.getByLabel('Qué harás').fill('Confirmar horario');
    await page.getByLabel('Fecha y hora local').fill('2026-10-01T10:00');
    await page.keyboard.press('Escape');
    assert.match(await page.evaluate(()=>document.activeElement?.textContent || ''),/Ana Prueba/);
    await page.close();
  }
  console.log('PASS: rendered workspace 360/768/1440 light/dark, work form, AI recommendation, no page horizontal overflow, Escape and focus restoration. Mock API, no real sends.');
} finally { await browser.close(); server.close(); }

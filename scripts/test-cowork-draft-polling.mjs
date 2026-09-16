import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
const bundle = await build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {ResearchDraft} from './src/components/cowork/ResearchDraft';createRoot(document.getElementById('root')).render(<ResearchDraft runId="run" snapshotId="snapshot" onAccessDenied={()=>{}}/>);`, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"test"' } });
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost', runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;
let created = false, reads = 0, writes = 0;
window.fetch = async (_url, options = {}) => {
  if (options.method === 'POST') { writes++; created = true; return { ok: true, status: 202, json: async () => ({ status: 'pending' }) }; }
  reads++;
  return { ok: true, status: 200, json: async () => created ? { status: 'completed', draft: { id: 'draft', subject: 'Resultado recuperado', text: 'Texto' } } : { status: 'none' } };
};
const wait = async predicate => { for (let i=0;i<150;i++) { if(predicate()) return; await new Promise(resolve=>setTimeout(resolve,10)); } throw new Error('Polling did not recover completion'); };
try {
  window.eval(bundle.outputFiles[0].text);
  await wait(()=>reads===1 && window.document.querySelector('button'));
  window.document.querySelector('button').click();
  await wait(()=>window.document.body.textContent.includes('Resultado recuperado'));
  assert.equal(writes,1); assert.ok(reads>=2);
  assert.equal(window.document.querySelector('a').getAttribute('href'), '/contact/compose?draftId=draft');
  console.log('PASS: first enqueue triggers status recovery without remount or second generation.');
} finally { window.close(); }

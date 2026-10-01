// The live card of the research a conversation started: «Investigando 2 · 1 lista», each person on demand, the promise
// that Cowork tells back, and nothing when nothing runs. Isolated DOM test, not visual certification.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const RUN = '00000000-0000-4000-8000-0000000000a1';
async function render(progress) {
  const bundle = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
    import {ResearchProgress} from './src/components/cowork/ResearchProgress';
    createRoot(document.getElementById('root')).render(<ResearchProgress runId="${RUN}" onAccessDenied={()=>{window.__denied=true}} />);`,
  resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"test"' } });
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/cowork', runScripts: 'outside-only', pretendToBeVisual: true });
  const requests = [];
  dom.window.fetch = async url => { requests.push(url); return { ok: true, status: 200, json: async () => progress }; };
  dom.window.eval(bundle.outputFiles[0].text);
  for (let i = 0; i < 50; i++) await new Promise(resolve => setTimeout(resolve, 10));
  return { dom, requests };
}

const active = { active: true, label: 'Investigando 2 · 1 lista', items: [
  { leadId: '00000000-0000-4000-8000-0000000000b1', name: 'Rafael Du***n', company: 'R&D Montajes', status: 'completed' },
  { leadId: '00000000-0000-4000-8000-0000000000b2', name: 'Susana Cáceres', company: 'MSTI', status: 'running' },
  { leadId: '00000000-0000-4000-8000-0000000000b3', name: 'Ana Pérez', company: null, status: 'queued' },
] };
let view = await render(active);
try {
  const document = view.dom.window.document;
  assert.deepEqual(view.requests, [`/api/cowork/runs/${RUN}/research-progress`]);
  assert.equal(document.querySelector('[role="status"]').textContent, 'Investigando 2 · 1 lista');
  assert.match(document.body.textContent, /Te aviso aquí cuando terminen/);
  const toggle = document.querySelector('button[aria-expanded]');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(document.querySelectorAll('li').length, 0, 'the people show on demand');
  toggle.click();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  const rows = [...document.querySelectorAll('li')].map(li => li.textContent);
  assert.deepEqual(rows, ['Rafael D. · R&D Montajeslista', 'Susana Cáceres · MSTIsigue en curso', 'Ana Pérezsigue en curso']);
  assert.doesNotMatch(document.body.textContent, /\*\*\*/, 'a hidden surname never shows its asterisks');
} finally { view.dom.window.close(); }

view = await render({ active: false, label: '2 investigaciones terminadas', items: active.items.map(item => ({ ...item, status: 'completed' })) });
try {
  assert.equal(view.dom.window.document.querySelector('section'), null, 'nothing runs: no card (the notice turn tells the rest)');
} finally { view.dom.window.close(); }

console.log('PASS: live research card with the count, each person on demand without asterisks, the promise to tell back, and nothing when nothing runs.');

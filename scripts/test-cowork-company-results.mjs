import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const events = [{ kind: 'tool.completed', payload: { action: 'prospecting.search', result: {
  scope: 'external_company_search', truncated: true,
  items: [{ id: 'apollo-company:one', name: 'Empresa Uno', domain: 'example.com', employees: 80, website: 'https://example.com' }],
} } }];
const bundle = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {ContactResults} from './src/components/cowork/ContactResults'; createRoot(document.getElementById('root')).render(<ContactResults runId="test" events={${JSON.stringify(events)}} canResearch={true} onError={()=>{}} onAccessDenied={()=>{}}/>);`, resolveDir: process.cwd(), loader: 'tsx' },
  bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"test"' } });
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/cowork', runScripts: 'outside-only', pretendToBeVisual: true });
try {
  dom.window.eval(bundle.outputFiles[0].text);
  for (let i = 0; i < 100 && !dom.window.document.querySelector('section'); i++) await new Promise(resolve => setTimeout(resolve, 10));
  const text = dom.window.document.body.textContent;
  assert.match(text, /Empresas encontradas/);
  assert.match(text, /example.com/);
  assert.match(text, /80 empleados/);
  assert.match(text, /La descarga incluye 1 empresa,/);
  assert.doesNotMatch(text, /Guardar contacto|Investigar contacto/);
  assert.equal(dom.window.document.querySelectorAll('li').length, 1);
  console.log('PASS: company results render domains/counts and never expose person actions. DOM only, not visual certification.');
} finally { dom.window.close(); }

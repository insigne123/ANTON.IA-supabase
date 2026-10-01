// Cowork contact tables never show the provider's asterisks: a hidden surname reads «Rafael D.» with when the full name
// arrives, and a complete name reads as it is (docs/contactos-identidad.md). Isolated DOM test, not visual certification.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const events = [{ kind: 'tool.completed', payload: { action: 'prospecting.search', result: {
  scope: 'external_search', truncated: false,
  items: [
    { id: 'apollo:p1', name: 'Rafael Du***n', title: 'Jefe de Operaciones', company: 'R&D Montajes', email: null, status: 'No guardado' },
    { id: 'apollo:p2', name: 'Susana Cáceres', title: 'Human Resources Manager', company: 'MSTI EIRL', email: null, status: 'No guardado' },
  ],
} } }];
const bundle = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {ContactResults} from './src/components/cowork/ContactResults'; createRoot(document.getElementById('root')).render(<ContactResults runId="test" events={${JSON.stringify(events)}} canResearch={true} onError={()=>{}} onAccessDenied={()=>{}}/>);`, resolveDir: process.cwd(), loader: 'tsx' },
  bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"test"' } });
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/cowork', runScripts: 'outside-only', pretendToBeVisual: true });
try {
  dom.window.eval(bundle.outputFiles[0].text);
  for (let i = 0; i < 100 && !dom.window.document.querySelector('li'); i++) await new Promise(resolve => setTimeout(resolve, 10));
  const rows = [...dom.window.document.querySelectorAll('li')].map(li => li.textContent);
  assert.equal(rows.length, 2);
  assert.match(rows[0], /Rafael D\.apellido al buscar el correo/);
  assert.doesNotMatch(dom.window.document.body.textContent, /\*\*\*/, 'the asterisks never reach the screen');
  assert.equal(dom.window.document.querySelector('li [title]')?.getAttribute('title'), 'El proveedor oculta el apellido hasta que buscas el correo.');
  assert.match(rows[1], /Susana Cáceres/);
  assert.doesNotMatch(rows[1], /apellido al buscar/);
  console.log('PASS: hidden surnames read «Rafael D.» with when the full name arrives; complete names read as they are. DOM only, not visual certification.');
} finally { dom.window.close(); }

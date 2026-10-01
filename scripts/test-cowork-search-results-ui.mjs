// The search card and its results: «empresas primero» explained before approving (how it searches, how many, the quota),
// and the results grouped by company with why each person is on the list and «Traer más». Isolated DOM test, not visual certification.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const criteria = { titles: ['Gerente de Personas', 'Jefe de Reclutamiento'], industries: ['servicios', 'outsourcing'], locations: ['Santiago, Chile'], limit: 25,
  rolePolicy: { decisionTerms: ['gerente de personas'], userTerms: [], referralTerms: ['analista'], excludeTerms: [] } };
const person = (id, name, title, company, fit) => ({ id: `apollo:${id}`, name, title, company, email: null, status: 'No guardado', industry: 'outsourcing', location: 'Santiago, Chile', fit });
const result = { scope: 'external_search', provider: 'apollo', strategy: 'companies_first', limit: 25, page: 1, offset: 0, returned: 4, hasMore: true, truncated: true,
  next: { page: 1, offset: 25 }, companies: { found: 60, withPeople: 2 }, items: [
    person('a1', 'Ana P***z', 'Gerente de Personas', 'Servicios Andes', 'Posible comprador: cargo con «gerente de personas» · outsourcing, 120 empleados'),
    person('a2', 'Luis R***s', 'Analista de Selección', 'Servicios Andes', 'Puede derivarte: cargo con «analista» · outsourcing, 120 empleados'),
    person('b1', 'Marta S***a', 'Gerente de Personas', 'Grupo Sur', 'Posible comprador: cargo con «gerente de personas» · outsourcing, 80 empleados'),
    person('b2', 'Pedro T***s', 'Analista', 'Grupo Sur', 'Puede derivarte: cargo con «analista» · outsourcing, 80 empleados'),
  ] };

async function render(component) {
  const bundle = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
    import {ContactResults} from './src/components/cowork/ContactResults';
    import {CoworkApproval} from './src/components/cowork/CoworkApproval';
    window.__sent = [];
    createRoot(document.getElementById('root')).render(${component});`, resolveDir: process.cwd(), loader: 'tsx' },
  bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"test"' } });
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/cowork', runScripts: 'outside-only', pretendToBeVisual: true });
  dom.window.fetch = async () => ({ ok: true, json: async () => ({}) });
  dom.window.__events = [{ kind: 'tool.completed', payload: { action: 'prospecting.search', input: criteria, result }, sequence: 3, created_at: '2026-10-01T12:00:00Z' }];
  dom.window.__proposal = { type: 'search', payload: { criteria }, state: 'pending', title: 'Buscar contactos', label: '', icon: 'search' };
  dom.window.eval(bundle.outputFiles[0].text);
  for (let i = 0; i < 100 && !dom.window.document.querySelector('#root *'); i++) await new Promise(resolve => setTimeout(resolve, 10));
  return dom;
}
const button = (document, text) => [...document.querySelectorAll('button')].find(node => node.textContent.trim() === text);

let dom = await render('<ContactResults runId="run-1" events={window.__events} onError={()=>{}} onAccessDenied={()=>{}} onSend={message => window.__sent.push(message)} />');
try {
  const document = dom.window.document;
  const text = document.body.textContent;
  const headers = [...document.querySelectorAll('li')].filter(li => /personas$/.test(li.textContent.trim())).map(li => li.textContent.trim());
  assert.deepEqual(headers, ['Servicios Andes · outsourcing· 2 personas', 'Grupo Sur · outsourcing· 2 personas'], 'each company once, over its people');
  // Under its company, each person says why they are there; the company facts are said once, in the header.
  const fits = [...document.querySelectorAll('p[title]')].filter(node => node.getAttribute('title').startsWith('Posible comprador'));
  assert.deepEqual(fits.map(node => node.textContent), ['Posible comprador: cargo con «gerente de personas»', 'Posible comprador: cargo con «gerente de personas»']);
  assert.equal(fits[0].getAttribute('title'), 'Posible comprador: cargo con «gerente de personas» · outsourcing, 120 empleados');
  assert.match(text, /Hay más resultados con estos criterios/);
  assert.doesNotMatch(text, /no representa toda tu base/, 'an external search with more results is not a cut of the own base');
  button(document, 'Traer más').click();
  assert.deepEqual([...dom.window.__sent], ['Trae más resultados de la última búsqueda.']);
} finally { dom.window.close(); }

dom = await render('<ContactResults runId="run-1" events={window.__events} onError={()=>{}} onAccessDenied={()=>{}} onSend={null} sendHint="Primero aprueba o descarta la propuesta pendiente." />');
try {
  const document = dom.window.document;
  assert.equal(button(document, 'Traer más').disabled, true);
  assert.match(document.body.textContent, /Primero aprueba o descarta la propuesta pendiente\./);
} finally { dom.window.close(); }

dom = await render('<CoworkApproval run={{ id: "run-1", status: "waiting_approval" }} proposal={window.__proposal} resolving={false} interactive onResolve={()=>{}} />');
try {
  const text = dom.window.document.body.textContent;
  assert.match(text, /Empresas primero/);
  assert.match(text, /Hasta 100 empresas de esos rubros y, dentro de ellas, las personas con esos cargos o parecidos\./);
  assert.match(text, /Hasta 25 personas/);
  assert.match(text, /Rubros de las empresas/);
  assert.match(text, /Se buscan empresas de esos rubros y, dentro de ellas, hasta 25 contactos nuevos en el proveedor \(1 búsqueda de tu cuota\)\./);
  assert.match(text, /Los posibles compradores aparecen primero, agrupados por empresa; nadie se descarta\./);
} finally { dom.window.close(); }

console.log('PASS: companies first explained on the card (how, how many, quota), results grouped by company with why each person is there, and «Traer más» sends or waits.');

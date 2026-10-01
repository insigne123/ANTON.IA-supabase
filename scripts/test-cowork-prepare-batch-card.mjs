// The «preparar contactos» card: each person with only the steps they still need (what is done reads as done), who was already
// ready, the cost of the people who stay, taking someone off before approving, and the result person by person once it ran
// (real name, email with its status, LinkedIn, research, and what was missing). Isolated DOM test, not visual certification.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const L = n => `00000000-0000-4000-8000-0000000000a${n}`;
const preview = {
  items: [
    { id: L(1), providerId: 'apollo:rafael', name: 'Rafael Du***n', company: 'R&D Montajes', title: 'Jefe de Operaciones', steps: ['save', 'enrich', 'research'], done: [] },
    { id: L(2), name: 'Susana Cáceres', company: 'MSTI', title: 'RR. HH.', steps: ['research'], done: ['save', 'enrich'] },
  ],
  ready: [{ id: L(3), name: 'Ana Pérez', company: 'Acme', reason: 'Ya está guardado, con su correo buscado y su investigación hecha o en curso.' }],
  excluded: [], matches: true, open: true, cost: { saves: 1, lookups: 1, research: 2 }, balance: { remaining: 120, stale: false },
  results: [
    { id: L(1), name: 'Rafael Durán', company: 'R&D Montajes', status: 'ready', email: 'rduran@rdmontajes.cl', emailStatus: 'verified',
      linkedinUrl: 'https://www.linkedin.com/in/rafael-duran', research: 'queued',
      steps: [{ step: 'save', status: 'done' }, { step: 'enrich', status: 'done' }, { step: 'research', status: 'done' }] },
    { id: L(2), name: 'Susana Cáceres', company: 'MSTI', status: 'partial', email: null,
      steps: [{ step: 'enrich', status: 'done', detail: 'El proveedor no encontró su correo.' }, { step: 'research', status: 'failed', detail: 'Se alcanzó el cupo diario de investigaciones; se renueva mañana.' }] },
    { id: L(3), name: 'Ana Pérez', company: 'Acme', status: 'removed', steps: [] },
  ],
};

async function render(component) {
  const bundle = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
    import {PrepareBatchReview, PrepareBatchResults} from './src/components/cowork/PrepareBatchReview';
    window.__approved = 0; window.__rejected = 0;
    createRoot(document.getElementById('root')).render(${component});`, resolveDir: process.cwd(), loader: 'tsx' },
  bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"test"' } });
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/cowork', runScripts: 'outside-only', pretendToBeVisual: true });
  const posts = [];
  dom.window.fetch = async (url, init) => {
    if (init?.method === 'POST') { posts.push({ url, body: JSON.parse(init.body) }); return { ok: true, json: async () => ({ excluded: JSON.parse(init.body).excluded }) }; }
    return { ok: true, json: async () => preview };
  };
  dom.window.eval(bundle.outputFiles[0].text);
  return { dom, posts };
}
const settle = async (dom, selector) => {
  for (let i = 0; i < 200 && !dom.window.document.querySelector(selector); i++) await new Promise(resolve => setTimeout(resolve, 10));
};

const card = await render('<PrepareBatchReview runId="run-1" resolving={false} onApprove={()=>{window.__approved++}} onReject={()=>{window.__rejected++}} />');
try {
  const { dom, posts } = card;
  const document = dom.window.document;
  await settle(dom, 'ul[aria-label="Personas del lote"] li');
  const rows = [...document.querySelectorAll('ul[aria-label="Personas del lote"] li')].map(li => li.textContent);
  assert.equal(rows.length, 2);
  assert.match(rows[0], /Rafael D\.apellido al buscar el correo/);
  assert.match(rows[0], /GuardarBuscar correoInvestigar/, 'a search result gets every step, in order');
  assert.match(rows[1], /Ya guardadoCorreo ya buscadoInvestigar/, 'what is done reads as done and only the research is left');
  assert.doesNotMatch(document.body.textContent, /\*\*\*/, 'the asterisks never reach the card');
  assert.match(document.body.textContent, /2 de 2 personas quedan listas con esta aprobación/);
  assert.match(document.body.textContent, /Usa hasta 1 crédito para buscar correos \(1 por persona\) y 2 investigaciones de tu cupo diario\. Te quedan 120 créditos\./);
  assert.match(document.body.textContent, /1 persona ya estaba lista/);
  const approve = () => [...document.querySelectorAll('button')].find(button => /^Preparar a/.test(button.textContent));
  assert.equal(approve().textContent, 'Preparar a 2 personas');

  // Taking Rafael off: his steps go grey, the cost drops and the approval names one person.
  const box = document.querySelector('input[aria-label="Quitar de la lista a Rafael D."]');
  assert.ok(box, 'each person has a labelled mark to take them off');
  box.click();
  await settle(dom, 'input[aria-label="Volver a incluir a Rafael D."]');
  assert.match(document.body.textContent, /1 de 2 personas quedan listas/);
  assert.match(document.body.textContent, /Usa 1 investigación de tu cupo diario\./);
  assert.equal(approve().textContent, 'Preparar a 1 persona');
  approve().click();
  for (let i = 0; i < 100 && !dom.window.__approved; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(posts, [{ url: '/api/cowork/runs/run-1/preparebatch', body: { excluded: [L(1)] } }], 'who was taken off is saved before approving');
  assert.equal(dom.window.__approved, 1);
} finally { card.dom.window.close(); }

const results = await render('<PrepareBatchResults runId="run-1" />');
try {
  const { dom } = results;
  await settle(dom, 'ul[aria-label="Resultado por persona"] li');
  const rows = [...dom.window.document.querySelectorAll('ul[aria-label="Resultado por persona"] li')].map(li => li.textContent);
  assert.equal(rows.length, 3);
  assert.match(rows[0], /Rafael Durán/, 'the real name arrives with the lookup');
  assert.match(rows[0], /rduran@rdmontajes\.cl · verificado/);
  assert.match(rows[0], /Perfil de LinkedIn/);
  assert.match(rows[0], /Investigación en curso/);
  assert.match(rows[1], /Sin correo/);
  assert.match(rows[1], /Se alcanzó el cupo diario de investigaciones/, 'what was missing says why');
  assert.match(rows[2], /La quitaste de la lista/);
  const link = dom.window.document.querySelector('a[href="https://www.linkedin.com/in/rafael-duran"]');
  assert.equal(link?.getAttribute('rel'), 'noreferrer');
  console.log('PASS: prepare batch card shows each person with only the missing steps, ready people, cost and balance, removal before approval, and per-person results with real name, email, LinkedIn and research. DOM only, not visual certification.');
} finally { results.dom.window.close(); }

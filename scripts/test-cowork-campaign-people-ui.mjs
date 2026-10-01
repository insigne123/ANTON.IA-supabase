// The campaign card of Cowork, person by person (Plan 5, PR-6): each recipient with the first email they will
// receive, edited by hand or with the AI for that person only, approval held while an edit is open, and «pausada»
// said in plain words. Isolated DOM test with a fake server, not visual certification.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const RUN = '00000000-0000-4000-8000-0000000000c1';
const HASH = 'a'.repeat(64);
const camila = { email: 'cfuentes@adecco.cl', name: 'Camila Fuentes', company: 'Adecco', title: 'Gerenta de Personas', available: true, personal: true,
  first: { subject: 'Camila, 40 vacantes en Adecco', body: 'Hola Camila,\nvi que Adecco abrió 40 vacantes.\nNicolás' }, problem: null };
const rafael = { email: 'rgodoy@sodexo.cl', name: 'Rafael D.', company: 'Sodexo', title: 'Jefe de RR. HH.', available: true, personal: false,
  first: { subject: 'AXIS para Sodexo', body: 'Hola Rafael,\nTe escribo por AXIS.\nNicolás' }, problem: null };
const susana = { email: 'susana@msti.cl', name: '', company: '', title: '', available: false, personal: false, first: null,
  problem: 'Ya no está en tus contactos con este correo, o dejó de calzar con la audiencia.' };
const preview = (people, edits = 0) => ({ kind: 'campaign_create', label: 'Crear campaña', name: 'AXIS · RR. HH.', objective: 'Primera conversación sobre AXIS',
  provider: 'google', relationship: 'never_contacted', definitionHash: HASH, edits, matched: 2, emails: people.map(person => person.email), people,
  messages: [{ subject: 'AXIS para {{empresa}}', body: 'Hola {{nombre}},\nTe escribo por AXIS.\nNicolás', delayDays: 0 },
    { subject: '¿Lo vemos?', body: 'Hola {{nombre}},\n¿Te sirve el jueves?\nNicolás', delayDays: 2 }] });

const bundle = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
  import {CampaignReview} from './src/components/cowork/CampaignReview';
  createRoot(document.getElementById('root')).render(<CampaignReview runId="${RUN}" resolving={false}
    onApprove={()=>{window.__approved=true}} onReject={()=>{window.__rejected=true}} />);`,
resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"test"' } });
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/cowork', runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;
const requests = [];
let current = preview([camila, rafael, susana]);
window.fetch = async (url, init = {}) => {
  const body = init.body ? JSON.parse(init.body) : null;
  requests.push({ url, method: init.method || 'GET', body });
  if (url === '/api/campaigns/bulk/assist') {
    return { ok: true, status: 200, json: async () => ({ proposal: { subject: 'Camila, una pregunta corta', body: 'Hola Camila,\n¿Cómo revisan hoy los antecedentes?\nNicolás', delayDays: 0 } }) };
  }
  if (init.method === 'PATCH') {
    current = preview([{ ...camila, first: { subject: body.person.subject, body: body.person.body } }, rafael, susana], 1);
    return { ok: true, status: 200, json: async () => ({ changed: [0] }) };
  }
  return { ok: true, status: 200, json: async () => current };
};
window.eval(bundle.outputFiles[0].text);
const settle = async (ms = 300) => { for (let i = 0; i < ms / 10; i++) await new Promise(resolve => setTimeout(resolve, 10)); };
const button = label => [...window.document.querySelectorAll('button')].find(node => node.textContent.trim() === label);
const type = (input, value) => {
  Object.getOwnPropertyDescriptor(window[input.tagName === 'TEXTAREA' ? 'HTMLTextAreaElement' : 'HTMLInputElement'].prototype, 'value').set.call(input, value);
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
};
try {
  await settle();
  const document = window.document;
  const text = () => document.body.textContent;
  // Who it goes to, and each person's first email as they will receive it.
  assert.match(text(), /Para3 personas · 1 necesita revisión/);
  assert.match(text(), /CanalGmail/);
  const rows = [...document.querySelectorAll('section[aria-labelledby] li summary')].map(node => node.textContent);
  assert.deepEqual(rows, ['Camila FuentesGerenta de Personas · AdeccoEscrito para esta persona', 'Rafael D.Jefe de RR. HH. · SodexoPlantilla con su nombre', 'susana@msti.clsusana@msti.clRevisar']);
  assert.match(text(), /1 de 3 escritos para la persona/);
  assert.equal(document.querySelector('section[aria-labelledby] li details').open, true, 'the first person is open');
  assert.match(text(), /vi que Adecco abrió 40 vacantes/);
  assert.match(text(), /Hola Rafael,/, 'each person reads with their first name, never the variable');
  assert.match(text(), /dejó de calzar con la audiencia/);
  // The sequence for everyone says what its variables do, and «pausada» is said in plain words.
  assert.match(text(), /Secuencia para todos · 2 correos/);
  assert.match(text(), /\{\{nombre\}\}, \{\{empresa\}\} y \{\{cargo\}\} se completan con los datos de cada persona\. El correo 1 de la secuencia va solo a quienes no tienen uno propio\./);
  assert.match(text(), /Al aprobar, la campaña queda guardada sin enviar en Gmail: nada sale hasta que la actives, y activarla pide otra aprobación\./);
  assert.equal(button('Crear campaña sin enviar').disabled, false);

  // Editing Camila's email holds the approval and the other edits.
  button('Editar su correo').click();
  await settle(50);
  assert.equal(button('Crear campaña sin enviar').disabled, true);
  assert.equal(button('Editar secuencia').disabled, true);
  assert.match(text(), /Guarda o cancela tus cambios antes de aprobar/);
  const subject = document.getElementById(`cw-person-${RUN}-0-subject-0`);
  assert.equal(subject.value, 'Camila, 40 vacantes en Adecco');
  // A change asked to the AI for her only: proposed first, applied only when she uses it.
  const ask = document.getElementById(`cw-person-${RUN}-0-ask`);
  assert.equal(document.querySelector(`label[for="cw-person-${RUN}-0-ask"]`).textContent, 'Pedir un cambio a la IA, solo para esta persona');
  assert.equal(button('Proponer cambio').disabled, true, 'an instruction of a few letters is not enough');
  type(ask, 'Hazlo más corto, con una pregunta');
  await settle(30);
  button('Proponer cambio').click();
  await settle(80);
  const assist = requests.find(request => request.url === '/api/campaigns/bulk/assist');
  assert.deepEqual({ ...assist.body, current: null }, { mode: 'message', instruction: 'Hazlo más corto, con una pregunta', objective: 'Primera conversación sobre AXIS',
    relationship: 'never_contacted', current: null, messageIndex: 0, audience: 'Camila Fuentes · Gerenta de Personas · Adecco' });
  assert.deepEqual(assist.body.current, { ...camila.first, delayDays: 0 });
  assert.match(text(), /Propuesta de la IA/);
  assert.equal(subject.value, 'Camila, 40 vacantes en Adecco', 'nothing changes until the proposal is used');
  button('Usar la propuesta').click();
  await settle(30);
  assert.equal(document.getElementById(`cw-person-${RUN}-0-subject-0`).value, 'Camila, una pregunta corta');
  // Saving sends only her email, over the version on screen; the card reloads and lets approve again.
  button('Guardar su correo').click();
  await settle(150);
  const patch = requests.find(request => request.method === 'PATCH');
  assert.deepEqual(patch.body, { expectedHash: HASH, person: { email: 'cfuentes@adecco.cl', subject: 'Camila, una pregunta corta', body: 'Hola Camila,\n¿Cómo revisan hoy los antecedentes?\nNicolás' } });
  assert.match(text(), /Guardaste el correo de Camila Fuentes: la campaña se crea con esta versión\./);
  assert.match(text(), /¿Cómo revisan hoy los antecedentes\?/);
  assert.equal(button('Crear campaña sin enviar').disabled, false);
  // An empty email cannot be saved.
  button('Editar su correo').click();
  await settle(50);
  type(document.getElementById(`cw-person-${RUN}-0-body-0`), '   ');
  await settle(30);
  assert.equal(button('Guardar su correo').disabled, true);
  assert.match(text(), /El correo necesita asunto y cuerpo/);
  button('Cancelar').click();
  await settle(30);
  assert.equal(button('Crear campaña sin enviar').disabled, false);
  console.log('PASS: campaign card with each person and their first email, edits by hand or with the AI for one person, approval held meanwhile, and «pausada» in plain words.');
} finally { window.close(); }

// A greeting without the person's name is pointed out (the text is never rewritten for them).
const second = new JSDOM('<div id="root"></div>', { url: 'http://localhost/cowork', runScripts: 'outside-only', pretendToBeVisual: true });
try {
  const bare = { ...rafael, first: { subject: 'AXIS para Sodexo', body: 'Hola,\nTe escribo por AXIS.\nNicolás' }, greetsByName: false };
  second.window.fetch = async () => ({ ok: true, status: 200, json: async () => preview([bare]) });
  second.window.eval(bundle.outputFiles[0].text);
  await new Promise(resolve => setTimeout(resolve, 300));
  const text = second.window.document.body.textContent;
  assert.match(text, /Rafael D\.Jefe de RR\. HH\. · SodexoSaludo sin su nombre/);
  assert.match(text, /El saludo no lleva su nombre\. Edita la secuencia y abre con «Hola \{\{nombre\}\},»/);
  console.log('PASS: a greeting without the person\'s name is pointed out on their row.');
} finally { second.window.close(); }

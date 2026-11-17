// The campaign card of Cowork writes an email for each person when it opens (17 Nov 2026, docs/campanas-un-correo-por-persona.md):
// the campaign Cowork proposed is the guide, whoever has a first email of their own keeps it, the approval waits for the writing, and
// afterwards each person shows their own emails and the sequence stays as the base. Isolated DOM test with a fake server.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const RUN = '00000000-0000-4000-8000-0000000000c2';
const HASH = 'b'.repeat(64);
const NEXT = 'c'.repeat(64);
const messages = [{ subject: 'Turnos para {{empresa}}', body: 'Hola {{nombre}},\nCubrimos turnos de aseo.\n¿Conversamos?', delayDays: 0 },
  { subject: '¿Lo vemos?', body: 'Hola {{nombre}},\n¿Te sirve el jueves?', delayDays: 3 }];
const camila = { email: 'camila@aseonorte.example', name: 'Camila Fuentes', company: 'Aseo Norte', title: 'Gerenta de Personas', available: true, personal: true, written: false, rest: [],
  first: { subject: 'Camila, la sede nueva', body: 'Hola Camila,\nvi que abrieron una sede en Iquique.' }, problem: null };
const rafael = { email: 'rafael@clinicasur.example', name: 'Rafael D.', company: 'Clínica Sur', title: 'Jefe de Servicios', available: true, personal: false, written: false, rest: [],
  first: { subject: 'Turnos para Clínica Sur', body: 'Hola Rafael,\nCubrimos turnos de aseo.\n¿Conversamos?' }, problem: null };
const paula = { email: 'paula@colegioandes.example', name: 'Paula Reyes', company: 'Colegio Andes', title: 'Administradora', available: true, personal: false, written: false, rest: [],
  first: { subject: 'Turnos para Colegio Andes', body: 'Hola Paula,\nCubrimos turnos de aseo.\n¿Conversamos?' }, problem: null };
const preview = (people, extra = {}) => ({ kind: 'campaign_create', label: 'Crear campaña', name: 'Aseo · turnos', objective: 'Una llamada de 15 minutos', description: 'Encargados de servicios',
  provider: 'google', relationship: 'never_contacted', definitionHash: HASH, edits: 0, matched: people.length, emails: people.map(person => person.email), people, messages,
  personalize: true, onGuide: people.filter(person => !person.written).map(person => person.email), ...extra });
const own = (name, company) => [{ subject: `Aseo en ${company}`, body: `Hola ${name},\nte escribo porque llevas los servicios de ${company}.` },
  { subject: `Un resumen para ${company}`, body: `Hola ${name},\n¿te mando un resumen de una página?` }];

const bundle = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
  import {CampaignReview} from './src/components/cowork/CampaignReview';
  createRoot(document.getElementById('root')).render(<CampaignReview runId="${RUN}" resolving={false}
    onApprove={()=>{window.__approved=true}} onReject={()=>{window.__rejected=true}} />);`,
resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"test"' } });
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/cowork', runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;
window.AbortSignal.timeout ??= () => new window.AbortController().signal;
const requests = [];
let current = preview([camila, rafael, paula]);
let release;
const held = new Promise(resolve => { release = resolve; });
window.fetch = async (url, init = {}) => {
  const body = init.body ? JSON.parse(init.body) : null;
  requests.push({ url, method: init.method || 'GET', body });
  if (url === '/api/campaigns/bulk/personalize') {
    await held;
    const names = { [camila.email]: ['Camila', 'Aseo Norte'], [rafael.email]: ['Rafael', 'Clínica Sur'], [paula.email]: ['Paula', 'Colegio Andes'] };
    // Paula's cannot be written: she keeps the common emails.
    return { ok: true, status: 200, json: async () => ({ written: body.emails.filter(email => email !== paula.email).map(email => ({ email, messages: own(...names[email]) })),
      failed: body.emails.filter(email => email === paula.email).map(email => ({ email, reason: 'La IA tardó más de lo esperado.' })) }) };
  }
  if (init.method === 'PATCH') {
    const wrote = new Map(body.personal.map(person => [person.email, person.messages]));
    current = preview([camila, rafael, paula].map(person => (wrote.has(person.email) ? { ...person, personal: true, written: true,
      // Camila keeps the first email she had: the server leaves it.
      first: person.email === camila.email ? camila.first : wrote.get(person.email)[0],
      rest: [{ ...wrote.get(person.email)[1], delayDays: 3 }] } : person)), { definitionHash: NEXT });
    return { ok: true, status: 200, json: async () => ({ changed: [0, 1] }) };
  }
  return { ok: true, status: 200, json: async () => current };
};
window.eval(bundle.outputFiles[0].text);
const settle = async (ms = 300) => { for (let i = 0; i < ms / 10; i++) await new Promise(resolve => setTimeout(resolve, 10)); };
const button = label => [...window.document.querySelectorAll('button')].find(node => node.textContent.trim() === label);
try {
  await settle();
  const document = window.document;
  const text = () => document.body.textContent;
  // It starts on its own and the approval waits.
  assert.match(text(), /Escribiendo un correo para cada persona… 0 de 3/);
  assert.match(text(), /Tarda menos de un minuto/);
  assert.equal(button('Crear campaña sin enviar').disabled, true);
  assert.match(text(), /Se están escribiendo los correos de cada persona: espera a que terminen o detén la escritura para aprobar\./);
  assert.ok(button('Detener'));
  assert.equal(button('Editar secuencia').disabled, true);
  release();
  await settle(600);
  const asked = requests.filter(request => request.url === '/api/campaigns/bulk/personalize');
  // The two with the common emails go together; Camila, who has a first email of her own, goes alone and it is her guide.
  const together = asked.find(request => request.body.emails.length === 2);
  assert.deepEqual(together.body.emails, [rafael.email, paula.email]);
  assert.deepEqual([together.body.objective, together.body.description, together.body.relationship, together.body.messages[0].subject], ['Una llamada de 15 minutos', 'Encargados de servicios', 'never_contacted', 'Turnos para {{empresa}}']);
  const alone = asked.find(request => request.body.emails.length === 1 && request.body.emails[0] === camila.email);
  assert.deepEqual([alone.body.messages[0].subject, alone.body.messages[1].subject], ['Camila, la sede nueva', '¿Lo vemos?']);
  // Whoever failed is tried once more, alone.
  assert.ok(asked.filter(request => request.body.emails.includes(paula.email)).length === 2);
  // What was written is kept in the proposal, over the version on screen.
  const patch = requests.find(request => request.method === 'PATCH');
  assert.equal(patch.body.expectedHash, HASH);
  assert.deepEqual(patch.body.personal.map(person => [person.email, person.messages.length]).sort(), [[camila.email, 2], [rafael.email, 2]]);
  // The card shows each person's emails and says who is left.
  assert.match(text(), /Escribimos los correos de 2 personas, a partir de su cargo y de su empresa\. Revísalos antes de aprobar\./);
  assert.match(text(), /1 persona tiene todavía los correos comunes\./);
  assert.ok(button('Escribir sus correos'));
  assert.match(text(), /Su seguimiento, escritos para esta persona/);
  assert.match(text(), /¿te mando un resumen de una página\?/);
  assert.match(text(), /vi que abrieron una sede en Iquique/, 'her own first email stays');
  const rows = [...document.querySelectorAll('section[aria-labelledby] > ul > li > details > summary')].map(node => node.textContent);
  assert.deepEqual(rows.map(row => /Escrito para esta persona$/.test(row)), [true, true, false]);
  assert.equal(button('Crear campaña sin enviar').disabled, false);
  assert.doesNotMatch(text(), /editada por ti/);
  // Not everyone has their own yet: the sequence still goes to Paula.
  assert.match(text(), /Seguimientos para todos|Secuencia para todos/);

  // Writing Paula's too: now the sequence is the base, read only.
  window.fetch = (previous => async (url, init = {}) => {
    if (url === '/api/campaigns/bulk/personalize') {
      const body = JSON.parse(init.body);
      requests.push({ url, method: 'POST', body });
      return { ok: true, status: 200, json: async () => ({ written: body.emails.map(email => ({ email, messages: own('Paula', 'Colegio Andes') })), failed: [] }) };
    }
    if (init.method === 'PATCH') {
      requests.push({ url, method: 'PATCH', body: JSON.parse(init.body) });
      current = preview(current.people.map(person => (person.email === paula.email ? { ...person, personal: true, written: true, first: own('Paula', 'Colegio Andes')[0], rest: [{ ...own('Paula', 'Colegio Andes')[1], delayDays: 3 }] } : person)));
      return { ok: true, status: 200, json: async () => ({ changed: [0, 1] }) };
    }
    return previous(url, init);
  })(window.fetch);
  button('Escribir sus correos').click();
  await settle(600);
  const last = requests.filter(request => request.method === 'PATCH').at(-1);
  assert.deepEqual([last.body.expectedHash, last.body.personal.map(person => person.email)], [NEXT, [paula.email]]);
  assert.match(text(), /Base de la campaña · 2 correos/);
  assert.match(text(), /Cada persona tiene sus propios correos, escritos a partir de esta base\. La base no se envía a nadie; para cambiar el correo de alguien, edítalo en su tarjeta\./);
  assert.equal(button('Editar secuencia'), undefined);
  assert.equal(button('Editar seguimientos'), undefined);
  assert.doesNotMatch(text(), /todavía los correos comunes/);
  assert.equal(button('Crear campaña sin enviar').disabled, false);
  console.log('PASS: the campaign card writes an email for each person when it opens, keeps a first email of their own, holds the approval meanwhile and leaves the sequence as the base.');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally { window.close(); }

// Activating a campaign whose people still have the common text says so, with the way to write them first.
const second = new JSDOM('<div id="root"></div>', { url: 'http://localhost/cowork', runScripts: 'outside-only', pretendToBeVisual: true });
try {
  const campaignId = '00000000-0000-4000-8000-0000000000d1';
  second.window.fetch = async () => ({ ok: true, status: 200, json: async () => ({ kind: 'campaign_activate', label: 'Aprobar y activar', name: 'Aseo · turnos', status: 'draft',
    revision: 1, recipients: 3, emails: [camila.email, rafael.email, paula.email], matches: true, campaignId, onGuideCount: 3 }) });
  second.window.eval(bundle.outputFiles[0].text);
  await new Promise(resolve => setTimeout(resolve, 300));
  const document = second.window.document;
  assert.match(document.body.textContent, /3 personas recibirían el mismo texto que las demás\. Para que cada una reciba un correo escrito para ella, abre la campaña y elige «Escribir un correo para cada persona» antes de activarla\./);
  assert.equal(document.querySelector('a[href^="/campaigns?campaign="]').getAttribute('href'), `/campaigns?campaign=${campaignId}`);
  assert.equal([...document.querySelectorAll('button')].find(node => node.textContent.trim() === 'Aprobar y activar').disabled, false, 'it warns and does not block');
  console.log('PASS: activating a campaign with the common text for everyone says so and links to where each person gets their own.');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally { second.window.close(); }

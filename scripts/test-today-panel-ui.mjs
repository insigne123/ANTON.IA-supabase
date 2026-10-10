// «Hoy», rendered with a fake API: a skeleton while loading, the one primary step as the main button, the queue as links to
// the exact conversation, the setup progress, and a retry when the API fails. Isolated DOM test, not visual certification.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const bundle = await build({
  stdin: {
    contents: `import React from 'react'; import { createRoot } from 'react-dom/client'; import { TodayPanel } from './src/components/home/TodayPanel';
      window.__mount = () => { const root = createRoot(document.getElementById('root')); root.render(<TodayPanel />); return () => root.unmount(); };`,
    resolveDir: process.cwd(), loader: 'tsx',
  },
  bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"test"' },
  plugins:[{name:'home-auth',setup(builder){
    builder.onResolve({filter:/@\/context\/AuthContext|@\/lib\/authenticated-api-fetch/},args=>({path:args.path,namespace:'fixture'}));
    builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path.includes('AuthContext')?`export const useAuth=()=>({user:{id:'me'},organizationId:'org',loading:false});`:`export const authenticatedApiFetch=(url,init)=>fetch(url,init);`}));
  }}],
});

const PLAN = {
  scope:{userId:'me',organizationId:'org',dayKey:new Intl.DateTimeFormat('en-CA',{timeZone:'America/Santiago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())},
  firstName: 'Gabriela',
  setupDone: 2,
  setup: [
    { id: 'profile', title: 'Cuéntanos qué vendes', description: 'd', href: '/profile', cta: 'Completar perfil', done: true },
    { id: 'mail', title: 'Conecta tu correo', description: 'd', href: '/connections', cta: 'Conectar correo', done: true },
    { id: 'contacts', title: 'Guarda tus primeros contactos', description: 'd', href: '/search', cta: 'Buscar prospectos', done: false },
    { id: 'first_send', title: 'Envía tu primer correo', description: 'd', href: '/search', cta: 'Escribir', done: false },
  ],
  primary: { title: 'Luis Rojas pidió una reunión', description: 'Propón horarios hoy.', href: '/contacted?c=c2', cta: 'Abrir conversación' },
  queue: [
    { id: 'reply:c2', kind: 'reply', urgent: true, href: '/contacted?c=c2', title: 'Luis Rojas pidió una reunión', description: 'x' },
    { id: 'ready', kind: 'ready', urgent: false, href: '/saved/leads/enriched', title: '94 contactos con correo esperan tu primer mensaje', description: 'y' },
  ],
};

async function mount(respond) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/dashboard', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  let calls = 0;
  window.process = { env: { NODE_ENV: 'test' } };
  window.fetch = async (url) => { calls += 1; return respond(url, calls); };
  window.eval(bundle.outputFiles[0].text);
  const unmount = window.__mount();
  const waitFor = async (predicate, label) => {
    for (let i = 0; i < 300; i++) { if (predicate()) return; await new Promise((resolve) => setTimeout(resolve, 10)); }
    throw new Error(`Timed out waiting for ${label}`);
  };
  return { window, doc: window.document, waitFor, calls: () => calls, close: () => { unmount(); window.close(); } };
}

try {
  let gate;
  const page = await mount(() => new Promise((resolve) => { gate = () => resolve({ ok: true, status: 200, json: async () => PLAN }); }));
  await page.waitFor(() => page.doc.querySelector('[aria-label="Hoy"][aria-busy="true"]'), 'the skeleton');
  await page.waitFor(() => typeof gate === 'function', 'the request');
  gate();
  await page.waitFor(() => page.doc.body.textContent.includes('Luis Rojas pidió una reunión'), 'the plan');
  assert.match(page.doc.body.textContent, /Hola, Gabriela\. Lo primero hoy/);
  const primary = [...page.doc.querySelectorAll('a')].find((link) => link.textContent.includes('Abrir conversación'));
  assert.equal(primary.getAttribute('href'), '/contacted?c=c2');
  const queueLinks = [...page.doc.querySelectorAll('ul a')].map((link) => link.getAttribute('href'));
  assert.deepEqual(queueLinks, ['/contacted?c=c2', '/saved/leads/enriched']);
  assert.match(page.doc.body.textContent, /2 de 4 pasos/);
  assert.equal(page.doc.querySelector('[role="progressbar"]')?.getAttribute('aria-label'), '2 de 4 pasos completos');
  // Done steps show no button; pending ones link to where they get done.
  assert.equal([...page.doc.querySelectorAll('ol a')].map((link) => link.getAttribute('href')).join(','), '/search,/search');
  page.close();

  const failing = await mount((_url, call) => call === 1
    ? { ok: false, status: 500, json: async () => ({}) }
    : { ok: true, status: 200, json: async () => ({ ...PLAN, queue: [], primary: { ...PLAN.primary, title: 'Encuentra tus primeros prospectos', href: '/search', cta: 'Buscar prospectos' } }) });
  await failing.waitFor(() => failing.doc.querySelector('[role="alert"]'), 'the error');
  assert.match(failing.doc.body.textContent, /No pudimos cargar lo que toca hoy/);
  [...failing.doc.querySelectorAll('button')].find((button) => button.textContent.includes('Reintentar')).click();
  await failing.waitFor(() => failing.doc.body.textContent.includes('Nada pendiente por ahora'), 'the empty queue after retry');
  assert.equal(failing.calls(), 2);
  failing.close();

  console.log('PASS: «Hoy» loading, primary step, queue deep links, setup progress, empty queue and retry. DOM only, not visual certification.');
} catch (error) {
  console.error(error);
  throw error;
}

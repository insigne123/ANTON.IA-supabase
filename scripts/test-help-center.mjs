// «Centro de ayuda» (/ayuda), rendered: the manual with its index, the search without accents, «Pregúntale a la IA» with the
// sections it comes from, the manual's answer when the AI is not available, the rate-limit message, the replay of the tour,
// and the sections only owners and admins see. Isolated: esbuild bundles the real page with the auth context, the tour and
// next/navigation stubbed; DOM via jsdom; fetch is stubbed. Not visual certification.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const sources = {
  '@/context/AuthContext': 'export const useAuth = () => ({ organizationRole: window.__role });',
  '@/components/onboarding/ProductTour': 'export const useProductTour = () => ({ start: () => { window.__started += 1; }, guide: null, startGuide() {}, active: false });',
  'next/navigation': 'export const usePathname = () => "/ayuda"; export const useRouter = () => ({ push() {}, replace() {} });',
};
const externals = new RegExp(`^(${Object.keys(sources).map((key) => key.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('|')})$`);
const bundle = await build({
  stdin: {
    contents: `import React from 'react'; import { createRoot } from 'react-dom/client';
      import HelpCenterPage from './src/app/(app)/ayuda/page';
      window.mount = () => { const root = createRoot(document.getElementById('root')); root.render(<HelpCenterPage />); return () => root.unmount(); };`,
    resolveDir: process.cwd(), loader: 'tsx',
  },
  bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"test"' },
  plugins: [{ name: 'stubs', setup(b) {
    b.onResolve({ filter: externals }, (args) => ({ path: args.path, namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({ contents: sources[args.path], loader: 'js' }));
  } }],
});

async function open({ role = 'member', respond = () => ({ status: 500, body: {} }) } = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/ayuda', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  window.process = { env: { NODE_ENV: 'test' } };
  window.__role = role;
  window.__started = 0;
  window.matchMedia = (media) => ({ matches: false, media, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.HTMLElement.prototype.scrollIntoView = function () {};
  const calls = [];
  window.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), body: options.body ? JSON.parse(options.body) : null });
    const { status = 200, body } = respond(calls.length);
    return { ok: status < 400, status, json: async () => body };
  };
  window.eval(bundle.outputFiles[0].text);
  const unmount = window.mount();
  const doc = window.document;
  const text = () => doc.body.textContent;
  const button = (label) => [...doc.querySelectorAll('button')].find((node) => node.textContent.trim().startsWith(label));
  const type = (element, value) => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value').set.call(element, value);
    element.dispatchEvent(new window.Event('input', { bubbles: true }));
  };
  const waitFor = async (predicate, label) => {
    for (let i = 0; i < 400; i++) { if (predicate()) return; await new Promise((resolve) => setTimeout(resolve, 10)); }
    throw new Error(`Timed out: ${label}`);
  };
  const ask = async (question) => {
    type(doc.querySelector('textarea'), question);
    await waitFor(() => !button('Preguntar')?.disabled, 'the question is typed');
    button('Preguntar').click();
  };
  return { window, doc, text, button, type, waitFor, ask, calls, close: () => { unmount(); window.close(); } };
}

// 1. A member: the whole manual, the index, the search, the tour, and nothing about features they cannot use.
{
  const app = await open();
  try {
    await app.waitFor(() => app.text().includes('Centro de ayuda'), 'the page');
    const index = app.doc.querySelector('nav[aria-label="Índice del manual"]');
    for (const group of ['Empieza aquí', 'Prospectar', 'Contactos', 'Seguimiento', 'Configuración']) assert.match(index.textContent, new RegExp(group));
    assert.equal(index.querySelector('a[href="#perfil"]')?.textContent, 'Perfil');
    assert.ok(app.doc.getElementById('por-escribir'), 'each section is an anchor');
    assert.equal(app.doc.querySelector('#perfil a[href="/profile"]')?.textContent.trim(), 'Ir a Perfil');
    assert.equal(app.doc.getElementById('administracion'), null, 'members do not see the admin panel help');
    assert.equal(app.doc.getElementById('oportunidades'), null, 'a feature that is off is not described');
    assert.doesNotMatch(index.textContent, /Administración/);

    const search = app.doc.getElementById('help-search');
    app.type(search, 'creditos');
    await app.waitFor(() => app.doc.querySelector('[aria-label="Resultados de la búsqueda"]'), 'results');
    const results = app.doc.querySelector('[aria-label="Resultados de la búsqueda"]');
    assert.match(results.textContent, /Me quedé sin créditos\. ¿Qué hago\?/, 'found without the accent');
    assert.equal(results.querySelector('a').getAttribute('href'), '/ayuda#creditos');
    app.type(search, 'xylofón');
    await app.waitFor(() => app.text().includes('No encontramos «xylofón»'), 'nothing found says what to do');

    app.button('Ver recorrido por la app').click();
    assert.equal(app.window.__started, 1, 'the tour starts from here');
    assert.equal(app.calls.length, 0, 'nothing is asked before a question');
  } finally { app.close(); }
}

// 2. «Pregúntale a la IA»: the answer with the sections it comes from; then the manual when the AI is down; then the limit.
{
  const replies = [
    { body: { source: 'ai', answer: 'Pídele más a un administrador de tu organización.', answered: true,
      sections: [{ id: 'creditos', title: 'Créditos y uso diario', href: '/ayuda#creditos', screen: null }] } },
    { body: { source: 'manual', answer: null, answered: true,
      matches: [{ section: { id: 'correo', title: 'Preparar y enviar un correo', href: '/ayuda#correo', screen: null }, q: '¿Desde qué correo sale?', a: 'Desde tu cuenta conectada de Gmail u Outlook.' }] } },
    { status: 429, body: { error: 'Hiciste varias preguntas seguidas. Espera unos minutos y vuelve a intentarlo.' } },
  ];
  const app = await open({ respond: (n) => replies[n - 1] });
  try {
    await app.waitFor(() => app.doc.querySelector('textarea'), 'the box');
    assert.equal(app.button('Preguntar').disabled, true, 'nothing to ask yet');
    await app.ask('¿Qué hago si me quedo sin créditos?');
    await app.waitFor(() => app.text().includes('Pídele más a un administrador'), 'the answer');
    assert.deepEqual(JSON.parse(JSON.stringify(app.calls[0])), { url: '/api/help/ask', body: { question: '¿Qué hago si me quedo sin créditos?', sectionId: null } });
    assert.match(app.text(), /Tu pregunta: ¿Qué hago si me quedo sin créditos\?/);
    const more = [...app.doc.querySelectorAll('a')].find((node) => node.textContent === 'Créditos y uso diario' && node.getAttribute('href') === '/ayuda#creditos');
    assert.ok(more, '«Leer más» links to the section');
    assert.equal(app.doc.querySelector('textarea').value, '', 'ready for the next question');

    await app.ask('¿Desde qué correo sale?');
    await app.waitFor(() => app.text().includes('La IA no está disponible ahora'), 'the manual answers instead');
    assert.match(app.text(), /Desde tu cuenta conectada de Gmail u Outlook\./);

    await app.ask('Otra pregunta más');
    await app.waitFor(() => app.text().includes('Hiciste varias preguntas seguidas'), 'the limit says what to do');
    assert.equal(app.doc.querySelector('textarea').value, 'Otra pregunta más', 'the question is kept to try again');
  } finally { app.close(); }
}

// 3. Owners and admins also see the admin panel help.
{
  const app = await open({ role: 'admin' });
  try {
    await app.waitFor(() => app.doc.getElementById('administracion'), 'the admin section');
    assert.match(app.doc.getElementById('administracion').textContent, /Usuarios/);
  } finally { app.close(); }
}

console.log('PASS: the Centro de ayuda shows the manual by role, searches without accents, answers with the AI or the manual, and starts the tour. DOM only, not visual certification.');

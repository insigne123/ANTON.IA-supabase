// «Centro de ayuda» (/ayuda), rendered: «Tu camino al primer correo», the popular questions, every topic as a card that
// opens its own page, the search without accents, «Pregúntale a la IA» with the sections it comes from, the manual's answer
// when the AI is not available, the rate-limit message, the replay of the tour, the topics only owners and admins see and
// the old links to a section of this page (/ayuda#perfil). Isolated: esbuild bundles the real page with the auth context,
// the tour and next/navigation stubbed; DOM via jsdom; fetch is stubbed. Not visual certification.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const sources = {
  '@/context/AuthContext': 'export const useAuth = () => ({ organizationRole: window.__role });',
  '@/components/onboarding/ProductTour': 'export const useProductTour = () => ({ start: () => { window.__started += 1; }, guide: null, startGuide() {}, active: false });',
  'next/navigation': 'export const usePathname = () => "/ayuda"; export const useRouter = () => ({ push() {}, replace(href) { window.__replaced.push(href); } });',
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

async function open({ role = 'member', hash = '', respond = () => ({ status: 500, body: {} }) } = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: `http://localhost/ayuda${hash}`, runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  window.process = { env: { NODE_ENV: 'test' } };
  window.__role = role;
  window.__started = 0;
  window.__replaced = [];
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
  // «Pregúntale a la IA» on the side: the popular questions on the page share some of its answers.
  const asked = () => doc.querySelector('aside')?.textContent || '';
  return { window, doc, text, asked, button, type, waitFor, ask, calls, close: () => { unmount(); window.close(); } };
}

// 1. A member: the path to the first email, the popular questions, every topic as a card, the search and the tour.
{
  const app = await open();
  try {
    await app.waitFor(() => app.text().includes('Centro de ayuda'), 'the page');
    const path = app.doc.querySelector('section[aria-labelledby="help-path-title"]');
    assert.match(path.textContent, /Tu camino al primer correo/);
    const steps = [...path.querySelectorAll('ol > li a')];
    assert.deepEqual(steps.map((link) => link.getAttribute('href')),
      ['/ayuda/perfil', '/ayuda/conexiones', '/ayuda/buscar', '/ayuda/por-completar', '/ayuda/por-escribir', '/ayuda/conversaciones']);
    assert.match(steps[0].textContent, /^1Cuenta qué vendes/, 'numbered, in the order of the work');
    assert.match(steps[5].textContent, /^6Responde y cierra/);

    const popular = app.doc.querySelector('section[aria-labelledby="help-popular-title"]');
    const questions = [...popular.querySelectorAll('details')];
    assert.equal(questions.length, 5);
    assert.equal(questions[0].querySelector('summary').textContent, 'Me quedé sin créditos. ¿Qué hago?');
    assert.match(questions[0].textContent, /administrador/, 'the answer is right there');
    assert.equal(questions[0].querySelector('a').getAttribute('href'), '/ayuda/creditos');
    assert.match(questions[0].querySelector('a').textContent, /^Más en /);

    const index = app.doc.querySelector('nav[aria-label="Índice del manual"]');
    for (const group of ['Empieza aquí', 'Prospectar', 'Contactos', 'Seguimiento', 'Configuración']) assert.match(index.textContent, new RegExp(group));
    const profile = index.querySelector('a[href="/ayuda/perfil"]');
    assert.match(profile.textContent, /^Perfil/, 'each topic is a card that opens its page');
    assert.ok(profile.querySelector('svg'), 'with its icon');
    assert.equal(index.querySelector('a[href="/ayuda/administracion"]'), null, 'members do not see the admin panel help');
    assert.equal(index.querySelector('a[href="/ayuda/oportunidades"]'), null, 'a feature that is off is not described');
    assert.doesNotMatch(index.textContent, /Administración/);
    assert.deepEqual(app.window.__replaced, [], 'no old link to follow');

    const search = app.doc.getElementById('help-search');
    app.type(search, 'creditos');
    await app.waitFor(() => app.doc.querySelector('[aria-label="Resultados de la búsqueda"]'), 'results');
    const results = app.doc.querySelector('[aria-label="Resultados de la búsqueda"]');
    assert.match(results.textContent, /Me quedé sin créditos\. ¿Qué hago\?/, 'found without the accent');
    assert.equal(results.querySelector('a').getAttribute('href'), '/ayuda/creditos');
    app.type(search, 'xylofón');
    await app.waitFor(() => app.text().includes('No encontramos «xylofón»'), 'nothing found says what to do');
    app.doc.querySelector('button[aria-label="Borrar búsqueda"]').click();
    await app.waitFor(() => !app.doc.querySelector('[aria-label="Resultados de la búsqueda"]'), 'the search is cleared');
    assert.equal(search.value, '');

    app.button('Ver recorrido por la app').click();
    assert.equal(app.window.__started, 1, 'the tour starts from here');
    assert.equal(app.calls.length, 0, 'nothing is asked before a question');
  } finally { app.close(); }
}

// 2. «Pregúntale a la IA»: the answer with the sections it comes from; then the manual when the AI is down; then the limit.
{
  const replies = [
    { body: { source: 'ai', answer: 'Pídele más a un administrador de tu organización.', answered: true,
      sections: [{ id: 'creditos', title: 'Créditos y uso diario', href: '/ayuda/creditos', screen: null }] } },
    { body: { source: 'manual', answer: null, answered: true,
      matches: [{ section: { id: 'correo', title: 'Preparar y enviar un correo', href: '/ayuda/correo', screen: null }, q: '¿Desde qué correo sale?', a: 'Desde tu cuenta conectada de Gmail u Outlook.' }] } },
    { status: 429, body: { error: 'Hiciste varias preguntas seguidas. Espera unos minutos y vuelve a intentarlo.' } },
  ];
  const app = await open({ respond: (n) => replies[n - 1] });
  const { asked } = app;
  try {
    await app.waitFor(() => app.doc.querySelector('textarea'), 'the box');
    assert.equal(app.button('Preguntar').disabled, true, 'nothing to ask yet');
    await app.ask('¿Qué hago si me quedo sin créditos?');
    await app.waitFor(() => asked().includes('Pídele más a un administrador'), 'the answer');
    assert.deepEqual(JSON.parse(JSON.stringify(app.calls[0])), { url: '/api/help/ask', body: { question: '¿Qué hago si me quedo sin créditos?', sectionId: null } });
    assert.match(asked(), /Tu pregunta: ¿Qué hago si me quedo sin créditos\?/);
    const more = [...app.doc.querySelectorAll('a')].find((node) => node.textContent === 'Créditos y uso diario' && node.getAttribute('href') === '/ayuda/creditos');
    assert.ok(more, '«Leer más» links to the section');
    assert.equal(app.doc.querySelector('textarea').value, '', 'ready for the next question');

    await app.ask('¿Desde qué correo sale?');
    await app.waitFor(() => asked().includes('La IA no está disponible ahora'), 'the manual answers instead');
    assert.match(asked(), /Desde tu cuenta conectada de Gmail u Outlook\./);

    await app.ask('Otra pregunta más');
    await app.waitFor(() => asked().includes('Hiciste varias preguntas seguidas'), 'the limit says what to do');
    assert.equal(app.doc.querySelector('textarea').value, 'Otra pregunta más', 'the question is kept to try again');
  } finally { app.close(); }
}

// 3. Owners and admins also see the admin panel help.
{
  const app = await open({ role: 'admin' });
  try {
    await app.waitFor(() => app.doc.querySelector('a[href="/ayuda/administracion"]'), 'the admin topic');
    assert.match(app.doc.querySelector('a[href="/ayuda/administracion"]').textContent, /Administración/);
  } finally { app.close(); }
}

// 4. An old link to a section of this page opens the section's own page; an unknown or hidden one stays here.
{
  for (const [hash, role, expected] of [['#perfil', 'member', ['/ayuda/perfil']], ['#administracion', 'member', []],
    ['#administracion', 'owner', ['/ayuda/administracion']], ['#no-existe', 'member', []]]) {
    const app = await open({ role, hash });
    try {
      await app.waitFor(() => app.text().includes('Centro de ayuda'), 'the page');
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.deepEqual([...app.window.__replaced], expected, `${hash} as ${role}`);
    } finally { app.close(); }
  }
}

console.log('PASS: the Centro de ayuda shows the path to the first email, the popular questions and a card per topic by role, searches without accents, answers with the AI or the manual, sends old links to the section page and starts the tour. DOM only, not visual certification.');

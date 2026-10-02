// A section of the manual on its own page (/ayuda/[seccion]), rendered: its title and summary, «Ir a <pantalla>», «Ver guía
// en pantalla» only when the screen has a guide, the steps as numbered cards, tips, frequent questions, what to read next
// without the sections the person cannot see, «Pregúntale a la IA» about this section, and a clear way back when the
// section does not exist or is not for this account. Isolated: esbuild bundles the real page with the auth context and
// next/navigation stubbed; DOM via jsdom; fetch is stubbed. Not visual certification.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const sources = {
  '@/context/AuthContext': 'export const useAuth = () => ({ organizationRole: window.__role });',
  'next/navigation': 'export const useParams = () => ({ seccion: window.__seccion }); export const usePathname = () => `/ayuda/${window.__seccion}`; export const useRouter = () => ({ push() {}, replace() {} });',
};
const externals = new RegExp(`^(${Object.keys(sources).map((key) => key.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('|')})$`);
const bundle = await build({
  stdin: {
    contents: `import React from 'react'; import { createRoot } from 'react-dom/client';
      import HelpSectionPage from './src/app/(app)/ayuda/[seccion]/page';
      window.mount = () => { const root = createRoot(document.getElementById('root')); root.render(<HelpSectionPage />); return () => root.unmount(); };`,
    resolveDir: process.cwd(), loader: 'tsx',
  },
  bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"test"' },
  plugins: [{ name: 'stubs', setup(b) {
    b.onResolve({ filter: externals }, (args) => ({ path: args.path, namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({ contents: sources[args.path], loader: 'js' }));
  } }],
});

async function open(seccion, { role = 'member' } = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: `http://localhost/ayuda/${seccion}`, runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  window.process = { env: { NODE_ENV: 'test' } };
  window.__role = role;
  window.__seccion = seccion;
  window.matchMedia = (media) => ({ matches: false, media, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  const calls = [];
  window.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), body: options.body ? JSON.parse(options.body) : null });
    return { ok: true, status: 200, json: async () => ({ source: 'ai', answer: 'Revisa el borrador y envíalo desde tu correo.', answered: true, sections: [] }) };
  };
  window.eval(bundle.outputFiles[0].text);
  const unmount = window.mount();
  const doc = window.document;
  const link = (label) => [...doc.querySelectorAll('a')].find((node) => node.textContent.trim() === label);
  const section = (title) => doc.querySelector(`section[aria-labelledby="${title}"]`);
  const waitFor = async (predicate, label) => {
    for (let i = 0; i < 400; i++) { if (predicate()) return; await new Promise((resolve) => setTimeout(resolve, 10)); }
    throw new Error(`Timed out: ${label}`);
  };
  await waitFor(() => doc.querySelector('h1, h2, h3'), 'the page');
  return { window, doc, link, section, waitFor, calls, close: () => { unmount(); window.close(); } };
}

// 1. «Por escribir»: the screen and its guide, the steps in order, tips, questions, what follows and the AI about it.
{
  const app = await open('por-escribir');
  try {
    assert.equal(app.doc.querySelector('h1').textContent, 'Por escribir');
    assert.match(app.doc.querySelector('header').textContent, /Contactos/, 'the group it belongs to');
    assert.equal(app.link('Centro de ayuda').getAttribute('href'), '/ayuda', 'the way back');
    assert.equal(app.link('Ir a Por escribir').getAttribute('href'), '/saved/leads/enriched');
    assert.equal(app.link('Ver guía en pantalla').getAttribute('href'), '/saved/leads/enriched?guia=1', 'the guide starts on its screen');

    const steps = [...app.section('help-steps-title').querySelectorAll('ol > li')];
    assert.equal(steps.length, 5);
    assert.deepEqual(steps.map((step) => step.querySelector('span').textContent), ['1', '2', '3', '4', '5'], 'numbered in order');
    assert.equal(app.section('help-tips-title').querySelectorAll('li').length, 2);
    const faqs = [...app.section('help-faqs-title').querySelectorAll('details')];
    assert.equal(faqs.length, 4);
    assert.ok(faqs.every((faq) => faq.querySelector('summary').textContent.endsWith('?')), 'the questions open their answers');
    assert.deepEqual([...app.section('help-related-title').querySelectorAll('a')].map((node) => node.getAttribute('href')),
      ['/ayuda/correo', '/ayuda/perfil', '/ayuda/conversaciones']);

    const box = app.doc.querySelector('aside textarea');
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(box), 'value').set.call(box, '¿Cómo envío el borrador?');
    box.dispatchEvent(new app.window.Event('input', { bubbles: true }));
    await app.waitFor(() => ![...app.doc.querySelectorAll('aside button')].find((node) => node.textContent.trim() === 'Preguntar')?.disabled, 'the question is typed');
    [...app.doc.querySelectorAll('aside button')].find((node) => node.textContent.trim() === 'Preguntar').click();
    await app.waitFor(() => app.doc.querySelector('aside').textContent.includes('Revisa el borrador y envíalo'), 'the answer');
    assert.deepEqual(JSON.parse(JSON.stringify(app.calls[0])), { url: '/api/help/ask', body: { question: '¿Cómo envío el borrador?', sectionId: 'por-escribir' } },
      'the AI knows which section the question comes from');
  } finally { app.close(); }
}

// 2. A screen without a guide: «Ir a» but no «Ver guía en pantalla»; a topic with no screen: neither.
{
  const signatures = await open('firmas');
  try {
    assert.equal(signatures.link('Ir a Firmas y estilo').getAttribute('href'), '/settings/email-studio');
    assert.equal(signatures.link('Ver guía en pantalla'), undefined);
    assert.equal(signatures.section('help-tips-title'), null, 'no tips, no empty block');
  } finally { signatures.close(); }

  const credits = await open('creditos');
  try {
    assert.equal(credits.doc.querySelector('h1').textContent, 'Créditos y uso diario');
    assert.ok(![...credits.doc.querySelectorAll('a')].some((node) => node.textContent.startsWith('Ir a ')), 'no screen to go to');
    assert.equal(credits.link('Ver guía en pantalla'), undefined);
    assert.deepEqual([...credits.section('help-related-title').querySelectorAll('a')].map((node) => node.getAttribute('href')),
      ['/ayuda/hoy', '/ayuda/buscar'], 'members do not get the admin panel as what follows');
  } finally { credits.close(); }

  const admin = await open('creditos', { role: 'owner' });
  try {
    assert.deepEqual([...admin.section('help-related-title').querySelectorAll('a')].map((node) => node.getAttribute('href')),
      ['/ayuda/hoy', '/ayuda/buscar', '/ayuda/administracion']);
  } finally { admin.close(); }
}

// 3. A section that is not for this account, or does not exist: says so and leads back to the Centro de ayuda.
{
  for (const [seccion, role] of [['administracion', 'member'], ['no-existe', 'owner'], ['oportunidades', 'admin'], ['%E0%A4%A', 'member']]) {
    const app = await open(seccion, { role });
    try {
      assert.match(app.doc.body.textContent, /Esta sección no está en el manual/, `${seccion} as ${role}`);
      assert.equal(app.link('Ir al Centro de ayuda').getAttribute('href'), '/ayuda');
      assert.equal(app.doc.querySelector('aside'), null, 'nothing else on the page');
    } finally { app.close(); }
  }
  const app = await open('administracion', { role: 'admin' });
  try {
    assert.equal(app.doc.querySelector('h1').textContent, 'Administración');
  } finally { app.close(); }
}

console.log('PASS: each section of the manual has its page with the screen, its guide, numbered steps, tips, questions, what follows and the AI about it; hidden or unknown sections lead back to the Centro de ayuda. DOM only, not visual certification.');

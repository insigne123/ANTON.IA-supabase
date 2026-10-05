// Screen guides, rendered: a screen with an unseen guide offers it once in a quiet card; «Ver guía» walks its real controls and
// closes with «Entendido»; «Ahora no» is remembered; «Ayuda» in the top bar opens the screen's help, which replays the guide;
// a screen whose controls are not there yet says so instead of opening an empty guide. Isolated DOM test with
// next/navigation stubbed, not visual certification.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const USER = '00000000-0000-4000-8000-0000000000bb';
const nextNavigation = { name: 'next-navigation-stub', setup(b) {
  b.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'next-navigation', namespace: 'stub' }));
  b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
    contents: 'export const usePathname = () => window.__pathname; export const useRouter = () => ({ push() {}, replace() {} });',
    loader: 'js',
  }));
} };

const bundle = await build({
  stdin: {
    contents: `import React from 'react'; import { createRoot } from 'react-dom/client';
    import { SidebarProvider } from './src/components/ui/sidebar';
    import { ProductTourProvider } from './src/components/onboarding/ProductTour';
    import { PageHelpButton } from './src/components/help/PageHelp';
    import { Toaster } from './src/components/ui/toaster';
    function Page({ anchors }) {
      return <div><header><PageHelpButton visibility={{ opportunities: false, admin: false }} /></header>
        {anchors.map((target) => <section key={target} data-tour={target}>{target}</section>)}</div>;
    }
    window.mount = (key, anchors) => { const root = createRoot(document.getElementById('root')); root.render(
      <SidebarProvider key={key} defaultOpen><ProductTourProvider userId="${USER}" onNavigate={() => {}}><Page anchors={anchors} /></ProductTourProvider><Toaster /></SidebarProvider>);
      return () => root.unmount(); };`,
    resolveDir: process.cwd(), loader: 'tsx',
  },
  bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', plugins: [nextNavigation],
  define: { 'process.env.NODE_ENV': '"test"' },
});

async function open({ pathname, anchors, guides = {} }) {
  const dom = new JSDOM('<div id="root"></div>', { url: `http://localhost${pathname}`, runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  window.__pathname = pathname;
  window.process = { env: { NODE_ENV: 'test' } };
  Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
  window.matchMedia = (media) => ({ matches: false, media, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.HTMLElement.prototype.scrollIntoView = function () {};
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    const visible = this.getAttribute('data-tour') && this.getAttribute('data-tour') !== 'page-help';
    return visible ? { top: 200, left: 300, width: 400, height: 60, right: 700, bottom: 260, x: 300, y: 200, toJSON() {} }
      : { top: 0, left: 0, width: 0, height: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON() {} };
  };
  // The tour itself was already seen: only the screen guides are in play.
  window.localStorage.setItem(`antonia:tour:${USER}`, JSON.stringify({ version: 3, status: 'completed', updatedAt: '2026-10-01T00:00:00Z' }));
  const posts = [];
  window.fetch = async (url, options = {}) => {
    const json = (data) => ({ ok: true, status: 200, json: async () => data });
    if (options.method === 'POST') { posts.push(JSON.parse(options.body)); return json({ guides: {} }); }
    return json({ record: { version: 3, status: 'completed', updatedAt: '' }, offer: false, guides });
  };
  window.eval(bundle.outputFiles[0].text);
  const unmount = window.mount('first', anchors);
  const doc = window.document;
  const text = () => doc.body.textContent;
  const button = (label) => [...doc.querySelectorAll('button')].find((node) => node.textContent.trim() === label);
  const card = () => doc.querySelector('[data-product-tour]');
  const panel = () => doc.querySelector('[role="dialog"]:not([data-product-tour])');
  // «Ayuda» opens the screen's help; its first action walks the guide.
  const replay = async () => {
    doc.querySelector('[data-tour="page-help"]').click();
    await waitFor(() => panel(), 'the help panel');
    [...panel().querySelectorAll('button')].find((node) => node.textContent.trim().startsWith('Ver guía de esta pantalla')).click();
  };
  const waitFor = async (predicate, label) => {
    for (let i = 0; i < 400; i++) { if (predicate()) return; await new Promise((resolve) => setTimeout(resolve, 10)); }
    throw new Error(`Timed out: ${label}`);
  };
  return { window, doc, text, button, card, panel, replay, posts, waitFor, remount: (key) => { unmount(); return window.mount(key, anchors); }, close: () => { unmount(); window.close(); } };
}

const SEARCH = ['search-modes', 'search-starters', 'search-run'];

// 1. First visit to Búsqueda: a quiet offer, then the three real controls, then «Entendido».
{
  const app = await open({ pathname: '/search', anchors: SEARCH });
  try {
    await app.waitFor(() => app.text().includes('¿Primera vez en Buscar prospectos?'), 'the offer');
    assert.match(app.text(), /en 3 pasos/);
    assert.equal(app.card(), null, 'the offer is not a modal');
    app.button('Ver guía').click();
    await app.waitFor(() => app.card()?.textContent.includes('Paso 1 de 3'), 'the guide');
    assert.match(app.card().textContent, /Tres formas de buscar/);
    assert.ok(app.button('Cerrar'), 'a guide is closed, not skipped');
    assert.deepEqual(app.posts, [{ guide: 'search' }], 'seen as soon as it starts');
    app.button('Siguiente').click();
    await app.waitFor(() => app.card().textContent.includes('Paso 2 de 3'), 'step 2');
    app.button('Siguiente').click();
    await app.waitFor(() => app.card().textContent.includes('Paso 3 de 3'), 'step 3');
    assert.equal(app.button('Terminar'), undefined);
    app.button('Entendido').click();
    await app.waitFor(() => !app.card(), 'closed');
    assert.equal(app.posts.length, 1, 'closing a guide does not touch the app tour');

    // Replayed from the help of «Ayuda» in the top bar, and never offered again on its own.
    app.remount('again');
    await new Promise((resolve) => setTimeout(resolve, 1100));
    assert.doesNotMatch(app.text(), /¿Primera vez en/);
    app.doc.querySelector('[data-tour="page-help"]').click();
    await app.waitFor(() => app.panel(), 'the help panel');
    assert.match(app.panel().textContent, /Buscar prospectos/);
    assert.match(app.panel().textContent, /Cómo se usa/);
    assert.match(app.panel().textContent, /Preguntas frecuentes/);
    assert.match(app.panel().textContent, /Pregúntale a la IA/);
    assert.match(app.panel().textContent, /Señala los 3 controles principales/);
    [...app.panel().querySelectorAll('button')].find((node) => node.textContent.trim().startsWith('Ver guía de esta pantalla')).click();
    await app.waitFor(() => !app.panel(), 'the panel closes first');
    await app.waitFor(() => app.card()?.textContent.includes('Paso 1 de 3'), 'replay from «Ayuda»');
    app.button('Cerrar').click();
    await app.waitFor(() => !app.card(), 'closed again');
  } finally { app.close(); }
}

// 2. «Ahora no» is remembered; a guide seen on another device is not offered.
{
  const app = await open({ pathname: '/crm', anchors: ['crm-board'] });
  try {
    await app.waitFor(() => app.text().includes('¿Primera vez en Pipeline?'), 'the offer');
    assert.match(app.text(), /en un paso/);
    app.button('Ahora no').click();
    await app.waitFor(() => !app.text().includes('¿Primera vez en'), 'declined');
    assert.deepEqual(app.posts, [{ guide: 'crm' }]);
  } finally { app.close(); }

  const seen = await open({ pathname: '/crm', anchors: ['crm-board'], guides: { crm: true } });
  try {
    await new Promise((resolve) => setTimeout(resolve, 1100));
    assert.doesNotMatch(seen.text(), /¿Primera vez en/);
    assert.ok(seen.doc.querySelector('[data-tour="page-help"]'), '«Ayuda» is still there');
  } finally { seen.close(); }
}

// 3. A screen whose controls are not on screen yet: no offer, and «Ayuda» explains instead of opening an empty guide.
{
  const app = await open({ pathname: '/saved/leads/enriched', anchors: [] });
  try {
    await new Promise((resolve) => setTimeout(resolve, 1100));
    assert.doesNotMatch(app.text(), /¿Primera vez en/);
    await app.replay();
    await app.waitFor(() => app.text().includes('Aún no hay nada que mostrar aquí'), 'the explanation');
    assert.equal(app.card(), null);
  } finally { app.close(); }
}

// 4. A screen without a guide still has its help from the manual; Cowork has its video; a screen without any of them
//    shows no «Ayuda». (Nodes are compared as booleans: a failing assert would print the whole JSDOM tree.)
{
  const app = await open({ pathname: '/settings/privacy', anchors: [] });
  try {
    await new Promise((resolve) => setTimeout(resolve, 200));
    app.doc.querySelector('[data-tour="page-help"]').click();
    await app.waitFor(() => app.panel(), 'the help panel');
    assert.match(app.panel().textContent, /Privacidad/);
    assert.match(app.panel().textContent, /Bajas y exclusiones/);
    assert.ok(![...app.panel().querySelectorAll('button')].some((node) => node.textContent.includes('Ver guía de esta pantalla')), 'no guide to offer');
  } finally { app.close(); }

  const cowork = await open({ pathname: '/cowork', anchors: [] });
  try {
    await new Promise((resolve) => setTimeout(resolve, 200));
    cowork.doc.querySelector('[data-tour="page-help"]').click();
    await cowork.waitFor(() => cowork.panel(), 'the help panel of Cowork');
    assert.match(cowork.panel().textContent, /En video/);
    assert.equal(Boolean(cowork.panel().querySelector('button[aria-label="Ver video: Cowork (0:50)"]')), true, 'its video, not loaded yet');
    assert.equal(cowork.panel().querySelectorAll('video').length, 0, 'nothing plays until it is asked for');
    assert.ok(![...cowork.panel().querySelectorAll('button')].some((node) => node.textContent.includes('Ver guía de esta pantalla')), 'no guide to offer');
  } finally { cowork.close(); }

  const none = await open({ pathname: '/pantalla-sin-ayuda', anchors: [] });
  try {
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(Boolean(none.doc.querySelector('[data-tour="page-help"]')), false, 'no «Ayuda» without help');
  } finally { none.close(); }
}

console.log('PASS: screen guides offered once, walked, declined, replayed from the «Ayuda» panel and explained when empty; Cowork offers its video. DOM only, not visual certification.');

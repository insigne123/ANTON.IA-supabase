// Isolated DOM test: the guided tour opens once for new accounts, can be skipped
// at any step, is replayed from «Ver tutorial» and works on desktop and phones.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const USER = '00000000-0000-4000-8000-0000000000aa';
const MENU_TARGETS = ['antonia', 'profile', 'search', 'campaigns', 'saved-leads', 'contacted', 'connections'];
const bundle = await build({
  stdin: {
    contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
    import {SidebarProvider, useSidebar} from './src/components/ui/sidebar';
    import {ProductTourProvider, useProductTour} from './src/components/onboarding/ProductTour';
    import {Toaster} from './src/components/ui/toaster';
    function Shell() {
      const tour = useProductTour(); const sidebar = useSidebar();
      return <div>
        <output id="sidebar-state">{sidebar.isMobile ? (sidebar.openMobile ? 'sheet-open' : 'sheet-closed') : (sidebar.open ? 'open' : 'closed')}</output>
        <button data-tour="menu">Menú</button>
        <button id="open-sheet" onClick={() => sidebar.setOpenMobile(true)}>Abrir menú</button>
        <nav>{${JSON.stringify(MENU_TARGETS)}.map(target => <a key={target} href="#" data-tour={target}>{target}</a>)}</nav>
        <button data-tour="tour-help" onClick={tour.start}>Ver tutorial</button>
      </div>;
    }
    const root = createRoot(document.getElementById('root'));
    window.navigations = [];
    window.mount = (key, sidebarOpen = true) => root.render(<SidebarProvider key={key} defaultOpen={sidebarOpen}>
      <ProductTourProvider userId="${USER}" onNavigate={href => window.navigations.push(href)}><Shell/></ProductTourProvider>
      <Toaster/>
    </SidebarProvider>);`,
    resolveDir: process.cwd(), loader: 'tsx',
  },
  bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"test"' },
});

// Where each menu entry sits. On phones the entries live in the closed menu sheet.
const DESKTOP_RECTS = {
  antonia: [72, 16, 224, 40], profile: [120, 16, 224, 40], search: [220, 16, 224, 40], campaigns: [268, 16, 224, 40],
  'saved-leads': [380, 16, 224, 40], contacted: [428, 16, 224, 40], connections: [560, 16, 224, 40], 'tour-help': [690, 16, 224, 40],
};
const PHONE_RECTS = { menu: [8, 12, 40, 40] };

async function open({ width = 1280, offer = true, sidebarOpen = true } = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/dashboard', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 768, configurable: true });
  window.matchMedia = media => ({ matches: false, media, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  const rects = { ...(width < 768 ? PHONE_RECTS : DESKTOP_RECTS) };
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    const [top, left, width, height] = rects[this.getAttribute('data-tour')] || [0, 0, 0, 0];
    return { top, left, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() {} };
  };
  const calls = { gets: 0, posts: [] };
  window.fetch = async (url, options = {}) => {
    const json = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
    if (url !== '/api/onboarding/tour') return json({ error: 'No encontrado' }, 404);
    if (options.method === 'POST') {
      calls.posts.push(JSON.parse(options.body));
      return json({ record: { version: 1, status: JSON.parse(options.body).status, updatedAt: '2026-09-25T15:00:00Z' } });
    }
    calls.gets += 1;
    return json({ record: null, offer });
  };
  window.eval(bundle.outputFiles[0].text);
  window.mount('first', sidebarOpen);
  const doc = window.document;
  const text = () => doc.body.textContent;
  const card = () => doc.querySelector('[data-product-tour]');
  const button = label => [...doc.querySelectorAll('button')].find(node => node.textContent.trim() === label);
  const key = (name, target = doc.activeElement || doc.body) => target.dispatchEvent(new window.KeyboardEvent('keydown', { key: name, bubbles: true }));
  const stored = () => JSON.parse(window.localStorage.getItem(`antonia:tour:${USER}`) || 'null');
  return { window, doc, rects, calls, text, card, button, key, stored, close: () => window.close() };
}

const waitFor = async (predicate, label) => {
  for (let i = 0; i < 400; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
  throw new Error(`Timed out: ${label}`);
};
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

// 1. A new account on desktop: welcome, steps, keyboard, back, skip and replay.
{
  const app = await open();
  try {
    await waitFor(() => app.text().includes('Te damos la bienvenida a ANTON.IA'), 'welcome for a new account');
    assert.match(app.text(), /En 8 pasos cortos/);
    assert.match(app.text(), /puedes verlo cuando quieras desde «Ver tutorial»/);
    await waitFor(() => app.doc.activeElement === app.button('Empezar recorrido'), 'focus on the main action');
    app.button('Empezar recorrido').click();

    await waitFor(() => app.card()?.textContent.includes('Paso 1 de 8'), 'first step');
    assert.match(app.card().textContent, /Cuéntanos qué vendes/);
    assert.equal(app.card().getAttribute('role'), 'dialog');
    assert.equal(app.doc.getElementById(app.card().getAttribute('aria-labelledby')).textContent, 'Cuéntanos qué vendes');
    await waitFor(() => app.doc.querySelector('[data-tour-spotlight]')?.style.top === '116px', 'spotlight on «Perfil»');
    assert.equal(app.card().style.left, '256px', 'the card sits right of the menu');
    assert.equal(app.card().style.top, '112px');
    assert.ok(app.card().querySelector('.sr-only')?.textContent.includes('En el menú: Perfil'), 'the location is only read aloud when the entry is highlighted');
    await waitFor(() => app.doc.activeElement === app.button('Siguiente'), 'focus on «Siguiente»');
    assert.equal(app.button('Atrás'), undefined);

    // The menu still moves well after the step opens (the workspace switcher loads): the spotlight follows.
    await pause(900);
    app.rects.profile = [147, 16, 224, 40];
    await waitFor(() => app.doc.querySelector('[data-tour-spotlight]').style.top === '143px', 'spotlight follows a menu that moved');
    assert.equal(app.card().style.top, '139px');
    app.rects.profile = DESKTOP_RECTS.profile;
    await waitFor(() => app.doc.querySelector('[data-tour-spotlight]').style.top === '116px', 'and back');

    app.key('ArrowRight');
    await waitFor(() => app.card().textContent.includes('Paso 2 de 8'), 'arrow key goes forward');
    assert.match(app.card().textContent, /Conecta tu correo/);
    assert.match(app.card().textContent, /Paso 2 de 8: Conecta tu correo\./, 'the new step is announced');
    await waitFor(() => app.card().style.bottom === '160px', 'entries in the lower half grow the card upwards');

    app.button('Atrás').click();
    await waitFor(() => app.card().textContent.includes('Paso 1 de 8'), 'back');
    await waitFor(() => app.doc.activeElement === app.button('Siguiente'), 'focus stays in the card when «Atrás» goes away');

    app.button('Omitir').click();
    await waitFor(() => !app.card(), 'skip closes the tour');
    await waitFor(() => app.calls.posts.length === 1, 'skip is saved on the account');
    assert.deepEqual(app.calls.posts[0], { status: 'skipped' });
    assert.equal(app.stored().status, 'skipped');
    await waitFor(() => app.text().includes('Recorrido omitido'), 'skip says where to find it again');

    app.doc.querySelector('[data-tour="tour-help"]').click();
    await waitFor(() => app.card()?.textContent.includes('Paso 1 de 8'), 'replay starts at the first step');
    assert.doesNotMatch(app.text(), /Te damos la bienvenida/, 'replay skips the welcome');
    for (let step = 2; step <= 8; step++) {
      app.key('ArrowRight');
      await waitFor(() => app.card().textContent.includes(`Paso ${step} de 8`), `step ${step}`);
    }
    assert.match(app.card().textContent, /Listo para empezar/);
    assert.equal(app.button('Omitir'), undefined, 'nothing to skip on the last step');
    assert.ok(app.button('Terminar'));
    app.key('ArrowRight');
    await pause(30);
    assert.match(app.card().textContent, /Paso 8 de 8/);
    app.button('Ir a mi perfil').click();
    await waitFor(() => !app.card(), 'last step closes the tour');
    assert.deepEqual([...app.window.navigations], ['/profile']);
    assert.equal(app.calls.posts.length, 1, 'a replay leaves the account as it is');
    assert.equal(app.stored().status, 'completed');

    app.window.mount('after-reload');
    await pause(80);
    assert.equal(app.calls.gets, 1, 'a finished tour is not asked for again');
    assert.doesNotMatch(app.text(), /Te damos la bienvenida/);
  } finally { app.close(); }
}

// 2. «Ahora no» on the welcome is final and quiet; older accounts never see it.
{
  const app = await open();
  try {
    await waitFor(() => app.button('Ahora no'), 'welcome');
    app.button('Ahora no').click();
    await waitFor(() => app.calls.posts.length === 1, 'declining is saved');
    assert.deepEqual(app.calls.posts[0], { status: 'skipped' });
    await pause(50);
    assert.equal(app.card(), null);
    assert.doesNotMatch(app.text(), /Recorrido omitido/, 'the welcome already said where to find it');
  } finally { app.close(); }

  const old = await open({ offer: false });
  try {
    await waitFor(() => old.calls.gets === 1, 'asked once');
    await pause(80);
    assert.doesNotMatch(old.text(), /Te damos la bienvenida/);
    assert.equal(old.stored(), null);
  } finally { old.close(); }
}

// 3. A folded sidebar opens for the tour and folds back; Escape skips.
{
  const app = await open({ sidebarOpen: false });
  try {
    await waitFor(() => app.button('Empezar recorrido'), 'welcome');
    assert.equal(app.doc.getElementById('sidebar-state').textContent, 'closed');
    app.button('Empezar recorrido').click();
    await waitFor(() => app.card(), 'tour');
    assert.equal(app.doc.getElementById('sidebar-state').textContent, 'open');
    app.key('Escape');
    await waitFor(() => !app.card(), 'Escape closes the tour');
    assert.equal(app.doc.getElementById('sidebar-state').textContent, 'closed', 'the sidebar folds back');
    assert.deepEqual(app.calls.posts, [{ status: 'skipped' }]);
  } finally { app.close(); }
}

// 4. Phones: the menu button stands in for the entries, which live in the folded menu.
{
  const app = await open({ width: 390 });
  try {
    await waitFor(() => app.text().includes('En 9 pasos cortos'), 'welcome on a phone');
    app.button('Empezar recorrido').click();
    await waitFor(() => app.card()?.textContent.includes('Paso 1 de 9'), 'first phone step');
    assert.match(app.card().textContent, /Todo está en este menú/);
    await waitFor(() => app.doc.querySelector('[data-tour-spotlight]')?.style.top === '4px', 'spotlight on the menu button');
    assert.equal(app.card().style.left, '12px');
    assert.equal(app.card().style.right, '12px');

    app.button('Siguiente').click();
    await waitFor(() => app.card().textContent.includes('Paso 2 de 9'), 'second phone step');
    const where = [...app.card().querySelectorAll('p')].find(node => node.textContent.startsWith('En el menú:'));
    assert.equal(where.textContent, 'En el menú: Perfil');
    assert.ok(!where.classList.contains('sr-only'), 'the location is shown when the entry is folded away');
    assert.equal(app.doc.querySelector('[data-tour-spotlight]').style.top, '4px', 'the menu button stays highlighted');
    for (let step = 3; step <= 9; step++) {
      app.button('Siguiente').click();
      await waitFor(() => app.card().textContent.includes(`Paso ${step} de 9`), `phone step ${step}`);
    }
    app.button('Terminar').click();
    await waitFor(() => !app.card(), 'finished');
    assert.deepEqual(app.calls.posts, [{ status: 'completed' }]);
    assert.deepEqual([...app.window.navigations], []);

    // Replayed from inside the open menu sheet: the sheet closes first.
    app.doc.getElementById('open-sheet').click();
    await waitFor(() => app.doc.getElementById('sidebar-state').textContent === 'sheet-open', 'sheet open');
    app.doc.querySelector('[data-tour="tour-help"]').click();
    await waitFor(() => app.doc.getElementById('sidebar-state').textContent === 'sheet-closed', 'sheet closes');
    await waitFor(() => app.card()?.textContent.includes('Paso 1 de 9'), 'tour after the sheet closed');
  } finally { app.close(); }
}

console.log('PASS: the tour opens once for new accounts, can be skipped or replayed, and works on desktop and phones.');
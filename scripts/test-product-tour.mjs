// Isolated DOM test: the guided tour opens once for new accounts, walks every main screen (it opens each one and waits for
// its control), can be skipped at any step, is replayed from «Ver tutorial», goes on after a reload and works on desktop
// and phones. next/navigation is stubbed with a tiny router; screens render their anchors a moment after opening.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const USER = '00000000-0000-4000-8000-0000000000aa';
const MENU_TARGETS = ['home', 'profile', 'search', 'campaigns', 'saved-leads', 'contacted', 'connections'];
// What each screen shows. «Por escribir» is empty for this account: its controls never appear.
const SCREENS = {
  '/dashboard': ['today', 'setup'], '/profile': ['profile-ai', 'profile-offer'], '/connections': ['connections-list'],
  '/search': ['search-modes', 'search-starters'], '/saved/leads': ['saved-list'], '/saved/leads/enriched': [],
  '/contacted': ['conv-views'], '/campaigns': ['campaigns-tabs'], '/crm': ['crm-board'],
};
const nextNavigation = { name: 'next-navigation-stub', setup(b) {
  b.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'next-navigation', namespace: 'stub' }));
  b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
    contents: `import { useSyncExternalStore } from 'react';
      export const usePathname = () => useSyncExternalStore(window.__router.subscribe, () => window.__router.pathname);
      export const useRouter = () => ({ push: window.__router.push, replace: window.__router.push });`,
    loader: 'js', resolveDir: process.cwd(),
  }));
} };
const bundle = await build({
  stdin: {
    contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
    import {usePathname} from 'next/navigation';
    import {SidebarProvider, useSidebar} from './src/components/ui/sidebar';
    import {ProductTourProvider, useProductTour} from './src/components/onboarding/ProductTour';
    import {Toaster} from './src/components/ui/toaster';
    const SCREENS = ${JSON.stringify(SCREENS)};
    function Screen() {
      const pathname = usePathname();
      // A screen renders its controls a moment after it opens.
      const [ready, setReady] = React.useState(null);
      React.useEffect(() => { const t = setTimeout(() => setReady(pathname), 40); return () => clearTimeout(t); }, [pathname]);
      return <main id="screen" data-path={pathname}>{ready === pathname && (SCREENS[pathname] || []).map(target => <section key={target} data-tour={target}>{target}</section>)}</main>;
    }
    function Shell() {
      const tour = useProductTour(); const sidebar = useSidebar();
      return <div>
        <output id="sidebar-state">{sidebar.isMobile ? (sidebar.openMobile ? 'sheet-open' : 'sheet-closed') : (sidebar.open ? 'open' : 'closed')}</output>
        <button data-tour="menu">Menú</button>
        <button data-tour="page-help">?</button>
        <button id="open-sheet" onClick={() => sidebar.setOpenMobile(true)}>Abrir menú</button>
        <nav>{${JSON.stringify(MENU_TARGETS)}.map(target => <a key={target} href="#" data-tour={target}>{target}</a>)}
          <a href="#" data-tour="help-center">Centro de ayuda</a></nav>
        <button data-tour="tour-help" onClick={tour.start}>Ver tutorial</button>
        <Screen/>
      </div>;
    }
    const root = createRoot(document.getElementById('root'));
    window.mount = (key, sidebarOpen = true) => root.render(<SidebarProvider key={key} defaultOpen={sidebarOpen}>
      <ProductTourProvider userId="${USER}" onNavigate={href => window.__router.push(href)}><Shell/></ProductTourProvider>
      <Toaster/>
    </SidebarProvider>);`,
    resolveDir: process.cwd(), loader: 'tsx',
  },
  bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', plugins: [nextNavigation],
  define: { 'process.env.NODE_ENV': '"test"' },
});

// Where each element sits: the menu on the left, the page controls in the content area.
const DESKTOP_RECTS = {
  home: [72, 16, 224, 40], profile: [120, 16, 224, 40], search: [220, 16, 224, 40], campaigns: [268, 16, 224, 40],
  'saved-leads': [380, 16, 224, 40], contacted: [428, 16, 224, 40], connections: [560, 16, 224, 40], 'help-center': [640, 16, 224, 40],
  'tour-help': [690, 16, 224, 40], 'page-help': [10, 1100, 80, 32],
};
const PHONE_RECTS = { menu: [8, 12, 40, 40], 'page-help': [8, 300, 40, 40] };
const PAGE_RECT = [200, 320, 600, 120];
const PHONE_PAGE_RECT = [120, 16, 358, 120];

async function open({ width = 1280, offer = true, sidebarOpen = true } = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/dashboard', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 768, configurable: true });
  window.matchMedia = media => ({ matches: false, media, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.process = { env: { NODE_ENV: 'test' } };
  const scrolled = [];
  window.HTMLElement.prototype.scrollIntoView = function () { scrolled.push(this.getAttribute('data-tour')); };
  const phone = width < 768;
  const rects = { ...(phone ? PHONE_RECTS : DESKTOP_RECTS) };
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    const target = this.getAttribute('data-tour');
    const onPage = target && this.tagName === 'SECTION';
    const [top, left, w, h] = rects[target] || (onPage ? (phone ? PHONE_PAGE_RECT : PAGE_RECT) : [0, 0, 0, 0]);
    return { top, left, width: w, height: h, right: left + w, bottom: top + h, x: left, y: top, toJSON() {} };
  };
  const listeners = new Set();
  const navigations = [];
  window.__router = {
    pathname: '/dashboard',
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    push: (href) => { navigations.push(href); window.__router.pathname = href; listeners.forEach(listener => listener()); },
  };
  const calls = { gets: 0, posts: [] };
  window.fetch = async (url, options = {}) => {
    const json = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
    if (url !== '/api/onboarding/tour') return json({ error: 'No encontrado' }, 404);
    if (options.method === 'POST') {
      calls.posts.push(JSON.parse(options.body));
      return json({ record: { version: 3, status: JSON.parse(options.body).status, updatedAt: '2026-10-01T15:00:00Z' } });
    }
    calls.gets += 1;
    return json({ record: null, offer, guides: {} });
  };
  window.eval(bundle.outputFiles[0].text);
  window.mount('first', sidebarOpen);
  const doc = window.document;
  const text = () => doc.body.textContent;
  const card = () => doc.querySelector('[data-product-tour]');
  const spotlight = () => doc.querySelector('[data-tour-spotlight]');
  const button = label => [...doc.querySelectorAll('button')].find(node => node.textContent.trim() === label);
  const key = (name, target = doc.activeElement || doc.body) => target.dispatchEvent(new window.KeyboardEvent('keydown', { key: name, bubbles: true }));
  const stored = () => JSON.parse(window.localStorage.getItem(`antonia:tour:${USER}`) || 'null');
  const progress = () => JSON.parse(window.sessionStorage.getItem(`antonia:tour-progress:${USER}`) || 'null');
  const path = () => window.__router.pathname;
  return { window, doc, rects, calls, navigations, scrolled, text, card, spotlight, button, key, stored, progress, path, close: () => window.close() };
}

const waitFor = async (predicate, label, tries = 400) => {
  for (let i = 0; i < tries; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
  throw new Error(`Timed out: ${label}`);
};
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const DESKTOP_PATH = ['/dashboard', '/dashboard', '/profile', '/profile', '/connections', '/search', '/search', '/saved/leads',
  '/saved/leads/enriched', '/saved/leads/enriched', '/contacted', '/campaigns', '/crm', '/crm', '/crm'];

// 1. A new account on desktop: welcome, steps across screens, keyboard, back, skip, replay of the whole app.
{
  const app = await open();
  try {
    await waitFor(() => app.text().includes('Te damos la bienvenida a ANTON.IA'), 'welcome for a new account');
    assert.match(app.text(), /En 15 pasos te llevamos por cada pantalla/);
    assert.match(app.text(), /puedes verlo cuando quieras desde «Ver tutorial»/);
    await waitFor(() => app.doc.activeElement === app.button('Empezar recorrido'), 'focus on the main action');
    app.button('Empezar recorrido').click();

    await waitFor(() => app.card()?.textContent.includes('Paso 1 de 15 · Hoy'), 'first step, with its section');
    assert.match(app.card().textContent, /Empieza cada día aquí/);
    assert.equal(app.card().getAttribute('role'), 'dialog');
    assert.equal(app.doc.getElementById(app.card().getAttribute('aria-labelledby')).textContent, 'Empieza cada día aquí');
    await waitFor(() => app.spotlight()?.style.top === '196px', 'spotlight on «Lo primero hoy», on the page');
    assert.deepEqual(app.navigations, [], 'already on «Hoy»: nothing to open');
    assert.ok(app.scrolled.includes('today'), 'the page control is brought into view');
    await waitFor(() => app.doc.activeElement === app.button('Siguiente'), 'focus on «Siguiente»');
    assert.equal(app.button('Atrás'), undefined);
    assert.deepEqual(app.progress(), { version: 3, index: 0 });

    app.key('ArrowRight');
    await waitFor(() => app.card().textContent.includes('Paso 2 de 15 · Hoy'), 'arrow key goes forward');
    assert.match(app.card().textContent, /Paso 2 de 15 · Hoy: Prepara tu cuenta\./, 'the new step is announced with its section');
    app.key('ArrowRight');
    await waitFor(() => app.card().textContent.includes('Paso 3 de 15 · Perfil'), 'third step');
    assert.match(app.card().textContent, /Cuéntanos qué vendes/);
    assert.deepEqual(app.navigations, ['/profile'], 'the tour opens the screen of the step');
    await waitFor(() => app.doc.querySelector('[data-tour="profile-ai"]') && app.spotlight()?.style.top === '196px', 'spotlight once the screen renders the control');
    assert.deepEqual(app.progress(), { version: 3, index: 2 });

    app.button('Atrás').click();
    await waitFor(() => app.card().textContent.includes('Paso 2 de 15'), 'back');
    await waitFor(() => app.path() === '/dashboard', 'back opens the previous screen');
    app.button('Atrás').click();
    await waitFor(() => app.card().textContent.includes('Paso 1 de 15'), 'back to the first step');
    await waitFor(() => app.doc.activeElement === app.button('Siguiente'), 'focus stays in the card when «Atrás» goes away');

    app.button('Omitir').click();
    await waitFor(() => !app.card(), 'skip closes the tour');
    await waitFor(() => app.calls.posts.length === 1, 'skip is saved on the account');
    assert.deepEqual(app.calls.posts[0], { status: 'skipped' });
    assert.equal(app.stored().status, 'skipped');
    assert.equal(app.progress(), null, 'nothing left to resume');
    await waitFor(() => app.text().includes('Recorrido omitido'), 'skip says where to find it again');

    // Replayed: every screen, in order, ending where help lives.
    app.doc.querySelector('[data-tour="tour-help"]').click();
    await waitFor(() => app.card()?.textContent.includes('Paso 1 de 15'), 'replay starts at the first step');
    assert.doesNotMatch(app.text(), /Te damos la bienvenida/, 'replay skips the welcome');
    for (let step = 2; step <= 15; step++) {
      app.key('ArrowRight');
      await waitFor(() => app.card().textContent.includes(`Paso ${step} de 15`), `step ${step}`);
      await waitFor(() => app.path() === DESKTOP_PATH[step - 1], `step ${step} is on ${DESKTOP_PATH[step - 1]}`);
      if (step === 9) {
        // «Por escribir» without contacts: no spotlight on nothing, and the card says why.
        await waitFor(() => app.card().textContent.includes('Esta pantalla aún no muestra este control'), 'the empty screen is explained', 400);
        assert.equal(app.spotlight(), null);
      }
    }
    assert.deepEqual(app.navigations.slice(1), ['/dashboard', '/profile', '/connections', '/search', '/saved/leads', '/saved/leads/enriched', '/contacted', '/campaigns', '/crm']);
    assert.match(app.card().textContent, /Paso 15 de 15 · Ayuda/);
    assert.match(app.card().textContent, /El manual completo/);
    await waitFor(() => app.spotlight()?.style.top === '636px', 'spotlight on «Centro de ayuda» in the menu');
    assert.equal(app.button('Omitir'), undefined, 'nothing to skip on the last step');
    assert.ok(app.button('Terminar'));
    app.key('ArrowRight');
    await pause(30);
    assert.match(app.card().textContent, /Paso 15 de 15/);
    app.button('Empezar en Hoy').click();
    await waitFor(() => !app.card(), 'last step closes the tour');
    assert.equal(app.path(), '/dashboard', 'it ends on «Hoy», which says what to do first');
    await waitFor(() => app.calls.posts.length === 2, 'the guides it walked are remembered');
    assert.deepEqual(app.calls.posts[1].guides.sort(), ['campaigns', 'connections', 'conversations', 'crm', 'enriched', 'home', 'profile', 'saved', 'search']);
    assert.ok(!app.calls.posts.some(post => post.status === 'completed'), 'a replay leaves the tour record as it is');
    assert.equal(app.stored().status, 'completed');

    app.window.mount('after-reload');
    await pause(80);
    assert.equal(app.calls.gets, 1, 'a finished tour is not asked for again');
    assert.doesNotMatch(app.text(), /Te damos la bienvenida/);
    assert.equal(app.card(), null);
  } finally { app.close(); }
}

// 2. A reload in the middle of the tour goes on from the same step.
{
  const app = await open();
  try {
    await waitFor(() => app.button('Empezar recorrido'), 'welcome');
    app.button('Empezar recorrido').click();
    for (let step = 2; step <= 4; step++) {
      await waitFor(() => app.button('Siguiente'), 'next');
      app.button('Siguiente').click();
      await waitFor(() => app.card()?.textContent.includes(`Paso ${step} de 15`), `step ${step}`);
    }
    app.window.mount('reloaded');
    await waitFor(() => app.card()?.textContent.includes('Paso 4 de 15 · Perfil'), 'resumed at the same step');
    await pause(80);
    assert.doesNotMatch(app.text(), /Te damos la bienvenida/, 'the welcome does not interrupt it');
    app.button('Omitir').click();
    await waitFor(() => !app.card(), 'skipped');
    app.window.mount('reloaded-again');
    await pause(80);
    assert.equal(app.card(), null, 'a closed tour does not come back on reload');
  } finally { app.close(); }
}

// 3. «Ahora no» on the welcome is final and quiet; older accounts never see it.
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
    assert.deepEqual(app.navigations, [], 'declining opens nothing');
  } finally { app.close(); }

  const old = await open({ offer: false });
  try {
    await waitFor(() => old.calls.gets === 1, 'asked once');
    await pause(80);
    assert.doesNotMatch(old.text(), /Te damos la bienvenida/);
    assert.equal(old.stored(), null);
  } finally { old.close(); }
}

// 4. A folded sidebar opens for the tour and folds back; Escape skips.
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

// 5. Phones: page controls are highlighted on the page; menu entries through the menu button.
{
  const app = await open({ width: 390 });
  try {
    await waitFor(() => app.text().includes('En 16 pasos'), 'welcome on a phone');
    app.button('Empezar recorrido').click();
    await waitFor(() => app.card()?.textContent.includes('Paso 1 de 16 · Menú'), 'first phone step');
    assert.match(app.card().textContent, /Todo está en este menú/);
    await waitFor(() => app.spotlight()?.style.top === '4px', 'spotlight on the menu button');
    assert.equal(app.card().style.left, '12px');
    assert.equal(app.card().style.right, '12px');

    app.button('Siguiente').click();
    await waitFor(() => app.card().textContent.includes('Paso 2 de 16 · Hoy'), 'second phone step');
    await waitFor(() => app.spotlight()?.style.top === '116px', 'the page control itself, not the menu button');
    assert.ok(![...app.card().querySelectorAll('p')].some(node => node.textContent.startsWith('En el menú:')), 'a page control needs no menu hint');
    for (let step = 3; step <= 16; step++) {
      app.button('Siguiente').click();
      await waitFor(() => app.card().textContent.includes(`Paso ${step} de 16`), `phone step ${step}`);
    }
    const where = [...app.card().querySelectorAll('p')].find(node => node.textContent.startsWith('En el menú:'));
    assert.equal(where.textContent, 'En el menú: Centro de ayuda');
    assert.ok(!where.classList.contains('sr-only'), 'the location is shown when the entry is folded away');
    await waitFor(() => app.spotlight()?.style.top === '4px', 'the menu button stands in for the folded entry');
    app.button('Terminar').click();
    await waitFor(() => !app.card(), 'finished');
    await waitFor(() => app.calls.posts.length === 2, 'saved');
    assert.deepEqual(app.calls.posts[0], { status: 'completed' });
    assert.equal(app.path(), '/crm', '«Terminar» stays where the tour ended');

    // Replayed from inside the open menu sheet: the sheet closes first.
    app.doc.getElementById('open-sheet').click();
    await waitFor(() => app.doc.getElementById('sidebar-state').textContent === 'sheet-open', 'sheet open');
    app.doc.querySelector('[data-tour="tour-help"]').click();
    await waitFor(() => app.doc.getElementById('sidebar-state').textContent === 'sheet-closed', 'sheet closes');
    await waitFor(() => app.card()?.textContent.includes('Paso 1 de 16'), 'tour after the sheet closed');
  } finally { app.close(); }
}

console.log('PASS: the tour opens once for new accounts, walks every screen, can be skipped, replayed or resumed, and works on desktop and phones.');

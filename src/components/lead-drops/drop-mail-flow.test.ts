import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test, { after } from 'node:test';
import ts from 'typescript';
import { JSDOM } from 'jsdom';
import * as contactCalls from '@/lib/contact-calls';
import * as leadDropCall from '@/lib/lead-drop-call';
import * as leadDrops from '@/lib/lead-drops';
import * as provider from '@/lib/leads-workspace/enrichment-provider';
import * as navigation from '@/lib/navigation';

// «Contacto del día» opened from the person's inbox (DropMailFlow): the page with the real card, and the server answered by hand.
const TOKEN = 'A'.repeat(48);
const dom = new JSDOM('<div id="root"></div>', { url: `https://app.test/contactos/${TOKEN}?c=6accdbfcd5f5d80001cf6902` });
const previous = { window: (globalThis as any).window, document: (globalThis as any).document, fetch: globalThis.fetch };
Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
const React = (await import('react')).default;
const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const require = createRequire(import.meta.url);
after(() => { Object.assign(globalThis, { ...previous, IS_REACT_ACT_ENVIRONMENT: false }); dom.window.close(); });

const compile = async (file: string, stubs: Record<string, unknown>) => {
  const code = ts.transpileModule(await readFile(new URL(file, import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const exports: any = {};
  new Function('require', 'exports', code)((id: string) => id in stubs ? stubs[id] : require(id), exports);
  return exports;
};
const shared: Record<string, unknown> = {
  '@/components/ui/button': { Button: ({ asChild, variant: _variant, size: _size, ...props }: any) => asChild ? props.children : React.createElement('button', props) },
  '@/components/ui/input': { Input: (props: any) => React.createElement('input', props) },
  '@/components/ui/textarea': { Textarea: (props: any) => React.createElement('textarea', props) },
  '@/components/ui/label': { Label: (props: any) => React.createElement('label', props) },
  '@/components/ui/card': { Card: (props: any) => React.createElement('div', props), CardContent: (props: any) => React.createElement('div', props) },
  'lucide-react': new Proxy({}, { get: () => 'svg' }),
  'next/link': { __esModule: true, default: ({ href, children, ...props }: any) => React.createElement('a', { href, ...props }, children) },
  '@/lib/lead-drops': leadDrops,
  // «Para llamar»: the real rules of the number and of the script; the app's «Llamar» and «WhatsApp» as a line that says what it got.
  '@/lib/contact-calls': contactCalls,
  '@/lib/lead-drop-call': leadDropCall,
  '@/components/contact/ContactActions': { ContactActions: ({ phone, whatsappText, contact }: any) => React.createElement('p', { 'data-contact-actions': contact?.leadId || '', 'data-whatsapp': whatsappText || '' }, `Llamar · WhatsApp · ${phone}`) },
  '@/lib/leads-workspace/enrichment-provider': provider,
  '@/lib/utils': { cn: (...values: unknown[]) => values.filter(Boolean).join(' ') },
};
// The page's own pieces are the real ones: the app's tabs, the avatar and the stage chip, the list of contacts and their card.
shared['@/hooks/use-scroll-edge-fade'] = { useScrollEdgeFade: () => [() => {}, undefined] };
shared['@/components/ui/segmented-tabs'] = await compile('../ui/segmented-tabs.tsx', shared);
shared['./drop-contact-parts'] = await compile('./drop-contact-parts.tsx', shared);
const callPanel = await compile('./DropCallPanel.tsx', shared);
const card = await compile('./DropContactCard.tsx', { ...shared, './DropCallPanel': callPanel });
const bulkPanel = await compile('./DropBulkEnrich.tsx', shared);
const workspace = await compile('./DropContactsWorkspace.tsx', shared);
const flow = await compile('./DropMailFlow.tsx', { ...shared, './DropContactCard': card, './DropBulkEnrich': bulkPanel, './DropContactsWorkspace': workspace });
// The page sits in the app's own frame (16 Nov 2026, the owner: «no hay forma de acceder al resto de la app desde este link… es una
// forma de acercarlo a la app»): the app's menu and «Entrar», each entry the app's own address.
const frame = await compile('./DropAppFrame.tsx', { ...shared, '@/components/logo': { __esModule: true, default: () => React.createElement('a', { href: '/', 'data-logo': '' }, 'ANTON.IA') }, '@/lib/navigation': navigation });

const LEAD = '6accdbfcd5f5d80001cf6901', OTHER = '6accdbfcd5f5d80001cf6902';
const contact = (leadId: string, name: string, extra: Record<string, unknown> = {}) => ({ leadId, name, title: 'Gerente HSE', company: 'Minera Andina', domain: null, industry: 'Minería', size: null, city: null,
  hasEmail: true, hasPhone: false, why: 'Calza con tu cliente ideal por su cargo.', research: [], provider: 'apollo',
  draft: { subject: 'Brigadas en faena', body: 'Hola {{nombre}},\n\n¿Cómo cubren los turnos de noche?' }, followUps: [{ day: 3, subject: 'Re: brigadas', body: 'Hola {{nombre}}, ¿lo vemos?' }], ...extra });
const viewOf = (items: unknown[], extra: Record<string, unknown> = {}) => ({ date: '2026-11-13', items, emails: {}, mailbox: null, ...extra });
const text = () => (dom.window.document.body.textContent || '').replace(/\s+/g, ' ');
const button = (label: string | RegExp) => [...dom.window.document.querySelectorAll('button')].find(entry => typeof label === 'string' ? entry.textContent === label : label.test(entry.textContent || ''));
const press = async (target: Element) => { await act(async () => { target.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); }); };
/** The list of contacts at the side of the page: who they are and where each stands. */
const rail = () => [...dom.window.document.querySelectorAll('nav[aria-label="Tus contactos"] button')];
const settle = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); };
/** The server, answered by hand: what each button asked, in order. */
const server = (answer: (body: any) => { status?: number; body: any }) => {
  const asked: any[] = [];
  globalThis.fetch = (async (url: string, init: any) => {
    const body = JSON.parse(init.body);
    asked.push({ url, method: init.method, ...body });
    const result = answer(body);
    return Response.json(result.body, { status: result.status ?? 200 });
  }) as any;
  return asked;
};
const mount = async (initial: unknown, props: Record<string, unknown> = {}) => {
  const root = createRoot(dom.window.document.getElementById('root')!);
  await act(async () => root.render(React.createElement(flow.DropMailFlow, { token: TOKEN, initial, focus: null, mailboxNotice: null, ...props })));
  return root;
};

test('opened from the email: the contacts with their steps, nothing leading into the app, and arriving looks nothing up', async () => {
  const asked = server(() => ({ body: {} }));
  const root = await mount(viewOf([contact(LEAD, 'Pedro Araya'), contact(OTHER, 'Luisa Soto')]), { focus: OTHER });
  try {
    const document = dom.window.document;
    // Where the day stands, in three numbers (16 Nov 2026, the redesign: they replace a sentence that had to be read).
    assert.match(text(), /^\s*Tus contactos de hoy\s*Elegidos para ti el viernes, 13 de noviembre\.\s*Por enriquecer\s*2\s*Por aprobar\s*0\s*En marcha\s*0/);
    // The contacts are a list at the side, each with where it stands, and one card to read and act on at a time.
    assert.deepEqual(rail().map(entry => [entry.textContent, entry.getAttribute('aria-current')]),
      [['PAPor enriquecerPedro ArayaGerente HSE · Minera AndinaPor enriquecer', null], ['LSPor enriquecerLuisa SotoGerente HSE · Minera AndinaPor enriquecer', 'true']]);
    assert.equal(document.querySelectorAll('article').length, 1);
    assert.equal([...document.querySelectorAll('button')].filter(entry => entry.textContent === 'Enriquecer · 1 crédito').length, 1);
    assert.match(text(), /Busca su correo de trabajo para poder escribirle\./);
    // The contact the email linked to is the one open, with its campaign in view; the address keeps the link and nothing else.
    assert.ok(document.getElementById(`contacto-${OTHER}`)!.textContent!.includes('Hola Luisa,'));
    assert.equal(document.getElementById(`contacto-${LEAD}`), null);
    // Another one is a tap on the list away, and opens on why it is recommended.
    await press(rail()[0]);
    assert.deepEqual(rail().map(entry => entry.getAttribute('aria-current')), ['true', null]);
    assert.match(document.getElementById(`contacto-${LEAD}`)!.textContent || '', /^PAPedro ArayaPor enriquecer[\s\S]*Por qué te lo recomendamos/);
    assert.ok(!document.getElementById(`contacto-${LEAD}`)!.textContent!.includes('Hola Pedro,'));
    assert.equal(document.getElementById(`contacto-${OTHER}`), null);
    assert.match(text(), /Anterior\s*1 de 2\s*Siguiente/, 'on a phone the list is a row of faces, with the way to the next one under the card');
    assert.equal(dom.window.location.pathname + dom.window.location.search, `/contactos/${TOKEN}`);
    assert.deepEqual([...document.querySelectorAll('a')].map(link => link.getAttribute('href')), [], 'the contacts themselves lead nowhere else: the way into the app is the frame\'s (DropAppFrame)');
    assert.equal(asked.length, 0, 'opening the page asks the server for nothing');
    assert.match(text(), /Esta página es personal/);
  } finally { await act(async () => root.unmount()); }
});

test('the page of the email sits in the app\'s frame: its menu, where the person is, and the way in', async () => {
  const href = `/dashboard?contactos=${TOKEN}`;
  const root = createRoot(dom.window.document.getElementById('root')!);
  const show = (props: Record<string, unknown>) => act(async () => root.render(React.createElement(frame.DropAppFrame, props, React.createElement('main', null, 'Tus contactos'))));
  try {
    await show({ todayHref: href, signedIn: false });
    const document = dom.window.document;
    const menu = document.querySelector('aside nav[aria-label="Secciones de ANTON.IA"]')!;
    // The work screens every team has, in the app's order; «Hoy» brings these same contacts into view.
    assert.deepEqual([...menu.querySelectorAll('a')].map(link => [link.textContent, link.getAttribute('href')]), [['Hoy', href], ['Buscar prospectos', '/search'],
      ['Por escribir', '/saved/leads/enriched'], ['Tabla de datos', '/sheet'], ['Conversaciones', '/contacted'], ['Campañas', '/campaigns'], ['Pipeline', '/crm']]);
    assert.deepEqual([...menu.querySelectorAll('p')].filter(entry => !entry.hasAttribute('aria-current')).map(entry => entry.textContent), ['Centro de mando', 'Prospectar', 'Contactos', 'Seguimiento']);
    assert.doesNotMatch(menu.textContent || '', /Cowork|Oportunidades|Administración|Perfil/, 'nothing that depends on the team\'s plan or on a role');
    assert.equal(menu.querySelector('[aria-current="page"]')?.textContent, 'Tus contactos de hoy');
    // Nobody signed in: the way in says so, and leads to «Hoy» with these contacts.
    assert.deepEqual([...document.querySelectorAll('aside > div a:not([data-logo])')].map(link => [link.textContent, link.getAttribute('href')]), [['Entrar a ANTON.IA', href]]);
    assert.match(document.querySelector('aside')!.textContent || '', /Entra con tu cuenta para buscar más prospectos, seguir tus campañas y responder desde un solo lugar\./);
    // A phone has the same: the brand and the way in at the top, and the screens in a row.
    const top = document.querySelector('header')!;
    assert.deepEqual([...top.querySelectorAll('nav a')].map(link => link.textContent), ['Hoy', 'Buscar prospectos', 'Por escribir', 'Tabla de datos', 'Conversaciones', 'Campañas', 'Pipeline']);
    assert.ok([...top.querySelectorAll('a')].some(link => link.textContent === 'Entrar a ANTON.IA' && link.getAttribute('href') === href));
    assert.equal(document.querySelector('main')?.textContent, 'Tus contactos', 'the contacts are its content');
    // With a session on the browser it is opening, not signing in; sent here by «Hoy», «Hoy» is plain «Hoy».
    await show({ todayHref: '/dashboard', signedIn: true });
    assert.ok([...document.querySelectorAll('aside a')].some(link => link.textContent === 'Abrir ANTON.IA' && link.getAttribute('href') === '/dashboard'));
    assert.equal(menu.isConnected ? menu.querySelector('a')?.getAttribute('href') : document.querySelector('aside nav a')?.getAttribute('href'), '/dashboard');
    assert.doesNotMatch(document.body.textContent || '', /Entrar a ANTON\.IA/);
  } finally { await act(async () => root.unmount()); }
});

test('the page of the email: signed in as the person it names, the contacts open in «Hoy»; nobody is asked to sign in', () => {
  const page = readFileSync(new URL('../../app/contactos/[token]/page.tsx', import.meta.url), 'utf8');
  // The link is checked first, and only the person it names is sent into the app: another account's session stays on this page.
  assert.match(page, /const \{ dropId, scope \} = await resolveDropLink\(admin, token\);\s*const viewer = await viewerId\(\);\s*inside = !stay && !bulk && !call && !single\(query\.correo\) && viewer === scope\.userId;/);
  // «Enriquecer los N» of the morning email is the way on from the inbox: it stays on this page, with the choice made there.
  assert.match(page, /const bulk = todos === 'telefono' \? 'phone' as const : todos === 'correo' \? 'email' as const : null;/);
  assert.match(page, /return user\?\.id \?\? null;\s*\} catch \{ return null; \}/);
  // Sent back by «Hoy» (`aqui=1`) or coming back from connecting a mailbox (`correo`): it stays here, and offers no way back in a loop.
  assert.match(page, /const stay = single\(query\.aqui\) === '1';/);
  assert.match(page, /<DropAppFrame todayHref=\{stay \? '\/dashboard' : inApp\(token, null\)\} signedIn=\{Boolean\(viewer\)\}>\s*<DropMailFlow /);
  assert.match(page, /const inApp = \(token: string, leadId: string \| null\) => `\/dashboard\?contactos=\$\{encodeURIComponent\(token\)\}/);
  // The redirect is thrown outside the try, so it is never shown as a broken link.
  assert.ok(page.indexOf('redirect(inApp(token, focus));') > page.indexOf("'Entrar a ANTON.IA'") || page.indexOf('redirect(inApp(token, focus));') > page.indexOf('Entrar a ANTON.IA'));
  assert.doesNotMatch(page, /redirect\('\/login/);
});

test('«Enriquecer» is one tap: found, it says so with the address and the next step is to connect the mailbox, once, right there', async () => {
  const found = contact(LEAD, 'Pedro Araya', { savedLeadId: 'e-1' });
  const asked = server(body => body.action === 'enrich'
    ? { body: { view: viewOf([found, contact(OTHER, 'Luisa Soto')], { emails: { [LEAD]: 'pedro.araya@mineraandina.cl' } }), lookup: { outcome: 'found', email: 'pedro.araya@mineraandina.cl', consumed: 1 } } }
    : { status: 500, body: { error: 'x' } });
  // The search hid the surname («Pedro Ar***a»); the lookup brings it, and that is the name the page says.
  const root = await mount(viewOf([contact(LEAD, 'Pedro Ar***a'), contact(OTHER, 'Luisa Soto')]));
  try {
    const document = dom.window.document;
    assert.match(document.getElementById(`contacto-${LEAD}`)!.textContent || '', /^PAPedro A\.Por enriquecer/);
    await press(document.querySelector('article button')!);
    await settle();
    assert.deepEqual(asked, [{ url: '/api/lead-drops/link', method: 'POST', token: TOKEN, action: 'enrich', leadId: LEAD }]);
    assert.match(document.querySelector('[role="status"]')!.textContent || '', /^Listo: encontramos el correo de Pedro Araya\. Revisa su campaña y apruébala\. Se descontó 1 crédito de ANTON\.IA\.$/);
    assert.match(document.getElementById(`contacto-${LEAD}`)!.textContent || '', /pedro\.araya@mineraandina\.cl/);
    assert.match(text(), /Por enriquecer\s*1\s*Por aprobar\s*1\s*En marcha\s*0/);
    assert.match(rail()[0].textContent || '', /Pedro Araya.*Campaña por aprobar$/, 'the list says where each contact stands');
    // No mailbox yet: the step is to connect one, and each button goes to its consent with the link that names the person.
    assert.equal(button('Aprobar y programar'), undefined);
    assert.deepEqual([...document.querySelectorAll('a')].map(link => [link.textContent, link.getAttribute('href')]), [
      ['Conectar Gmail', `/api/auth/connect/google?enlace=${TOKEN}`], ['Conectar Outlook', `/api/auth/connect/azure?enlace=${TOKEN}`]]);
    assert.match(text(), /Es una sola vez: los correos salen desde tu propia casilla\./);
    assert.doesNotMatch(text(), /Por escribir|Conexiones|Campañas»/, 'no part of the app is named: there is nothing to learn');
  } finally { await act(async () => root.unmount()); }
});

test('back from a consent with someone else\'s mailbox, the page says it was not connected and which one to choose', async () => {
  server(() => ({ body: {} }));
  const root = await mount(viewOf([contact(LEAD, 'Pedro Araya', { savedLeadId: 'e-1' })]), { mailboxNotice: 'otro' });
  try {
    assert.match(dom.window.document.querySelector('[role="status"]')!.textContent || '', /^Ese no es el correo de tu cuenta, así que no lo conectamos\. Elige el correo con el que entras a ANTON\.IA/);
    assert.ok([...dom.window.document.querySelectorAll('a')].some(link => link.textContent === 'Conectar Gmail'), 'the step is still there to try again');
  } finally { await act(async () => root.unmount()); }
});

test('nothing found and a refusal are said as they are, and the contact stays to try again', async () => {
  let step = 0;
  const asked = server(() => ++step === 1
    ? { body: { view: viewOf([contact(LEAD, 'Pedro Ar***a', { lookup: { attempt: 1, at: '2026-11-13T12:00:00.000Z', missed: true } })]), lookup: { outcome: 'not_found', email: null, consumed: 0 } } }
    : { status: 409, body: { error: 'Tu equipo usó sus créditos de este mes.' } });
  const root = await mount(viewOf([contact(LEAD, 'Pedro Ar***a')]));
  try {
    const document = dom.window.document;
    assert.match(text(), /Tu contacto de hoy/);
    await press(button('Enriquecer · 1 crédito')!);
    await settle();
    assert.equal(document.querySelector('[role="status"]')!.textContent, 'No encontramos un correo para Pedro A. No se descontó ningún crédito.', 'a hidden surname already ends the sentence');
    assert.match(text(), /La última búsqueda no encontró su correo\./);
    await press(button('Enriquecer · 1 crédito')!);
    await settle();
    assert.equal(document.querySelector('[role="status"]')!.textContent, 'Tu equipo usó sus créditos de este mes.');
    assert.equal(asked.length, 2);
    assert.equal(button('Enriquecer · 1 crédito')!.disabled, false);
  } finally { await act(async () => root.unmount()); }
});

test('with the mailbox connected: «Aprobar y programar» says from where and when each email goes, and the campaign is stopped and resumed from the same card', async () => {
  const saved = contact(LEAD, 'Pedro Araya', { savedLeadId: 'e-1' });
  const going = { ...saved, campaign: { id: 'c-1', provider: 'outlook', approvedAt: '2026-11-13T12:00:00.000Z' } };
  const view = (item: unknown) => viewOf([item], { emails: { [LEAD]: 'pedro@mineraandina.cl' }, mailbox: 'Outlook' });
  const asked = server(body => body.action === 'approve' ? { body: { view: view(going), provider: 'Outlook', schedule: ['2026-11-13', '2026-11-16'] } }
    : body.action === 'pause' ? { body: { view: view({ ...going, campaign: { ...going.campaign, pausedAt: '2026-11-13T13:00:00.000Z' } }) } }
    : { body: { view: view(going) } });
  // Back from Outlook's consent: the page says the mailbox is connected.
  const root = await mount(view(saved), { mailboxNotice: 'conectado' });
  try {
    const document = dom.window.document;
    const status = () => document.querySelector('[role="status"]')!.textContent;
    assert.equal(status(), 'Tu correo quedó conectado. Ya puedes aprobar y programar tus campañas.');
    assert.match(text(), /Sale desde tu Outlook\. Se detiene si responde\./);
    await press(button('Aprobar y programar')!);
    await settle();
    assert.equal(status(), 'Campaña de Pedro Araya programada desde tu Outlook: el primer correo sale en unos minutos y el seguimiento el lun 16 nov. Se detiene sola si responde.');
    assert.match(text(), /Campaña en curso/);
    assert.equal(button('Aprobar y programar'), undefined);
    assert.equal(button('Editar los correos'), undefined, 'an approved campaign is not rewritten from here');
    await press(button('Detener la campaña')!);
    await settle();
    assert.equal(status(), 'Detuvimos la campaña de Pedro Araya: no sale ningún correo más.');
    assert.match(text(), /Campaña detenida[\s\S]*Detenida: no sale ningún correo más\./);
    await press(button('Reanudar la campaña')!);
    await settle();
    assert.equal(status(), 'La campaña de Pedro Araya sigue desde donde quedó.');
    assert.deepEqual(asked.map(entry => [entry.action, entry.leadId, entry.token]), [['approve', LEAD, TOKEN], ['pause', LEAD, TOKEN], ['resume', LEAD, TOKEN]]);
    assert.deepEqual([...document.querySelectorAll('a')].map(link => link.getAttribute('href')), [], 'still nothing leading into the app');
  } finally { await act(async () => root.unmount()); }
});

test('«Enriquecer los N»: the email brings the choice, the button confirms it; each contact is looked up in turn and the answer goes to the inbox', async () => {
  const third = '6accdbfcd5f5d80001cf6903';
  const items = [contact(LEAD, 'Pedro Araya'), contact(OTHER, 'Luisa Soto'), contact(third, 'Raúl Pinto')];
  const saved = new Set<string>();
  const asked = server(body => {
    if (body.action === 'enrich') {
      if (body.leadId === third) return { body: { view: viewOf(items.map(item => saved.has(item.leadId) ? { ...item, savedLeadId: `e-${item.leadId}` } : item)), lookup: { outcome: 'not_found', email: null, consumed: 0 } } };
      saved.add(body.leadId);
      return { body: { view: viewOf(items.map(item => saved.has(item.leadId) ? { ...item, savedLeadId: `e-${item.leadId}` } : item)), lookup: { outcome: 'found', email: 'x@y.cl', consumed: 8 } } };
    }
    if (body.action === 'ready') return { body: { view: viewOf(items.map(item => saved.has(item.leadId) ? { ...item, savedLeadId: `e-${item.leadId}` } : item)), mailed: true } };
    return { status: 500, body: { error: 'x' } };
  });
  // «Con sus teléfonos» of the morning email: the page opens with that choice made, and nothing asked yet.
  const root = await mount(viewOf(items), { bulk: 'phone', focus: null });
  try {
    const document = dom.window.document;
    assert.match(text(), /Enriquecer los 3 de una vez/);
    const radios = [...document.querySelectorAll('input[type="radio"]')] as HTMLInputElement[];
    assert.deepEqual(radios.map(radio => radio.checked), [false, true]);
    assert.match(text(), /Solo correo · 3 créditos/);
    assert.match(text(), /Correo y teléfono · 24 créditos/);
    assert.equal(asked.length, 0, 'arriving looks nothing up');
    await press(button('Enriquecer los 3 · 24 créditos')!);
    for (let turn = 0; turn < 8; turn++) await settle();
    assert.deepEqual(asked.map(entry => [entry.action, entry.leadId ?? null, entry.phone ?? null, entry.quiet ?? null]),
      [['enrich', LEAD, true, true], ['enrich', OTHER, true, true], ['enrich', third, true, true], ['ready', null, true, null]]);
    assert.match(text(), /Listo: encontramos el correo de 2 de 3\. Te lo enviamos a tu correo, en la conversación de esta mañana, con cada campaña lista para aprobar\. Sus teléfonos llegan en unos minutos, con el guion de cada llamada\. Sin correo: Raúl Pinto\. Se descontaron 16 créditos de ANTON\.IA\./);
    // One left to look up: the panel for several is gone, and its own card has the step.
    assert.doesNotMatch(text(), /de una vez/);
  } finally { await act(async () => root.unmount()); }
});

test('«Enriquecer los N» with the email alone, stopped by a refusal the next one would get too: what was found is still sent', async () => {
  const items = [contact(LEAD, 'Pedro Araya'), contact(OTHER, 'Luisa Soto')];
  let first = true;
  const asked = server(body => {
    if (body.action === 'enrich' && first) { first = false; return { body: { view: viewOf([{ ...items[0], savedLeadId: 'e-1' }, items[1]]), lookup: { outcome: 'found', email: 'x@y.cl', consumed: 1 } } }; }
    if (body.action === 'enrich') return { status: 409, body: { error: 'Tu equipo no tiene créditos disponibles este mes.' } };
    if (body.action === 'ready') return { body: { view: viewOf([{ ...items[0], savedLeadId: 'e-1' }, items[1]]), mailed: false } };
    return { status: 500, body: { error: 'x' } };
  });
  const root = await mount(viewOf(items), { bulk: 'email', focus: LEAD });
  try {
    assert.deepEqual(([...dom.window.document.querySelectorAll('input[type="radio"]')] as HTMLInputElement[]).map(radio => radio.checked), [true, false]);
    await press(button('Enriquecer los 2 · 2 créditos')!);
    for (let turn = 0; turn < 8; turn++) await settle();
    assert.deepEqual(asked.map(entry => [entry.action, entry.phone ?? null]), [['enrich', null], ['enrich', null], ['ready', null]]);
    assert.match(text(), /Listo: encontramos el correo de 1 de 2\. Revisa aquí cada campaña y apruébala\. Nos detuvimos antes de terminar\. Tu equipo no tiene créditos disponibles este mes\. Se descontó 1 crédito de ANTON\.IA\./);
  } finally { await act(async () => root.unmount()); }
});

test('«Llamar» of the email that brought a mobile: the card opens with «Para llamar» in view and the number is dialled from the page', async () => {
  const withPhone = contact(LEAD, 'Pedro Araya', { savedLeadId: 'e-1', phone: { state: 'found', number: '+56 9 8765 4321', more: 0 } });
  server(() => ({ body: {} }));
  // Without the email's «Llamar», the panel waits closed and nothing is dialled.
  const quiet = await mount(viewOf([withPhone, contact(OTHER, 'Luisa Soto')], { emails: { [LEAD]: 'pedro@mineraandina.cl' } }), { focus: LEAD });
  try { assert.doesNotMatch(text(), /Llamar · WhatsApp · \+56 9 8765 4321/); } finally { await act(async () => quiet.unmount()); }
  const root = await mount(viewOf([withPhone, contact(OTHER, 'Luisa Soto')], { emails: { [LEAD]: 'pedro@mineraandina.cl' } }), { focus: LEAD, call: true });
  try {
    assert.ok(dom.window.document.getElementById(`contacto-${LEAD}`)!.querySelector('a[href="tel:+56987654321"]'), 'its number, to tap again');
  } finally { await act(async () => root.unmount()); }
});

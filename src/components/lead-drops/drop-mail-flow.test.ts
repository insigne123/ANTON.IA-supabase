import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test, { after } from 'node:test';
import ts from 'typescript';
import { JSDOM } from 'jsdom';
import * as leadDrops from '@/lib/lead-drops';
import * as provider from '@/lib/leads-workspace/enrichment-provider';

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
  '@/lib/leads-workspace/enrichment-provider': provider,
  '@/lib/utils': { cn: (...values: unknown[]) => values.filter(Boolean).join(' ') },
};
const card = await compile('./DropContactCard.tsx', shared);
const flow = await compile('./DropMailFlow.tsx', { ...shared, './DropContactCard': card });

const LEAD = '6accdbfcd5f5d80001cf6901', OTHER = '6accdbfcd5f5d80001cf6902';
const contact = (leadId: string, name: string, extra: Record<string, unknown> = {}) => ({ leadId, name, title: 'Gerente HSE', company: 'Minera Andina', domain: null, industry: 'Minería', size: null, city: null,
  hasEmail: true, hasPhone: false, why: 'Calza con tu cliente ideal por su cargo.', research: [], provider: 'apollo',
  draft: { subject: 'Brigadas en faena', body: 'Hola {{nombre}},\n\n¿Cómo cubren los turnos de noche?' }, followUps: [{ day: 3, subject: 'Re: brigadas', body: 'Hola {{nombre}}, ¿lo vemos?' }], ...extra });
const viewOf = (items: unknown[], extra: Record<string, unknown> = {}) => ({ date: '2026-11-13', items, emails: {}, mailbox: null, ...extra });
const text = () => (dom.window.document.body.textContent || '').replace(/\s+/g, ' ');
const button = (label: string | RegExp) => [...dom.window.document.querySelectorAll('button')].find(entry => typeof label === 'string' ? entry.textContent === label : label.test(entry.textContent || ''));
const press = async (target: Element) => { await act(async () => { target.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); }); };
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
    assert.match(text(), /ANTON\.IA\s*Tus contactos de hoy\s*Elegidos para ti el viernes, 13 de noviembre\. 2 por enriquecer\./);
    assert.equal(document.querySelectorAll('article').length, 2);
    assert.equal([...document.querySelectorAll('button')].filter(entry => entry.textContent === 'Enriquecer · 1 crédito').length, 2);
    assert.match(text(), /Busca su correo de trabajo para poder escribirle\./);
    // The contact the email linked to has its campaign in view; the address keeps the link and nothing else.
    assert.ok(document.getElementById(`contacto-${OTHER}`)!.textContent!.includes('Hola Luisa,'));
    assert.ok(!document.getElementById(`contacto-${LEAD}`)!.textContent!.includes('Hola Pedro,'));
    assert.equal(dom.window.location.pathname + dom.window.location.search, `/contactos/${TOKEN}`);
    assert.deepEqual([...document.querySelectorAll('a')].map(link => link.getAttribute('href')), [], 'no way into the app is offered: there is nothing to sign in to');
    assert.equal(asked.length, 0, 'opening the page asks the server for nothing');
    assert.match(text(), /Esta página es personal/);
  } finally { await act(async () => root.unmount()); }
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
    assert.match(document.getElementById(`contacto-${LEAD}`)!.textContent || '', /^Pedro A\./);
    await press(document.querySelector('article button')!);
    await settle();
    assert.deepEqual(asked, [{ url: '/api/lead-drops/link', method: 'POST', token: TOKEN, action: 'enrich', leadId: LEAD }]);
    assert.match(document.querySelector('[role="status"]')!.textContent || '', /^Listo: encontramos el correo de Pedro Araya\. Revisa su campaña y apruébala\. Se descontó 1 crédito de ANTON\.IA\.$/);
    assert.match(document.getElementById(`contacto-${LEAD}`)!.textContent || '', /pedro\.araya@mineraandina\.cl/);
    assert.match(text(), /1 por enriquecer · 1 campaña lista para aprobar\./);
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

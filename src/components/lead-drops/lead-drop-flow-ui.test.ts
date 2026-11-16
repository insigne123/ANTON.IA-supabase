import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import * as chileTime from '@/lib/admin/chile-time';
import * as contactCalls from '@/lib/contact-calls';
import * as leadDropCall from '@/lib/lead-drop-call';
import * as leadDrops from '@/lib/lead-drops';

const require = createRequire(import.meta.url);
async function component(file: string, dependencies: Record<string, unknown>) {
  const source = await readFile(new URL(file, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const exports: any = {};
  new Function('require', 'exports', code)((id: string) => {
    if (id in dependencies) return dependencies[id];
    if (id.startsWith('@/components/ui/')) return new Proxy({}, { get: () => ({ asChild, ...props }: any) => asChild ? props.children : React.createElement('div', props) });
    return require(id);
  }, exports);
  return exports;
}

const shared = {
  '@/components/ui/button': { Button: ({ asChild, variant: _variant, size: _size, ...props }: any) => asChild ? props.children : React.createElement('button', props) },
  'lucide-react': new Proxy({}, { get: () => 'svg' }),
  'next/link': { __esModule: true, default: ({ href, children, ...props }: any) => React.createElement('a', { href, ...props }, children) },
  '@/lib/lead-drops': leadDrops,
  // «Para llamar»: the real rules of the number and of the script; the app's «Llamar» and «WhatsApp» as a line that says what it got.
  '@/lib/contact-calls': contactCalls,
  '@/lib/lead-drop-call': leadDropCall,
  '@/components/contact/ContactActions': { ContactActions: ({ phone, whatsappText, contact }: any) => React.createElement('p', { 'data-contact-actions': contact?.leadId || '', 'data-whatsapp': whatsappText || '' }, `Llamar · WhatsApp · ${phone}`) },
  '@/lib/utils': { cn: (...values: unknown[]) => values.filter(Boolean).join(' ') },
  // The fields of the card as the browser has them, so a test can type in them.
  '@/components/ui/input': { Input: (props: any) => React.createElement('input', props) },
  '@/components/ui/textarea': { Textarea: (props: any) => React.createElement('textarea', props) },
  '@/components/ui/label': { Label: (props: any) => React.createElement('label', props) },
};
// The card's own pieces are the real ones: the app's tabs, the avatar and the stage chip, and the list of several contacts.
const parts: Record<string, unknown> = shared;
parts['@/hooks/use-scroll-edge-fade'] = { useScrollEdgeFade: () => [() => {}, undefined] };
parts['@/components/ui/segmented-tabs'] = await component('../ui/segmented-tabs.tsx', shared);
parts['./drop-contact-parts'] = await component('./drop-contact-parts.tsx', shared);
parts['./DropContactsWorkspace'] = await component('./DropContactsWorkspace.tsx', shared);
parts['./DropBulkEnrich'] = await component('./DropBulkEnrich.tsx', shared);
const callPanel = await component('./DropCallPanel.tsx', shared);
const contactCard = await component('./DropContactCard.tsx', { ...shared, './DropCallPanel': callPanel });
let home: any = null;
const { LeadDropBanner } = await component('../home/LeadDropBanner.tsx', shared);
let answers: Array<{ status: number; body: unknown }> = [];
// What the session knows: the organization, whether it is still being read, and the way to read it again.
let auth: { organizationId: string | null; loading: boolean; refreshOrganization: () => Promise<void> } = { organizationId: 'org-1', loading: false, refreshOrganization: async () => {} };
let gate: Promise<void> | null = null;
const calls: string[] = [];
/** What each POST carried, in order. */
const bodies: any[] = [];
// «Enriquecer y guardar» of an Apollo contact: the saved contact it became and what the lookup found, as the browser sees them.
let savedLeads: any[] = [];
let lookups: Array<{ leads: any[]; lookups: Record<string, string> }> = [];
let completion: any = { moved: [], notFound: [], expired: 0, failures: [], consumed: 0, markedNotFound: true };
// What the person does with the contacts, shared by the drop's page and by «Hoy» (useDropActions), with the browser's part doubled.
const dropActions = await component('./useDropActions.ts', {
  ...shared,
  '@/lib/supabase-service': { supabaseService: { getLeads: async () => savedLeads } },
  '@/lib/leads-workspace/complete-contacts': {
    completeSavedContacts: async (leads: any[], chosen: Record<string, string>) => { lookups.push({ leads, lookups: chosen }); return completion; },
    completionSummary: () => ({ title: 'No encontramos correos', description: 'El proveedor no devolvió resultados para estos contactos.' }),
  },
  '@/lib/leads-workspace/enrichment-provider': { enrichmentCreditReceipt: (consumed: number) => consumed ? `Se descontó ${consumed} crédito de ANTON.IA.` : '' },
});
const { LeadDropFlow } = await component('./LeadDropFlow.tsx', {
  '@/lib/admin/chile-time': chileTime,
  ...shared,
  './DropContactCard': contactCard,
  './DropCallPanel': callPanel,
  './useDropActions': dropActions,
  '@/context/AuthContext': { useAuth: () => auth },
  '@/lib/services/organization-service': { organizationService: { setCurrentOrganization: async (organizationId: string) => { switched.push(organizationId); auth = { ...auth, organizationId }; return true; } } },
  '@/components/page-header': { PageHeader: ({ title, description, back }: any) => React.createElement('header', null,
    back ? React.createElement('a', { href: back.href, 'data-back': '' }, back.label) : null, React.createElement('h1', null, title), React.createElement('p', null, description)) },
  '@/lib/authenticated-api-fetch': { authenticatedApiFetch: async (path: string, init?: RequestInit) => {
    calls.push(`${init?.method || 'GET'} ${path}`);
    if (init?.body) bodies.push(JSON.parse(String(init.body)));
    if (gate) await gate;
    const answer = answers.shift() || { status: 500, body: { error: 'sin respuesta' } };
    return { ok: answer.status < 400, status: answer.status, json: async () => answer.body };
  } },
});

test('«Hoy» shows the contact of the day, offers today\'s, the way back to it, or «Perfil» when there is no customer', () => {
  const render = (data: unknown) => { home = data; return renderToStaticMarkup(React.createElement(LeadDropBanner, { data: home })); };
  assert.equal(render({ drop: null, pull: null }), '');
  assert.match(render({ drop: null, pull: 'first' }), /Contacto del día[\s\S]*href="\/dashboard\/contactos\/nuevo"[^>]*>Ver mi primer contacto/);
  assert.match(render({ drop: null, pull: 'today' }), /Hoy te toca un contacto nuevo[\s\S]*Ver mi contacto de hoy/);
  assert.match(render({ drop: null, pull: 'preparing' }), /Estamos preparando tu contacto de hoy[\s\S]*Ver cómo va/);
  assert.match(render({ drop: null, pull: 'profile' }), /href="\/profile#icp-heading"[^>]*>Completar mi cliente ideal/);
  const one = render({ drop: { id: 'd-1', dropDate: '2026-10-20', total: 1, left: 1, next: { name: 'Ana Pérez', company: 'Ripley', why: 'Gerente de Personas en retail: calza con tu cliente ideal.' } }, pull: null });
  assert.match(one, /Ana Pérez, Ripley[\s\S]*calza con tu cliente ideal\. Ya tiene su correo verificado[\s\S]*href="\/dashboard\/contactos\/d-1"[^>]*>Ver y guardar/);
  assert.match(render({ drop: { id: 'd-1', dropDate: '2026-10-20', total: 5, left: 2 }, pull: null }), /Te faltan guardar 2 de 5/);
});

test('«Hoy» for a team with several contacts a day: no email is promised before it is looked up, and the offers say how many', () => {
  const render = (data: unknown) => { home = data; return renderToStaticMarkup(React.createElement(LeadDropBanner, { data: home })); };
  const several = { id: 'd-6', dropDate: '2026-11-13', total: 6, left: 6, lookup: true, campaigns: true, next: { name: 'Pedro Ar***a', company: 'Minera Andina', why: 'Calza.', lookup: true } };
  const fresh = render({ drop: several, pull: null });
  assert.match(fresh, /6 contactos nuevos para ti, cada uno con su campaña lista\. Ver el correo de cada uno usa 1 crédito\.[\s\S]*href="\/dashboard\/contactos\/d-6"[^>]*>Revisar mis contactos/);
  assert.doesNotMatch(fresh, /correo verificado|no gasta créditos/, 'found with Apollo, its email is still to look up');
  assert.match(render({ drop: { ...several, left: 1 }, pull: null }), /Te queda 1 contacto de 6 por revisar\. Ver el correo de cada uno usa 1 crédito\./);
  assert.match(render({ drop: { ...several, left: 4, campaigns: undefined }, pull: null }), /Te quedan 4 contactos de 6 por revisar/);
  // The offers, with the team's plan: six every working day.
  const plan = { size: 6, days: 5 };
  assert.match(render({ drop: null, pull: 'today', plan }), /Hoy te tocan 6 contactos nuevos, cada uno con por qué te lo recomendamos y su campaña lista\.[\s\S]*href="\/dashboard\/contactos\/nuevo"[^>]*>Ver mis contactos de hoy/);
  assert.match(render({ drop: null, pull: 'first', plan }), /6 contactos nuevos elegidos con tu cliente ideal[\s\S]*Ver mis primeros contactos/);
  assert.match(render({ drop: null, pull: 'preparing', plan }), /Estamos preparando tus 6 contactos de hoy[\s\S]*Ver cómo va/);
  assert.match(render({ drop: null, pull: 'profile', plan }), /Cuéntanos a quién le vendes y cada día hábil te elegimos 6 contactos nuevos\.[\s\S]*Completar mi cliente ideal/);
  assert.match(render({ drop: null, pull: 'profile', plan: { size: 3, days: 2 } }), /y 2 días a la semana te elegimos 3 contactos nuevos/);
  // Without a plan of its own, as always.
  assert.match(render({ drop: null, pull: 'today', plan: { size: 1, days: 3 } }), /Hoy te toca un contacto nuevo/);
});

/** The workspaces the page moved to (organizationService.setCurrentOrganization). */
const switched: string[] = [];
const drop = { id: 'drop-1', date: '2026-10-21', criteria: { titles: ['Gerente de Personas'], industries: ['Retail'], locations: ['Chile'], sizes: [], source: 'perfil' },
  items: [{ leadId: 'lf_1', name: 'Ana Pérez', title: 'Gerente de Personas', company: 'Ripley', domain: null, industry: 'Retail', size: null, city: 'Santiago',
    hasEmail: true, hasPhone: false, why: 'Calza.', research: ['Vende ropa.'], draft: { subject: 'Hola', body: 'Hola Ana' } }] };

async function open(dropId: string, options: { motion?: boolean; played?: boolean; url?: string } = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: options.url || 'https://app.test/dashboard/contactos/nuevo' });
  // Reduced motion by default: once they arrive the contacts show at once, without the playback.
  (dom.window as any).matchMedia = () => ({ matches: !options.motion });
  if (options.played) dom.window.localStorage.setItem('anton:drop-played:drop-1', '1');
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const root = createRoot(dom.window.document.getElementById('root')!);
  await act(async () => root.render(React.createElement(LeadDropFlow, { dropId })));
  const settle = async () => { for (let i = 0; i < 5; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); };
  return { dom, root, settle, text: () => dom.window.document.body.textContent || '' };
}
const previous = { window: globalThis.window, document: globalThis.document };
const close = async ({ dom, root }: { dom: JSDOM; root: ReturnType<typeof createRoot> }) => {
  await act(async () => root.unmount());
  Object.assign(globalThis, { ...previous, IS_REACT_ACT_ENVIRONMENT: false });
  dom.window.close();
};

type Page = { dom: JSDOM; settle: () => Promise<void> };
/** Several contacts are a list at the side («Tus contactos») and one card at a time; a card's sections are tabs. */
const railOf = (page: Page) => [...page.dom.window.document.querySelectorAll('nav[aria-label="Tus contactos"] button')] as HTMLElement[];
const tabOf = (root: ParentNode, label: string) => [...root.querySelectorAll('[role="tab"]')].find(entry => (entry.textContent || '').startsWith(label)) as HTMLElement;
const tap = async (page: Page, target: Element) => { await act(async () => { target.dispatchEvent(new page.dom.window.MouseEvent('click', { bubbles: true })); }); await page.settle(); };

test('opened from «Hoy», today\'s contact is made with its steps in view, then shown with one action at a time', async () => {
  calls.length = 0;
  let release!: () => void;
  gate = new Promise<void>(resolve => { release = resolve; });
  answers = [];
  const page = await open('nuevo');
  try {
    assert.match(page.text(), /Así lo buscamos/);
    assert.match(page.text(), /Buscando personas con tus filtros/);
    assert.match(page.text(), /si sales, te espera en «Hoy»/);
    assert.doesNotMatch(page.text(), /Abriendo tu contacto/);
    answers = [{ status: 200, body: { id: 'drop-1', status: 'ready', reason: null } }, { status: 200, body: drop }];
    release();
    gate = null;
    await page.settle();
    assert.deepEqual(calls, ['POST /api/lead-drops/now', 'GET /api/lead-drops/drop-1']);
    assert.equal(page.dom.window.location.pathname, '/dashboard/contactos/drop-1');
    const document = page.dom.window.document;
    assert.equal(document.querySelector('#drop-results')?.textContent, 'Ana Pérez', 'one contact: their name is the title');
    // The research and the first email in view, and one action: save it, then write to them.
    assert.match(page.text(), /Vende ropa\.[\s\S]*Primer correo sugerido[\s\S]*Hola Ana/);
    assert.deepEqual([...document.querySelectorAll('button')].map(button => button.textContent).filter(text => /Guardar/.test(text || '')), ['Guardar en «Por escribir»']);
    assert.doesNotMatch(page.text(), /Investigación y primer correo|Toma uno o dos minutos/);
    answers = [{ status: 200, body: { saved: 1, expired: 0, items: [{ ...(drop.items[0]), savedLeadId: 'e-1' }] } }];
    const save = [...document.querySelectorAll('button')].find(button => button.textContent === 'Guardar en «Por escribir»')!;
    await act(async () => { save.dispatchEvent(new page.dom.window.MouseEvent('click', { bubbles: true })); });
    await page.settle();
    assert.equal(calls.at(-1), 'POST /api/lead-drops/drop-1');
    assert.match(page.text(), /Quedó en «Por escribir», con su correo\. Para enviarle desde ANTON\.IA, lo investigamos a fondo/);
    // What ANTON.IA sends comes from a full research: «Por escribir» opens it and starts it.
    assert.equal(document.querySelector('a[href="/saved/leads/enriched?investigar=e-1&empezar=1"]')?.textContent, 'Investigar y escribirle');
  } finally { await close(page); }
});

test('without a customer it says so and leads to «Perfil»; not today, without a retry that would answer the same', async () => {
  answers = [{ status: 200, body: { id: null, status: 'empty', reason: { title: 'Falta tu cliente ideal', text: 'Con él elegimos tus contactos.', profile: 'Completar mi cliente ideal' } } }];
  const page = await open('nuevo');
  try {
    await page.settle();
    assert.match(page.text(), /Falta tu cliente ideal/);
    assert.ok(page.dom.window.document.querySelector('a[href="/profile#icp-heading"]'));
    assert.doesNotMatch(page.text(), /Así lo buscamos|Abriendo tu contacto|Reintentar/);
  } finally { await close(page); }
  answers = [{ status: 409, body: { error: 'Tu próximo contacto llega mañana.' } }];
  const later = await open('nuevo');
  try {
    await later.settle();
    assert.match(later.text(), /Hoy no te toca un contacto nuevo/);
    assert.match(later.text(), /Tu próximo contacto llega mañana\./);
    assert.doesNotMatch(later.text(), /Reintentar/);
  } finally { await close(later); }
});

const click = async (page: Awaited<ReturnType<typeof open>>, label: string | RegExp) => {
  const target = [...page.dom.window.document.querySelectorAll('button')].find(button => (typeof label === 'string' ? button.textContent === label : label.test(button.textContent || '')))!;
  await act(async () => { target.dispatchEvent(new page.dom.window.MouseEvent('click', { bubbles: true })); });
};

test('an opened contact is the contact: its own title, the subject named, and «Así lo buscamos» folded below it', async () => {
  answers = [{ status: 200, body: drop }];
  const page = await open('drop-1');
  try {
    await page.settle();
    const document = page.dom.window.document;
    assert.equal(document.querySelector('h1')?.textContent, 'Tu contacto del día', 'not «Buscar prospectos»');
    assert.match(page.text(), /Asunto: Hola/, 'the subject is named, not a loose line above the greeting');
    // The steps and the filters were the story while it played; after, they are one row under the contact.
    assert.doesNotMatch(page.text(), /Buscando personas con tus filtros|Ver ahora/);
    const row = document.querySelector('#drop-filters button')!;
    assert.equal(row.getAttribute('aria-expanded'), 'false');
    assert.match(row.textContent || '', /Así lo buscamos[\s\S]*Gerente de Personas · Retail · Chile/);
    assert.ok(document.querySelector('#drop-results')!.compareDocumentPosition(row) & 4, 'below the contact (DOCUMENT_POSITION_FOLLOWING)');
    assert.equal(document.querySelector('dl'), null, 'the chips stay folded');
    await click(page, /Así lo buscamos/);
    assert.equal(document.querySelector('#drop-filters button')!.getAttribute('aria-expanded'), 'true');
    assert.match(document.querySelector('dl')?.textContent || '', /Cargo[\s\S]*Gerente de Personas[\s\S]*Rubro[\s\S]*Retail[\s\S]*Lugar[\s\S]*Chile/);
    assert.match(page.text(), /Tu cliente ideal, de «Perfil»\. Revisamos que tengan correo verificado/);
  } finally { await close(page); }
  // More than one: the plural title.
  answers = [{ status: 200, body: { ...drop, items: [drop.items[0], { ...drop.items[0], leadId: 'lf_2', name: 'Luis Soto' }] } }];
  const many = await open('drop-1');
  try {
    await many.settle();
    assert.equal(many.dom.window.document.querySelector('h1')?.textContent, 'Tus contactos del día');
    // A screen of «Hoy» (16 Nov 2026, the owner: «que sea una subsección de Hoy»): the way back is «Hoy», not a search.
    const back = many.dom.window.document.querySelector('a[data-back]');
    assert.deepEqual([back?.getAttribute('href'), back?.textContent], ['/dashboard', 'Hoy']);
  } finally { await close(many); }
  // On their own day they are «de hoy», as the menu calls the screen.
  answers = [{ status: 200, body: { ...drop, date: chileTime.dayInZone(new Date()), items: [drop.items[0], { ...drop.items[0], leadId: 'lf_2', name: 'Luis Soto' }] } }];
  const fresh = await open('drop-1');
  try {
    await fresh.settle();
    assert.equal(fresh.dom.window.document.querySelector('h1')?.textContent, 'Tus contactos de hoy');
  } finally { await close(fresh); }
});

test('contacts of another of the person\'s workspaces open by moving there; another account\'s are said as such, with nothing to make', async () => {
  // 16 Nov 2026: the owner opened the email of one account signed in with another, in another workspace. The app loaded, moved,
  // said it found nothing, and its entry left the menu. Whoever belongs to several workspaces meets the first case with their own email.
  switched.length = 0; calls.length = 0;
  let refreshed = 0;
  const before = auth;
  auth = { ...auth, organizationId: 'org-1', refreshOrganization: async () => { refreshed += 1; } };
  answers = [{ status: 409, body: { error: 'Estos contactos son de otro de tus espacios de trabajo.', code: 'other_workspace', organizationId: 'org-2' } }, { status: 200, body: drop }];
  const page = await open('drop-1');
  try {
    await page.settle();
    assert.deepEqual(switched, ['org-2'], 'the app moves to the workspace of those contacts');
    assert.equal(refreshed, 1);
    // The session now says the other workspace: the page reads the contacts again with it (here, on its next render).
    await act(async () => page.root.render(React.createElement(LeadDropFlow, { dropId: 'drop-1' })));
    await page.settle();
    assert.deepEqual(calls.filter(call => call === 'GET /api/lead-drops/drop-1').length, 2);
    assert.match(page.text(), /Ana Pérez/);
    assert.doesNotMatch(page.text(), /otro de tus espacios/);
  } finally { await close(page); auth = before; }
  // Another account's: said, with the way to «Hoy»; never «Ver mi contacto de hoy», which would make one for this account.
  switched.length = 0;
  answers = [{ status: 404, body: { error: 'Estos contactos son de otra cuenta de ANTON.IA, no de la que tienes abierta. Cierra sesión y entra con la cuenta que recibió el correo.', code: 'other_account' } }];
  const other = await open('drop-1');
  try {
    await other.settle();
    assert.match(other.text(), /Estos contactos son de otra cuenta de ANTON\.IA, no de la que tienes abierta\./);
    const links = [...other.dom.window.document.querySelectorAll('a')].map(link => [link.getAttribute('href'), link.textContent]);
    assert.ok(links.some(([href, text]) => href === '/dashboard' && text === 'Ir a Hoy'));
    assert.ok(!links.some(([href]) => href === '/dashboard/contactos/nuevo'), 'no offer to make a contact for the account on screen');
    assert.deepEqual(switched, []);
  } finally { await close(other); }
  // The server tells the two apart only after not finding them for the person, and never shows anything of another account's.
  const route = readFileSync(new URL('../../app/api/lead-drops/[id]/route.ts', import.meta.url), 'utf8');
  assert.match(route, /if \(owner && owner\.userId === user\.id && owner\.organizationId !== organizationId\) return \{ moved: owner\.organizationId \};/);
  assert.match(route, /if \(owner && owner\.userId !== user\.id\) return \{ other: true as const \};/);
  assert.match(route, /code: 'other_workspace', organizationId: drop\.moved \}, \{ status: 409/);
});

test('«Tus contactos de hoy» lives under «Hoy»: its own address, the last contacts from the menu, and the old address still opens them', () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
  assert.equal(leadDrops.dropHref('drop-1'), '/dashboard/contactos/drop-1');
  assert.match(read('../../app/(app)/dashboard/contactos/[id]/page.tsx'), /return <LeadDropFlow key=\{id\} dropId=\{id\} \/>;/);
  // From the menu there is no drop to name: the person's last one, read from «Hoy»'s own answer, in the same screen.
  const latest = read('./LatestDrop.tsx');
  assert.match(latest, /authenticatedApiFetch\('\/api\/lead-drops\/latest'/);
  assert.match(latest, /if \(state && state !== 'error' && state\.id\) return <LeadDropFlow key=\{state\.id\} dropId=\{state\.id\} \/>;/);
  assert.match(latest, /Esta semana no tienes contactos nuevos/);
  assert.match(read('../../app/api/lead-drops/latest/route.ts'), /latestId: latest\?\.id \?\? null/);
  // Emails already sent link to where it lived, under «Buscar prospectos»: the same contacts, with what the link asked for.
  const moved = read('../../app/(app)/search/contactos/[id]/page.tsx');
  assert.match(moved, /redirect\(`\$\{dropHref\(id\)\}\$\{search \? `\?\$\{search\}` : ''\}`\);/);
  assert.doesNotMatch(moved, /LeadDropFlow/);
});

test('the search plays back the first time on this device, and not again when they come back to write to them', async () => {
  answers = [{ status: 200, body: drop }];
  const first = await open('drop-1', { motion: true });
  try {
    await first.settle();
    assert.match(first.text(), /Buscando personas con tus filtros/);
    assert.match(first.text(), /Ver ahora/);
    assert.equal(first.dom.window.localStorage.getItem('anton:drop-played:drop-1'), null, 'not marked while it plays');
    await click(first, 'Ver ahora');
    await first.settle();
    assert.doesNotMatch(first.text(), /Buscando personas con tus filtros/);
    assert.equal(first.dom.window.localStorage.getItem('anton:drop-played:drop-1'), '1', 'seen: it will not wait again');
    assert.match(first.dom.window.document.querySelector('#drop-results')?.textContent || '', /Ana Pérez/);
  } finally { await close(first); }
  answers = [{ status: 200, body: drop }];
  const back = await open('drop-1', { motion: true, played: true });
  try {
    await back.settle();
    assert.doesNotMatch(back.text(), /Buscando personas con tus filtros|Ver ahora/, 'the contact at once');
    assert.equal(back.dom.window.document.querySelector('#drop-results')?.textContent, 'Ana Pérez');
  } finally { await close(back); }
});

test('«Hoy» does not offer to fill in the ideal customer when the next step already leads to «Perfil»', () => {
  const render = (data: unknown, quiet: boolean) => { home = data; return renderToStaticMarkup(React.createElement(LeadDropBanner, { data: home, quietProfile: quiet })); };
  assert.equal(render({ drop: null, pull: 'profile' }, true), '');
  assert.match(render({ drop: null, pull: 'profile' }, false), /Completar mi cliente ideal/);
  assert.match(render({ drop: null, pull: 'first' }, true), /Ver mi primer contacto/, 'the other offers stay');
  assert.match(render({ drop: { id: 'd-1', dropDate: '2026-10-20', total: 1, left: 1, next: { name: 'Ana Pérez', company: 'Ripley', why: 'Calza.' } }, pull: null }, true), /Ver y guardar/, 'and so does a contact that is ready');
});

test('a contact found with Apollo: one credit said before the click, «Enriquecer y guardar» finds its email, and its three follow-ups', async () => {
  const followUps = [{ day: 3, subject: 'Re: ingresos', body: 'Hola Daniel, ¿quién revisa hoy los ingresos?' },
    { day: 7, subject: 'Temporada alta', body: 'Hola Daniel, cuando la nómina llega encima…' }, { day: 11, subject: 'Cierro aquí', body: 'Hola Daniel, es mi último correo.' }];
  const apollo = { ...drop, items: [{ ...drop.items[0], leadId: '6accdbfcd5f5d80001cf6959', name: 'Daniel Ni***o', provider: 'apollo', followUps }] };
  answers = [{ status: 200, body: apollo }];
  calls.length = 0; lookups = [];
  savedLeads = [{ id: 'saved-1', name: 'Daniel Ni***o', email: null, sourceProvider: 'apollo', sourceProviderId: '6accdbfcd5f5d80001cf6959' }];
  completion = { moved: [{ id: 'e-9', email: 'daniel@webclass.cl' }], notFound: [], expired: 0, failures: [], consumed: 1, markedNotFound: true };
  const page = await open('drop-1');
  try {
    await page.settle();
    const document = page.dom.window.document;
    assert.equal(document.querySelector('#drop-results')?.textContent, 'Daniel N.', 'the surname the search hides is not shown with asterisks');
    assert.match(document.querySelector('header')?.textContent || '', /Ver su correo y guardarlo usa 1 crédito\./);
    assert.match(page.text(), /Tiene correo/);
    assert.doesNotMatch(page.text(), /Correo verificado|no gasta créditos/);
    // A page of one contact has «Para llamar» too: its mobile with the email, said with what it costs, and the script of its call.
    assert.ok([...document.querySelectorAll('button')].some(entry => entry.textContent === 'O con su teléfono · 8 créditos'));
    assert.match(page.text(), /Llamada · teléfono y guion/);
    // The follow-ups wait folded under the first email.
    assert.doesNotMatch(page.text(), /Seguimiento 1 · día 3/);
    await click(page, /Si no responde: 3 seguimientos/);
    assert.match(page.text(), /Seguimiento 1 · día 3[\s\S]*Re: ingresos[\s\S]*Seguimiento 3 · día 11[\s\S]*Cierro aquí/);
    // Kept as a saved contact, its email looked up as any saved contact's, then tied to the drop.
    answers = [{ status: 200, body: { keptLeadId: 'saved-1', savedLeadId: null, items: apollo.items.map(item => ({ ...item, keptLeadId: 'saved-1' })) } },
      { status: 200, body: { linked: true, savedLeadId: 'e-9', items: apollo.items.map(item => ({ ...item, keptLeadId: 'saved-1', savedLeadId: 'e-9', name: 'Daniel Nieto' })) } }];
    await click(page, 'Enriquecer y guardar · 1 crédito');
    await page.settle();
    assert.deepEqual(calls.slice(-2), ['POST /api/lead-drops/drop-1', 'POST /api/lead-drops/drop-1']);
    assert.deepEqual(lookups.map(entry => [entry.leads.map(lead => lead.id), entry.lookups]), [[['saved-1'], { 'saved-1': 'email' }]], 'one lookup, of the email only');
    assert.match(page.text(), /Listo: ya tienes su correo y quedó en «Por escribir»\. Se descontó 1 crédito/);
    assert.equal(document.querySelector('#drop-results')?.textContent, 'Daniel Nieto', 'the real name, once looked up');
    assert.match(document.querySelector('header')?.textContent || '', /Ya está en «Por escribir», con su correo\./, 'no credit left to spend');
    assert.equal(document.querySelector('a[href="/saved/leads/enriched?investigar=e-9&empezar=1"]')?.textContent, 'Investigar y escribirle');
  } finally { await close(page); }
  // No email found: it says so, and the contact stays to try again.
  answers = [{ status: 200, body: { ...drop, items: [{ ...drop.items[0], leadId: '6accdbfcd5f5d80001cf6959', name: 'Daniel Ni***o', provider: 'apollo' }] } }];
  completion = { moved: [], notFound: ['saved-1'], expired: 0, failures: [], consumed: 0, markedNotFound: true };
  const missing = await open('drop-1');
  try {
    await missing.settle();
    answers = [{ status: 200, body: { keptLeadId: 'saved-1', savedLeadId: null, items: [] } }, { status: 200, body: { linked: false, savedLeadId: null, items: [{ ...drop.items[0], leadId: '6accdbfcd5f5d80001cf6959', name: 'Daniel Ni***o', provider: 'apollo', keptLeadId: 'saved-1' }] } }];
    await click(missing, 'Enriquecer y guardar · 1 crédito');
    await missing.settle();
    assert.match(missing.text(), /El proveedor no devolvió resultados/);
    assert.ok([...missing.dom.window.document.querySelectorAll('button')].some(button => button.textContent === 'Enriquecer y guardar · 1 crédito'), 'it can be tried again');
  } finally { await close(missing); }
});

test('«Para llamar» in the app: with its mobile the lookup asks for both, and a contact already in «Por escribir» gets its mobile and its script from the server', async () => {
  const LEAD = '6accdbfcd5f5d80001cf6959';
  const contact = { ...drop.items[0], leadId: LEAD, name: 'Daniel Nieto', provider: 'apollo' };
  const two = { ...drop, items: [contact, { ...contact, leadId: '6accdbfcd5f5d80001cf6960', name: 'Carla Soto' }] };
  answers = [{ status: 200, body: two }];
  calls.length = 0; bodies.length = 0; lookups = [];
  savedLeads = [{ id: 'saved-1', name: 'Daniel Nieto', email: null, sourceProvider: 'apollo', sourceProviderId: LEAD }];
  completion = { moved: [{ id: 'e-9', email: 'daniel@webclass.cl', enrichmentStatus: 'pending_phone' }], notFound: [], expired: 0, failures: [], consumed: 8, markedNotFound: true };
  const page = await open('drop-1');
  try {
    await page.settle();
    const waiting = two.items.map((item, index) => index ? item : { ...item, keptLeadId: 'saved-1', savedLeadId: 'e-9', phone: { state: 'pending' } });
    answers = [{ status: 200, body: { keptLeadId: 'saved-1', savedLeadId: null, items: two.items.map((item, index) => index ? item : { ...item, keptLeadId: 'saved-1' }) } },
      { status: 200, body: { linked: true, savedLeadId: 'e-9', items: waiting } }];
    await click(page, 'O con su teléfono · 8 créditos');
    await page.settle();
    assert.deepEqual(lookups.map(entry => entry.lookups), [{ 'saved-1': 'email_phone' }], 'one lookup, of the email and the mobile');
    assert.match(page.text(), /Listo: ya tienes su correo y quedó en «Por escribir»\. Su teléfono llega en unos minutos: lo verás en «Llamada»\. Se descontó 8 crédito/);
  } finally { await close(page); }
  // A contact looked up before, without its mobile: asked from its card, to the server, with what it costs said first.
  const saved = two.items.map((item, index) => index ? { ...item, savedLeadId: 'e-10', phone: { state: 'none', missed: false } } : { ...item, savedLeadId: 'e-9', phone: { state: 'pending' } });
  answers = [{ status: 200, body: { ...two, items: saved } }];
  const again = await open('drop-1');
  try {
    await again.settle();
    // The call is a section of each card («Llamada»): the first one's mobile is on its way, the second's is still to ask.
    await tap(again, tabOf(again.dom.window.document, 'Llamada'));
    assert.match(again.dom.window.document.querySelector('article [role="status"]')?.textContent || '', /Buscando su teléfono/, 'the first one\'s mobile is on its way');
    await tap(again, railOf(again)[1]);
    assert.match(again.dom.window.document.querySelector('article')!.textContent || '', /Carla Soto/);
    await tap(again, tabOf(again.dom.window.document, 'Llamada'));
    bodies.length = 0;
    answers = [{ status: 200, body: { phone: { outcome: 'pending', consumed: 8 }, items: saved.map((item, index) => index ? { ...item, phone: { state: 'pending' } } : item) } }];
    await click(again, 'Buscar su teléfono · 8 créditos');
    await again.settle();
    assert.deepEqual(bodies, [{ action: 'phone', leadId: '6accdbfcd5f5d80001cf6960' }]);
    assert.match(again.text(), /Buscando el teléfono de Carla Soto: suele tardar unos minutos y aparece solo en «Llamada»\. Usa 8 créditos\./);
    bodies.length = 0;
    answers = [{ status: 200, body: { items: saved } }];
    await click(again, 'Preparar guion de llamada');
    await again.settle();
    assert.deepEqual(bodies, [{ action: 'script', leadId: '6accdbfcd5f5d80001cf6960' }]);
  } finally { await close(again); }
});

test('a contact that is not theirs or is gone leads to today\'s, without a retry that would answer the same', async () => {
  calls.length = 0;
  answers = [{ status: 404, body: { error: 'No encontramos esos contactos.' } }];
  const page = await open('drop-de-otro');
  try {
    await page.settle();
    assert.match(page.text(), /No encontramos esos contactos\./);
    assert.doesNotMatch(page.text(), /Reintentar/);
    const link = [...page.dom.window.document.querySelectorAll('a')].find(a => /Ver mi contacto de hoy/.test(a.textContent || ''));
    assert.equal(link?.getAttribute('href'), '/dashboard/contactos/nuevo');
  } finally { await close(page); }
});

test('a failed read keeps «Reintentar»; without the organization the page says so and reads it again', async () => {
  calls.length = 0;
  answers = [{ status: 500, body: { error: 'No pudimos abrir tu contacto.' } }];
  const failed = await open('drop-1');
  try {
    await failed.settle();
    assert.match(failed.text(), /No pudimos abrir tu contacto\.[\s\S]*Reintentar/);
    assert.doesNotMatch(failed.text(), /Ver mi contacto de hoy/);
  } finally { await close(failed); }

  calls.length = 0;
  let refreshed = 0;
  auth = { organizationId: null, loading: true, refreshOrganization: async () => { refreshed += 1; } };
  const reading = await open('nuevo');
  try {
    // While the session is still reading the organization nothing is wrong yet.
    assert.doesNotMatch(reading.text(), /No pudimos cargar tu organización/);
  } finally { await close(reading); }
  auth = { ...auth, loading: false };
  for (const dropId of ['nuevo', 'drop-1']) {
    const page = await open(dropId);
    try {
      await page.settle();
      assert.match(page.text(), /No pudimos cargar tu organización\. Revisa tu conexión y vuelve a intentarlo\./);
      assert.doesNotMatch(page.text(), /Abriendo tu contacto|Buscando personas con tus filtros/);
      const retry = [...page.dom.window.document.querySelectorAll('button')].find(b => /Reintentar/.test(b.textContent || ''));
      await act(async () => { retry!.click(); });
    } finally { await close(page); }
  }
  assert.equal(refreshed, 2);
  assert.deepEqual(calls, []);
  auth = { organizationId: 'org-1', loading: false, refreshOrganization: async () => {} };
});

// ─── Several contacts: a card each, to review and act on (DropContactCard) ───────────────────────────────────────────

const followUps = [{ day: 3, subject: 'Re: brigadas', body: 'Hola {{nombre}}, ¿lo vemos?' }, { day: 7, subject: 'Planes de emergencia', body: 'Hola {{nombre}}, otra idea.' }];
const apolloItem = (n: number, extra: Record<string, unknown> = {}) => ({ ...drop.items[0], leadId: `6accdbfcd5f5d80001cf69${String(n).padStart(2, '0')}`, name: `Persona${n} Ap***${n}`, company: `Minera ${n}`,
  provider: 'apollo', research: [], draft: { subject: 'Brigadas en faena', body: 'Hola {{nombre}},\n\n¿Cómo cubren los turnos de noche?' }, followUps,
  reasons: ['Su cargo decide la contratación de brigadas.'], fit: [{ criterion: 'Cargo', theirs: 'Gerente HSE', wanted: 'Gerente HSE', match: 'yes' }], ...extra });
const brief = { company: 'Produce cobre en dos faenas del norte.', news: { text: 'Anunció una planta concentradora nueva.', date: '3 nov 2026', source: 'Diario Financiero', url: 'https://diario.example/planta' },
  fit: 'Una planta nueva suma áreas que proteger.', role: 'Responde por la seguridad de las faenas.', opener: 'Pregúntale cómo cubrirán la planta nueva.' };
const several = () => ({ ...drop, items: [apolloItem(1, { brief }), apolloItem(2, { track: 'explore', savedLeadId: 'e-2', name: 'Luisa Soto' })] });
const cardOf = (page: Awaited<ReturnType<typeof open>>, index: number) => page.dom.window.document.querySelectorAll('article')[index] as HTMLElement;
const within = (root: HTMLElement, label: string | RegExp) => [...root.querySelectorAll('button')].find(button => (typeof label === 'string' ? button.textContent === label : label.test(button.textContent || '')))!;
/**
 * Typing into a field. This suite opens a new window for each page, after React was loaded without one, so React reads text fields
 * the old way (no «input» event) and a dispatched one never reaches `onChange`: the handler React keeps on the node is called instead.
 */
const type = async (page: Awaited<ReturnType<typeof open>>, field: HTMLTextAreaElement, value: string) => {
  const props = (field as unknown as Record<string, { onChange: (event: { target: { value: string } }) => void }>)[Object.keys(field).find(key => key.startsWith('__reactProps$'))!];
  await act(async () => { props.onChange({ target: { value } }); });
  await page.settle();
};
const press = async (page: Awaited<ReturnType<typeof open>>, target: Element) => { await act(async () => { target.dispatchEvent(new page.dom.window.MouseEvent('click', { bubbles: true })); }); await page.settle(); };

test('several contacts: a list at the side and one card at a time, with why, the company and how to open, its campaign and its call each in a section', async () => {
  answers = [{ status: 200, body: several() }];
  const page = await open('drop-1');
  try {
    await page.settle();
    // The list is the map: who they are and where each stands. The card is the work: one contact, the one that still needs a step.
    assert.deepEqual(railOf(page).map(entry => [entry.textContent, entry.getAttribute('aria-current')]),
      [['PAPor enriquecerPersona1 A.Gerente de Personas · Minera 1Por enriquecer', 'true'], ['LSCampaña por aprobarLuisa SotoGerente de Personas · Minera 2Campaña por aprobar', null]]);
    assert.equal(page.dom.window.document.querySelectorAll('article').length, 1);
    const first = cardOf(page, 0);
    assert.match(first.textContent || '', /^PAPersona1 A\.Por enriquecer/);
    assert.deepEqual([...first.querySelectorAll('[role="tab"]')].map(entry => [entry.textContent, entry.getAttribute('aria-selected')]), [['Por qué', 'true'], ['Campaña3', 'false'], ['Llamada', 'false']]);
    // «Por qué»: how to open first, then the reasons next to the company, and how it fits the ideal customer in view.
    assert.match(first.textContent || '', /Cómo abrirPregúntale cómo cubrirán la planta nueva\.Por qué te lo recomendamosUna planta nueva suma áreas que proteger\.Responde por la seguridad de las faenas\.Su cargo decide/);
    assert.match(first.textContent || '', /Sobre Minera 1Produce cobre en dos faenas del norte\.Ahora: Anunció una planta concentradora nueva\.Diario Financiero, 3 nov 2026/);
    assert.equal(first.querySelector('a[href="https://diario.example/planta"]')?.getAttribute('rel'), 'noopener noreferrer');
    assert.match(first.textContent || '', /Cómo calza con tu cliente ideal[\s\S]*Cargo[\s\S]*Calza[\s\S]*Buscas: Gerente HSE/);
    // Without its email yet: the step is to look it up.
    assert.ok(within(first, 'Enriquecer · 1 crédito'));
    assert.equal(within(first, 'Aprobar y programar'), undefined);
    // The campaign is its own section: three emails, one read at a time, with the day each would go.
    assert.doesNotMatch(first.textContent || '', /¿Cómo cubren los turnos de noche\?/);
    await tap(page, tabOf(first, 'Campaña'));
    assert.match(first.textContent || '', /1Primer correo[\s\S]*2Seguimiento 1[\s\S]* · si no responde3Seguimiento 2[\s\S]*Asunto: Brigadas en faena[\s\S]*¿Cómo cubren los turnos de noche\?/);
    assert.doesNotMatch(first.textContent || '', /Cómo abrir|Sobre Minera 1|¿lo vemos\?/, 'one section, and one email, at a time');
    await tap(page, [...first.querySelectorAll('ol[aria-label="Correos de la campaña"] button')][1]);
    assert.match(first.textContent || '', /Asunto: Re: brigadas[\s\S]*Hola Persona1, ¿lo vemos\?/);
    // Another contact is a tap on the list away. With its email already, its step is to approve its campaign.
    await tap(page, railOf(page)[1]);
    assert.deepEqual(railOf(page).map(entry => entry.getAttribute('aria-current')), [null, 'true']);
    const second = cardOf(page, 0);
    assert.ok(within(second, 'Aprobar y programar'));
    assert.match(second.textContent || '', /^LSLuisa SotoCampaña por aprobarPara explorar[\s\S]*Sale desde tu Gmail u Outlook\. Se detiene si responde\./);
  } finally { await close(page); }
});

test('the search by company on screen: why that company, the industry next to theirs said as such, and how it was searched', async () => {
  answers = [{ status: 200, body: { ...drop, criteria: { ...drop.criteria, accounts: { fit: 84, opened: 12, expanded: ['Construcción'] } },
    items: [apolloItem(1, { companyWhy: 'Opera dos faenas con brigadas propias.', expanded: 'Construcción' }), apolloItem(2, { brief, companyWhy: 'Ya lo dice la investigación.' })] } }];
  const page = await open('drop-1');
  try {
    await page.settle();
    const first = cardOf(page, 0);
    assert.match(first.textContent || '', /^PAPersona1 A\.Por enriquecerRubro vecino/);
    assert.match(first.textContent || '', /Sobre Minera 1Por qué esta empresa: Opera dos faenas con brigadas propias\./);
    await click(page, /Así los buscamos/);
    assert.match(page.text(), /Buscamos por empresa: 84 empresas calzan con lo que vendes y hoy abrimos 12 para traer a su gente, no solo a quien tiene el cargo exacto\. De tus rubros ya te mostramos a casi todos, así que sumamos un rubro vecino: Construcción\./);
    // The research of the contact already says why the company: the finder's line is not repeated.
    await tap(page, railOf(page)[1]);
    assert.match(cardOf(page, 0).textContent || '', /Una planta nueva suma áreas que proteger\./);
    assert.doesNotMatch(cardOf(page, 0).textContent || '', /Por qué esta empresa|Rubro vecino/);
  } finally { await close(page); }
});

test('«Aprobar y programar» starts the contact\'s campaign and says from which mailbox and when each email goes', async () => {
  bodies.length = 0;
  answers = [{ status: 200, body: several() }];
  const page = await open('drop-1');
  try {
    await page.settle();
    const campaign = { id: '11111111-1111-4111-8111-111111111111', provider: 'google', approvedAt: '2026-11-13T12:00:00.000Z' };
    answers = [{ status: 200, body: { items: several().items.map((item, index) => index === 1 ? { ...item, campaign } : item), campaign, provider: 'Gmail', schedule: ['2026-11-13', '2026-11-16', '2026-11-20'] } }];
    await tap(page, railOf(page)[1]);
    await press(page, within(cardOf(page, 0), 'Aprobar y programar'));
    assert.deepEqual(bodies.at(-1), { action: 'approve', leadId: '6accdbfcd5f5d80001cf6902' });
    assert.match(page.text(), /Campaña de Luisa Soto programada desde Gmail: el primer correo sale en unos minutos y los seguimientos el lun 16 nov y el vie 20 nov\. Se detiene si responde\./);
    // It stays on screen, now going; the list says so too.
    const second = cardOf(page, 0);
    assert.match(second.textContent || '', /^LSLuisa SotoCampaña en curso/);
    assert.match(railOf(page)[1].textContent || '', /Campaña en curso$/);
    assert.equal(second.querySelector('a[href="/campaigns?campaign=11111111-1111-4111-8111-111111111111"]')?.textContent, 'Ver la campaña');
    assert.equal(within(second, 'Aprobar y programar'), undefined);
    await tap(page, tabOf(second, 'Su campaña'));
    assert.match(second.textContent || '', /La campaña ya está en curso: para cambiar sus correos o pausarla, ábrela en «Campañas»\./);
    assert.equal(within(second, 'Editar los correos'), undefined);
    // What the campaign refuses is said as it says it.
    answers = [{ status: 409, body: { error: 'Primero enriquece el contacto: necesitamos su correo para programar la campaña.' } }];
  } finally { await close(page); }
});

test('the emails are changed in place, and «No me sirve» asks why', async () => {
  bodies.length = 0;
  answers = [{ status: 200, body: several() }];
  const page = await open('drop-1');
  try {
    await page.settle();
    const first = cardOf(page, 0);
    await tap(page, tabOf(first, 'Campaña'));
    await press(page, within(first, 'Editar los correos'));
    const subject = first.querySelector('input') as HTMLInputElement;
    assert.equal(subject.value, 'Brigadas en faena');
    assert.equal(first.querySelectorAll('textarea').length, 3, 'the first email and both follow-ups');
    // Typing is tried in drop-contact-card.test.ts (this file loads React before there is a page, so it hears no typing): here, what is sent and shown.
    const edited = several().items.map((item, index) => index === 0 ? { ...item, edited: true, draft: { ...item.draft, subject: 'Turnos de noche en faena' } } : item);
    answers = [{ status: 200, body: { items: edited } }];
    await act(async () => { first.querySelector('form')!.dispatchEvent(new page.dom.window.Event('submit', { bubbles: true, cancelable: true })); });
    await page.settle();
    assert.equal(bodies.at(-1).action, 'edit');
    assert.deepEqual(bodies.at(-1).emails.draft, { subject: 'Brigadas en faena', body: 'Hola {{nombre}},\n\n¿Cómo cubren los turnos de noche?' });
    assert.deepEqual(bodies.at(-1).emails.followUps.map((step: any) => Object.keys(step)), [['subject', 'body'], ['subject', 'body']], 'the days are not the person\'s to change');
    assert.match(page.text(), /Guardamos tus cambios en los correos de Persona1 A\./);
    assert.match(cardOf(page, 0).textContent || '', /Asunto: Turnos de noche en faena/);
    assert.equal(cardOf(page, 0).querySelector('form'), null);

    // «No me sirve» asks why, in one click.
    await press(page, within(cardOf(page, 0), 'No me sirve'));
    assert.ok(within(cardOf(page, 0), 'El cargo no decide'));
    answers = [{ status: 200, body: { items: edited.map((item, index) => index === 0 ? { ...item, feedback: { useful: false, reason: 'El cargo no decide', at: '2026-11-13T12:00:00Z' } } : item) } }];
    await press(page, within(cardOf(page, 0), 'El cargo no decide'));
    assert.deepEqual(bodies.at(-1), { action: 'feedback', leadId: '6accdbfcd5f5d80001cf6901', feedback: { useful: false, reason: 'El cargo no decide' } });
    assert.match(cardOf(page, 0).textContent || '', /Dijiste que no te sirve \(el cargo no decide\): lo tendremos en cuenta\./);
    // Once they answered, they can say what they would like to get, in their words (16 Nov 2026): the finder reads it for them.
    await press(page, within(cardOf(page, 0), 'Decir qué te gustaría recibir'));
    const field = cardOf(page, 0).querySelector('textarea[id$="-wish"]') as HTMLTextAreaElement;
    assert.equal(cardOf(page, 0).querySelector(`label[for="${field.id}"]`)?.textContent, '¿Qué te gustaría que te apareciera?');
    // The field's own «Guardar», not the one of the card.
    const wishBox = field.parentElement as HTMLElement;
    assert.equal((within(wishBox, 'Guardar') as HTMLButtonElement).disabled, true, 'nothing to save yet');
    await type(page, field, 'Jefaturas de operaciones, no proveedores');
    answers = [{ status: 200, body: { items: edited.map((item, index) => index === 0
      ? { ...item, feedback: { useful: false, reason: 'El cargo no decide', wish: 'Jefaturas de operaciones, no proveedores', at: '2026-11-13T12:00:00Z' } } : item) } }];
    await press(page, within(wishBox, 'Guardar'));
    assert.deepEqual(bodies.at(-1), { action: 'feedback', leadId: '6accdbfcd5f5d80001cf6901',
      feedback: { useful: false, reason: 'El cargo no decide', wish: 'Jefaturas de operaciones, no proveedores' } });
    assert.match(cardOf(page, 0).textContent || '', /Pediste: «Jefaturas de operaciones, no proveedores»\. Lo usamos para elegir tus próximos contactos\./);
    assert.ok(within(cardOf(page, 0), 'Cambiar lo que pediste'));
    assert.equal(cardOf(page, 0).querySelector('textarea[id$="-wish"]'), null, 'the field closes once saved');
    answers = [{ status: 200, body: { items: edited } }];
    await tap(page, railOf(page)[1]);
    await press(page, within(cardOf(page, 0), 'Me sirve'));
    assert.deepEqual(bodies.at(-1), { action: 'feedback', leadId: '6accdbfcd5f5d80001cf6902', feedback: { useful: true, reason: null } });
  } finally { await close(page); }
});

test('opened from the morning email on one contact: its email is looked up at once, and the address forgets the request', async () => {
  bodies.length = 0; lookups = []; savedLeads = [{ id: 'saved-1' }];
  completion = { moved: [{ id: 'saved-1', email: 'p1@minera1.cl' }], notFound: [], expired: 0, failures: [], consumed: 1, markedNotFound: true };
  const linkedItems = several().items.map((item, index) => index === 0 ? { ...item, savedLeadId: 'e-1', name: 'Pedro Araya' } : item);
  answers = [{ status: 200, body: several() }, { status: 200, body: { keptLeadId: 'saved-1', savedLeadId: null, items: several().items } }, { status: 200, body: { linked: true, savedLeadId: 'e-1', items: linkedItems } }];
  const page = await open('drop-1', { url: 'https://app.test/dashboard/contactos/drop-1?c=6accdbfcd5f5d80001cf6901&enriquecer=1' });
  try {
    await page.settle();
    await page.settle();
    assert.deepEqual(bodies.slice(0, 2), [{ action: 'keep', leadId: '6accdbfcd5f5d80001cf6901' }, { action: 'link', leadId: '6accdbfcd5f5d80001cf6901' }]);
    assert.equal(lookups.length, 1, 'one lookup, for the contact the email named');
    assert.equal(page.dom.window.location.search, '', 'coming back to this address does not ask again');
    assert.match(page.text(), /Listo: ya tienes su correo y quedó en «Por escribir»\. Se descontó 1 crédito de ANTON\.IA\./);
    // The contact the email named opens on its campaign, now ready to approve.
    assert.match(cardOf(page, 0).textContent || '', /Pedro Araya[\s\S]*¿Cómo cubren los turnos de noche\?/);
    assert.ok(within(cardOf(page, 0), 'Aprobar y programar'));
  } finally { await close(page); }
  // A link without the request only brings the contact into view.
  bodies.length = 0;
  answers = [{ status: 200, body: several() }];
  const plain = await open('drop-1', { url: 'https://app.test/dashboard/contactos/drop-1?c=6accdbfcd5f5d80001cf6901' });
  try {
    await plain.settle();
    assert.equal(bodies.length, 0);
    assert.equal(plain.dom.window.location.search, '');
  } finally { await close(plain); }
});

// Since 16 Nov 2026 every button of the emails lands here, inside the app (src/app/contactos/[token] only redirects): what the
// email's own page did, the app does.
test('«Enriquecer los N» of the morning email lands inside the app: the choice arrives made, the button confirms it, and the answer also goes to the inbox', async () => {
  const items = [apolloItem(1), apolloItem(2), apolloItem(3, { name: 'Raúl Pinto' })];
  const saved = new Set<string>();
  const now = () => items.map(item => saved.has(item.leadId) ? { ...item, savedLeadId: `e-${item.leadId.slice(-2)}` } : item);
  bodies.length = 0;
  answers = [{ status: 200, body: { ...drop, items } }];
  const page = await open('drop-1', { url: 'https://app.test/dashboard/contactos/drop-1?todos=telefono' });
  try {
    await page.settle();
    const document = page.dom.window.document;
    assert.match(page.text(), /Enriquecer los 3 de una vez/);
    assert.deepEqual(([...document.querySelectorAll('input[type="radio"]')] as HTMLInputElement[]).map(radio => radio.checked), [false, true], '«Con sus teléfonos» arrives chosen');
    assert.equal(page.dom.window.location.search, '', 'coming back to this address does not ask again');
    assert.equal(bodies.length, 0, 'arriving looks nothing up');
    // Two are found, the third has no email anywhere; then the one answer for all of them.
    saved.add(items[0].leadId); const first = now();
    saved.add(items[1].leadId); const second = now();
    answers = [{ status: 200, body: { lookup: { outcome: 'found', consumed: 8 }, items: first } }, { status: 200, body: { lookup: { outcome: 'found', consumed: 8 }, items: second } },
      { status: 200, body: { lookup: { outcome: 'not_found', consumed: 0 }, items: second } }, { status: 200, body: { mailed: true, items: second } }];
    await click(page, 'Enriquecer los 3 · 24 créditos');
    for (let turn = 0; turn < 4; turn++) await page.settle();
    assert.deepEqual(bodies.map(body => [body.action, body.leadId ?? null, body.phone ?? null]),
      [['enrich', items[0].leadId, true], ['enrich', items[1].leadId, true], ['enrich', items[2].leadId, true], ['ready', null, true]]);
    assert.match(page.text(), /Listo: encontramos el correo de 2 de 3 y quedaron en «Por escribir»\. También te los enviamos a tu correo, con cada campaña lista para aprobar\. Sus teléfonos llegan en unos minutos: los verás en «Llamada», con el guion de cada llamada\. Sin correo: Raúl Pinto\. Se descontó 16 crédito/);
    // One left to look up: the band for several is gone, and the list says where each stands.
    assert.doesNotMatch(page.text(), /de una vez/);
    assert.deepEqual(railOf(page).map(entry => /Campaña por aprobar$/.test(entry.textContent || '')), [true, true, false]);
  } finally { await close(page); }

  // A refusal the next one would get too stops it there, and says why; nothing is sent to the inbox without a contact found.
  bodies.length = 0;
  answers = [{ status: 200, body: { ...drop, items } }];
  const refused = await open('drop-1', { url: 'https://app.test/dashboard/contactos/drop-1?todos=correo' });
  try {
    await refused.settle();
    assert.deepEqual(([...refused.dom.window.document.querySelectorAll('input[type="radio"]')] as HTMLInputElement[]).map(radio => radio.checked), [true, false]);
    answers = [{ status: 409, body: { error: 'Tu equipo no tiene créditos disponibles este mes.' } }];
    await click(refused, 'Enriquecer los 3 · 3 créditos');
    for (let turn = 0; turn < 3; turn++) await refused.settle();
    assert.deepEqual(bodies.map(body => body.action), ['enrich']);
    assert.match(refused.text(), /Nos detuvimos antes de terminar\. Tu equipo no tiene créditos disponibles este mes\./);
  } finally { await close(refused); }
});

test('«Llamar» of the email that brought a mobile lands inside the app, on that contact\'s call', async () => {
  const items = [apolloItem(1), apolloItem(2, { savedLeadId: 'e-2', name: 'Luisa Soto', phone: { state: 'found', number: '+56 9 8765 4321', more: 0 } })];
  bodies.length = 0;
  answers = [{ status: 200, body: { ...drop, items } }];
  const page = await open('drop-1', { url: `https://app.test/dashboard/contactos/drop-1?c=${items[1].leadId}&llamar=1` });
  try {
    await page.settle();
    const document = page.dom.window.document;
    assert.match(cardOf(page, 0).textContent || '', /^LSLuisa Soto/);
    assert.equal(tabOf(document, 'Llamada').getAttribute('aria-selected'), 'true');
    assert.match(document.querySelector('[data-contact-actions]')?.textContent || '', /Llamar · WhatsApp · \+56 9 8765 4321/);
    assert.equal(page.dom.window.location.search, '');
    assert.equal(bodies.length, 0, 'arriving asks the server for nothing');
  } finally { await close(page); }
});

// «Tus contactos de hoy», the section of «Hoy» for a drop of several contacts, with the same doubles as the drop's own page.
const todayContacts = await component('../home/TodayContacts.tsx', {
  ...shared,
  '@/components/lead-drops/DropContactCard': contactCard,
  '@/components/lead-drops/useDropActions': dropActions,
  '@/lib/admin/chile-time': chileTime,
  '@/context/AuthContext': { useAuth: () => auth },
  '@/lib/authenticated-api-fetch': { authenticatedApiFetch: async (path: string, init?: RequestInit) => {
    calls.push(`${init?.method || 'GET'} ${path}`);
    if (init?.body) bodies.push(JSON.parse(String(init.body)));
    const answer = answers.shift() || { status: 500, body: { error: 'sin respuesta' } };
    return { ok: answer.status < 400, status: answer.status, json: async () => answer.body };
  } },
});
/** A link as an email carries it: 36 bytes, the first 16 the drop's id (server/lead-drop-link.ts). Unsigned: the app never checks it. */
const BOARD = '11111111-1111-4111-8111-111111111111';
const linkOf = (dropId: string) => Buffer.concat([Buffer.from(dropId.replace(/-/g, ''), 'hex'), Buffer.alloc(20, 7)]).toString('base64url');
async function openHoy(board: unknown, url = 'https://app.test/dashboard') {
  const dom = new JSDOM('<div id="root"></div>', { url });
  (dom.window as any).matchMedia = () => ({ matches: true });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const root = createRoot(dom.window.document.getElementById('root')!);
  await act(async () => root.render(React.createElement(todayContacts.TodayContacts, { board, ready: true })));
  const settle = async () => { for (let i = 0; i < 5; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); };
  return { dom, root, settle, text: () => dom.window.document.body.textContent || '' };
}

test('«Hoy» shows several contacts as a section of its own: where each stands, one line of why, and its next step', async () => {
  const today = chileTime.dayInZone(new Date());
  const campaign = { id: '22222222-2222-4222-8222-222222222222', provider: 'google', approvedAt: `${today}T12:00:00.000Z` };
  const items = [apolloItem(1, { brief }), apolloItem(2, { savedLeadId: 'e-2', name: 'Luisa Soto' }), apolloItem(3, { savedLeadId: 'e-3', name: 'Marta Rojas', campaign })];
  const page = await openHoy({ id: BOARD, date: today, items });
  try {
    const section = page.dom.window.document.querySelector('section#contactos-de-hoy')!;
    assert.match(section.textContent || '', /Tus contactos de hoy[\s\S]*3 contactos nuevos para ti[\s\S]*Enriquece los que te interesen y aprueba su campaña/);
    assert.deepEqual([...section.querySelector('dl')!.children].map(entry => entry.textContent), ['Por enriquecer1', 'Por aprobar1', 'En marcha1']);
    assert.equal(section.querySelectorAll('article').length, 3);
    // A row, not the whole card: who, one line of why and the step. The rest opens in place.
    const first = cardOf(page, 0);
    assert.match(first.textContent || '', /Persona1 A\.[\s\S]*Una planta nueva suma áreas que proteger\./);
    assert.doesNotMatch(first.textContent || '', /Sobre Minera 1|Cómo abrir|¿Te sirve este contacto\?/);
    assert.ok(within(first, 'Enriquecer · 1 crédito'));
    assert.ok(within(cardOf(page, 1), 'Aprobar y programar'));
    assert.equal(cardOf(page, 2).querySelector('a[href="/campaigns?campaign=22222222-2222-4222-8222-222222222222"]')?.textContent, 'Ver la campaña');
    const toggle = within(first, /Ver por qué y su campaña/);
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    await press(page, toggle);
    assert.equal(within(first, /Ocultar el detalle/).getAttribute('aria-expanded'), 'true');
    // Open, the row is the same card as everywhere: its sections as tabs, «Por qué» first.
    assert.match(first.textContent || '', /Por quéCampaña3Llamada[\s\S]*Cómo abrir[\s\S]*Por qué te lo recomendamos[\s\S]*Sobre Minera 1[\s\S]*¿Te sirve este contacto\?/);
    assert.ok(first.querySelector(`#${toggle.getAttribute('aria-controls')!.replace(/:/g, '\\:')}`), 'the button names what it opens');
    assert.equal(section.querySelector(`a[href="/dashboard/contactos/${BOARD}"]`)?.textContent, 'Ver cómo los buscamos y descargar el PDF');

    // «Aprobar y programar» right there: the counts move and what happened is said.
    bodies.length = 0;
    answers = [{ status: 200, body: { items: items.map((item, index) => index === 1 ? { ...item, campaign } : item), campaign, provider: 'Gmail', schedule: ['2026-11-13', '2026-11-16'] } }];
    await press(page, within(cardOf(page, 1), 'Aprobar y programar'));
    assert.deepEqual(bodies.at(-1), { action: 'approve', leadId: '6accdbfcd5f5d80001cf6902' });
    assert.equal(calls.at(-1), `POST /api/lead-drops/${BOARD}`);
    // Said in the row it happened to, where the person is looking: not at the top of a section of six.
    assert.match(page.dom.window.document.getElementById('contacto-6accdbfcd5f5d80001cf6902')!.querySelector('[role="status"]')?.textContent || '', /Campaña de Luisa Soto programada desde Gmail/);
    assert.equal(section.querySelectorAll('[role="status"], [role="alert"]').length, 1);
    // What the campaign refuses is said there too, as it says it.
    answers = [{ status: 409, body: { error: 'Conecta tu Gmail u Outlook para programar la campaña.' } }];
    await press(page, within(cardOf(page, 0), 'Enriquecer · 1 crédito'));
    assert.equal(page.dom.window.document.getElementById('contacto-6accdbfcd5f5d80001cf6901')!.querySelector('[role="alert"]')?.textContent, 'Conecta tu Gmail u Outlook para programar la campaña.');
    assert.deepEqual([...section.querySelector('dl')!.children].map(entry => entry.textContent), ['Por enriquecer1', 'Por aprobar0', 'En marcha2']);
  } finally { await close(page); }

  // All approved: it says so. An earlier day's, with something left: how many are left, and which day they are of.
  const done = await openHoy({ id: BOARD, date: today, items: items.map(item => ({ ...item, savedLeadId: 'e-9', campaign })) });
  try { assert.match(done.text(), /Tus 3 campañas ya están en marcha[\s\S]*No queda nada por hacer aquí/); } finally { await close(done); }
  const earlier = await openHoy({ id: BOARD, date: '2026-10-20', items });
  try { assert.match(earlier.text(), /Tus contactos del martes, 20 de octubre[\s\S]*Te quedan 2 contactos por revisar/); } finally { await close(earlier); }
  // No contacts of several: no section at all (one contact keeps its line under the next step).
  const none = await openHoy(null);
  try { assert.equal(none.dom.window.document.querySelector('section'), null); } finally { await close(none); }
});

test('a button of the morning email opens its contact inside «Hoy», and other contacts than the ones on screen open on their own page', async () => {
  const today = chileTime.dayInZone(new Date());
  const items = [apolloItem(1, { brief }), apolloItem(2)];
  const lead = '6accdbfcd5f5d80001cf6902';
  bodies.length = 0; answers = [];
  const page = await openHoy({ id: BOARD, date: today, items }, `https://app.test/dashboard?contactos=${linkOf(BOARD)}&c=${lead}`);
  try {
    await page.settle();
    assert.equal(page.dom.window.location.href, 'https://app.test/dashboard', 'the link leaves the address');
    // The contact the email named is open, on its campaign; the others stay a row.
    assert.match(cardOf(page, 1).textContent || '', /Por quéCampaña3Llamada[\s\S]*Asunto: Brigadas en faena[\s\S]*¿Cómo cubren los turnos de noche\?/);
    assert.equal(tabOf(cardOf(page, 1), 'Campaña').getAttribute('aria-selected'), 'true');
    assert.doesNotMatch(cardOf(page, 0).textContent || '', /Cómo abrir/);
    assert.equal(bodies.filter(body => body.action === 'keep').length, 0, 'arriving does nothing by itself');
  } finally { await close(page); }

  const { linkedArrival, } = todayContacts;
  const token = linkOf(BOARD);
  assert.equal(linkedArrival('', BOARD), null);
  assert.equal(linkedArrival('?vista=semana', BOARD), null);
  assert.deepEqual(linkedArrival(`?contactos=${token}&c=${lead}`, BOARD), { focus: lead, away: null });
  assert.deepEqual(linkedArrival(`?contactos=${token}`, BOARD), { focus: null, away: null });
  // An earlier email, another team's contacts, or nothing on screen: their own page, told not to send the person back.
  const other = '33333333-3333-4333-8333-333333333333';
  assert.deepEqual(linkedArrival(`?contactos=${token}&c=${lead}`, other), { focus: null, away: `/dashboard/contactos/${BOARD}?c=${lead}` });
  assert.deepEqual(linkedArrival(`?contactos=${token}`, null), { focus: null, away: `/dashboard/contactos/${BOARD}` });
  // A link that names no contacts leaves the person in «Hoy», without it in the address.
  assert.deepEqual(linkedArrival('?contactos=no-es-un-enlace', BOARD), { focus: null, away: '/dashboard' });
  assert.equal(leadDrops.dropIdInLink(token), BOARD);
  assert.equal(leadDrops.dropIdInLink('corto'), null);
});

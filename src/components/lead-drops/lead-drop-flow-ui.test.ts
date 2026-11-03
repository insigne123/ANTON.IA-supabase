import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
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
  '@/lib/utils': { cn: (...values: unknown[]) => values.filter(Boolean).join(' ') },
};
let home: any = null;
const { LeadDropBanner } = await component('../home/LeadDropBanner.tsx', { ...shared, './usePersonalHome': { usePersonalHome: () => ({ data: home }) } });
let answers: Array<{ status: number; body: unknown }> = [];
let gate: Promise<void> | null = null;
const calls: string[] = [];
// «Enriquecer y guardar» of an Apollo contact: the saved contact it became and what the lookup found, as the browser sees them.
let savedLeads: any[] = [];
let lookups: Array<{ leads: any[]; lookups: Record<string, string> }> = [];
let completion: any = { moved: [], notFound: [], expired: 0, failures: [], consumed: 0, markedNotFound: true };
const { LeadDropFlow } = await component('./LeadDropFlow.tsx', {
  ...shared,
  '@/lib/supabase-service': { supabaseService: { getLeads: async () => savedLeads } },
  '@/lib/leads-workspace/complete-contacts': {
    completeSavedContacts: async (leads: any[], chosen: Record<string, string>) => { lookups.push({ leads, lookups: chosen }); return completion; },
    completionSummary: () => ({ title: 'No encontramos correos', description: 'El proveedor no devolvió resultados para estos contactos.' }),
  },
  '@/lib/leads-workspace/enrichment-provider': { enrichmentCreditReceipt: (consumed: number) => consumed ? `Se descontó ${consumed} crédito de ANTON.IA.` : '' },
  '@/context/AuthContext': { useAuth: () => ({ organizationId: 'org-1' }) },
  '@/components/page-header': { PageHeader: ({ title, description }: any) => React.createElement('header', null, React.createElement('h1', null, title), React.createElement('p', null, description)) },
  '@/lib/authenticated-api-fetch': { authenticatedApiFetch: async (path: string, init?: RequestInit) => {
    calls.push(`${init?.method || 'GET'} ${path}`);
    if (gate) await gate;
    const answer = answers.shift() || { status: 500, body: { error: 'sin respuesta' } };
    return { ok: answer.status < 400, status: answer.status, json: async () => answer.body };
  } },
});

test('«Hoy» shows the contact of the day, offers today\'s, the way back to it, or «Perfil» when there is no customer', () => {
  const render = (data: unknown) => { home = data; return renderToStaticMarkup(React.createElement(LeadDropBanner)); };
  assert.equal(render({ drop: null, pull: null }), '');
  assert.match(render({ drop: null, pull: 'first' }), /Contacto del día[\s\S]*href="\/search\/contactos\/nuevo"[^>]*>Ver mi primer contacto/);
  assert.match(render({ drop: null, pull: 'today' }), /Hoy te toca un contacto nuevo[\s\S]*Ver mi contacto de hoy/);
  assert.match(render({ drop: null, pull: 'preparing' }), /Estamos preparando tu contacto de hoy[\s\S]*Ver cómo va/);
  assert.match(render({ drop: null, pull: 'profile' }), /href="\/profile#icp-heading"[^>]*>Completar mi cliente ideal/);
  const one = render({ drop: { id: 'd-1', dropDate: '2026-10-20', total: 1, left: 1, next: { name: 'Ana Pérez', company: 'Ripley', why: 'Gerente de Personas en retail: calza con tu cliente ideal.' } }, pull: null });
  assert.match(one, /Ana Pérez, Ripley[\s\S]*calza con tu cliente ideal\. Ya tiene su correo verificado[\s\S]*href="\/search\/contactos\/d-1"[^>]*>Ver y guardar/);
  assert.match(render({ drop: { id: 'd-1', dropDate: '2026-10-20', total: 5, left: 2 }, pull: null }), /Te faltan guardar 2 de 5/);
});

const drop = { id: 'drop-1', date: '2026-10-21', criteria: { titles: ['Gerente de Personas'], industries: ['Retail'], locations: ['Chile'], sizes: [], source: 'perfil' },
  items: [{ leadId: 'lf_1', name: 'Ana Pérez', title: 'Gerente de Personas', company: 'Ripley', domain: null, industry: 'Retail', size: null, city: 'Santiago',
    hasEmail: true, hasPhone: false, why: 'Calza.', research: ['Vende ropa.'], draft: { subject: 'Hola', body: 'Hola Ana' } }] };

async function open(dropId: string, options: { motion?: boolean; played?: boolean } = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://app.test/search/contactos/nuevo' });
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
    assert.equal(page.dom.window.location.pathname, '/search/contactos/drop-1');
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
  } finally { await close(many); }
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
  const render = (data: unknown, quiet: boolean) => { home = data; return renderToStaticMarkup(React.createElement(LeadDropBanner, { quietProfile: quiet })); };
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

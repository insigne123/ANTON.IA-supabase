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
const { LeadDropFlow } = await component('./LeadDropFlow.tsx', {
  ...shared,
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

async function open(dropId: string) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://app.test/search/contactos/nuevo' });
  // Reduced motion: once they arrive the contacts show at once, without the playback.
  (dom.window as any).matchMedia = () => ({ matches: true });
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
    assert.match(page.text(), /Quedó en «Por escribir», con su correo\. Ya puedes escribirle\./);
    assert.match(document.querySelector('a[href^="/contact/compose?id=e-1"]')?.textContent || '', /Escribirle/);
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

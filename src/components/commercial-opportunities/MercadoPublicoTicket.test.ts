import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import * as ticketLib from '@/lib/commercial-opportunities/ticket';
import type { TicketStatus } from '@/lib/commercial-opportunities/ticket';

const require = createRequire(import.meta.url);
const source = await readFile(new URL('./MercadoPublicoTicket.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
} }).outputText;
let confirmAnswer = true;
const confirmations: Array<Record<string, unknown>> = [];
const passthrough = (tag: string) => {
  const Passthrough = ({ children, ...props }: Record<string, any>) => React.createElement(tag, props, children);
  Passthrough.displayName = `Mock(${tag})`;
  return Passthrough;
};
const dependencies: Record<string, unknown> = {
  'lucide-react': new Proxy({}, { get: () => () => null }),
  '@/components/confirm-dialog': { useConfirm: () => async (options: Record<string, unknown>) => { confirmations.push(options); return confirmAnswer; } },
  '@/components/ui/badge': { Badge: ({ variant, children }: Record<string, any>) => React.createElement('span', { 'data-variant': variant }, children) },
  '@/components/ui/button': { Button: ({ asChild, variant: _variant, size: _size, children, ...props }: Record<string, any>) => (asChild ? children : React.createElement('button', { type: 'button', ...props }, children)) },
  '@/components/ui/input': { Input: (props: Record<string, unknown>) => React.createElement('input', props) },
  '@/components/ui/label': { Label: passthrough('label') },
  '@/components/ui/sheet': {
    Sheet: ({ open, children }: Record<string, any>) => (open ? React.createElement('div', { role: 'dialog' }, children) : null),
    SheetContent: passthrough('div'), SheetHeader: passthrough('div'), SheetFooter: passthrough('div'), SheetTitle: passthrough('h2'), SheetDescription: passthrough('p'),
  },
  '@/lib/commercial-opportunities/ticket': ticketLib,
  '@/lib/utils': { cn: (...values: unknown[]) => values.filter(Boolean).join(' ') },
};
const exports: any = {};
new Function('require', 'exports', code)((id: string) => (id in dependencies ? dependencies[id] : require(id)), exports);
const { MercadoPublicoTicketCard, TicketGuide } = exports as { MercadoPublicoTicketCard: React.ComponentType<any>; TicketGuide: React.ComponentType<any> };

const status = (patch: Partial<TicketStatus> = {}): TicketStatus => ({ connected: false, hint: null, verifiedAt: null, lastError: null, shared: false, ...patch });
const CONNECTED = status({ connected: true, hint: '1A2B', verifiedAt: new Date(Date.now() - 2 * 86_400_000).toISOString() });
const TICKET = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b1a2b';

/** Mounts in JSDOM with a fake fetch that records every call and answers with `reply`. */
async function mount(element: React.ReactElement, reply: (init: RequestInit) => { status: number; body: unknown }) {
  const dom = new JSDOM('<div id="root"></div>');
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const previous = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch };
  Object.assign(globalThis, {
    window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (url: string, init: RequestInit) => { calls.push({ url, init }); const answer = reply(init); return new Response(JSON.stringify(answer.body), { status: answer.status }); },
  });
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(dom.window.document.getElementById('root')!);
  await act(async () => root.render(element));
  const doc = dom.window.document;
  const text = () => doc.body.textContent || '';
  const button = (label: string | RegExp) => Array.from(doc.querySelectorAll('button')).find(item => (typeof label === 'string' ? item.textContent === label : label.test(item.textContent || '')));
  const type = async (value: string) => act(async () => {
    const input = doc.querySelector('input')!;
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
  const submit = async () => act(async () => { doc.querySelector('form')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); });
  const cleanup = async () => { await act(async () => root.unmount()); Object.assign(globalThis, previous); };
  return { doc, calls, text, button, type, submit, rerender: (next: React.ReactElement) => act(async () => root.render(next)), cleanup };
}

test('without a ticket the card asks for it, checks the format before sending and saves through the API', async () => {
  const changes: TicketStatus[] = [];
  let guides = 0;
  const view = await mount(React.createElement(MercadoPublicoTicketCard, { status: status(), onChange: (next: TicketStatus) => changes.push(next), onOpenGuide: () => { guides++; } }),
    () => ({ status: 200, body: { ticket: CONNECTED, check: 'valid' } }));
  try {
    assert.match(view.text(), /Conecta tu ticket de Mercado Público/);
    const input = view.doc.querySelector('input')!;
    assert.equal(view.doc.querySelector(`label[for="${input.id}"]`)?.textContent, 'Tu ticket de Mercado Público', 'the field has its label');
    assert.equal(view.button('Probar y guardar')?.disabled, true, 'nothing to send yet');

    await act(async () => view.button(/Cómo conseguirlo/)!.click());
    assert.equal(guides, 1);

    await view.type('mi ticket');
    await view.submit();
    assert.match(view.doc.querySelector('[role="alert"]')?.textContent || '', /36 letras y números/);
    assert.equal(view.calls.length, 0, 'a malformed ticket never leaves the page');
    assert.equal(input.getAttribute('aria-invalid'), 'true');

    await view.type(TICKET);
    await view.submit();
    assert.equal(view.calls.length, 1);
    assert.equal(view.calls[0].url, '/api/commercial-opportunities/ticket');
    assert.equal(view.calls[0].init.method, 'PUT');
    assert.deepEqual(JSON.parse(String(view.calls[0].init.body)), { ticket: TICKET });
    assert.deepEqual(changes, [CONNECTED]);
  } finally {
    await view.cleanup();
  }
});

test('the server\'s answer is shown when the ticket is unknown, and the field keeps it to fix', async () => {
  const view = await mount(React.createElement(MercadoPublicoTicketCard, { status: status(), onChange: () => assert.fail('not saved'), onOpenGuide: () => {} }),
    () => ({ status: 400, body: { error: 'Mercado Público no reconoce ese ticket.' } }));
  try {
    await view.type(TICKET);
    await view.submit();
    assert.equal(view.doc.querySelector('[role="alert"]')?.textContent, 'Mercado Público no reconoce ese ticket.');
    assert.equal(view.doc.querySelector('input')!.value, TICKET);
  } finally {
    await view.cleanup();
  }
});

test('a connected ticket shows only its last four characters, and «Quitar» asks first', async () => {
  const changes: TicketStatus[] = [];
  confirmAnswer = false;
  const view = await mount(React.createElement(MercadoPublicoTicketCard, { status: CONNECTED, onChange: (next: TicketStatus) => changes.push(next), onOpenGuide: () => {} }),
    () => ({ status: 200, body: { ticket: status() } }));
  try {
    assert.match(view.text(), /Conectado/);
    assert.match(view.text(), /Tu ticket ••••1A2B · verificado hace 2 días/);
    assert.ok(view.button('Reemplazar') && view.button('Quitar'));
    await act(async () => view.button('Quitar')!.click());
    assert.equal(confirmations.at(-1)?.tone, 'danger');
    assert.equal(view.calls.length, 0, 'cancelled: nothing removed');
    confirmAnswer = true;
    await act(async () => view.button('Quitar')!.click());
    assert.equal(view.calls[0].init.method, 'DELETE');
    assert.deepEqual(changes, [status()]);

    await act(async () => view.button('Reemplazar')!.click());
    assert.match(view.text(), /Reemplaza tu ticket de Mercado Público/);
    assert.ok(view.button('Cancelar'));
  } finally {
    confirmAnswer = true;
    await view.cleanup();
  }
});

test('a refused ticket asks to be replaced; the shared one offers to bring your own', async () => {
  const refused = await mount(React.createElement(MercadoPublicoTicketCard, { status: { ...CONNECTED, lastError: 'Mercado Público rechazó este ticket. Reemplázalo por uno vigente.' }, onChange: () => {}, onOpenGuide: () => {} }),
    () => ({ status: 200, body: {} }));
  try {
    assert.match(refused.doc.querySelector('[role="alert"]')?.textContent || '', /rechazó este ticket/);
    assert.ok(refused.doc.querySelector('form'), 'the field to paste a new one is right there');
  } finally {
    await refused.cleanup();
  }
  const shared = await mount(React.createElement(MercadoPublicoTicketCard, { status: status({ shared: true }), onChange: () => {}, onOpenGuide: () => {} }),
    () => ({ status: 200, body: {} }));
  try {
    assert.match(shared.text(), /Compartido/);
    assert.match(shared.text(), /Usas el ticket compartido de tu cuenta\./);
    assert.ok(shared.button('Usar mi propio ticket'));
    assert.equal(shared.button('Quitar'), undefined, 'the shared ticket is not yours to remove');
  } finally {
    await shared.cleanup();
  }
});

test('the guide walks the three steps, links to the official portal and saves at the end', async () => {
  const saved: TicketStatus[] = [];
  let closed = false;
  const view = await mount(React.createElement(TicketGuide, { open: true, onOpenChange: (open: boolean) => { closed = !open; }, onSaved: (next: TicketStatus) => saved.push(next) }),
    () => ({ status: 200, body: { ticket: CONNECTED, check: 'busy' } }));
  try {
    assert.match(view.text(), /Paso 1 de 3/);
    assert.match(view.text(), /Gratis y personal\./);
    assert.equal(view.doc.querySelector('[aria-current="step"] .sr-only, [aria-current="step"] span')?.textContent, 'Paso 1: Qué es el ticket');
    await act(async () => view.button('Siguiente')!.click());
    assert.match(view.text(), /Paso 2 de 3/);
    const link = view.doc.querySelector<HTMLAnchorElement>('a[href="https://www.chilecompra.cl/api/"]')!;
    assert.equal(link.target, '_blank');
    assert.equal(link.rel, 'noopener noreferrer');
    assert.match(view.text(), /«Pide tu ticket»[\s\S]*Clave Única[\s\S]*«Solicitud de Ticket»/);
    assert.equal(view.doc.activeElement?.tagName, 'H3', 'the focus goes to the new step');
    await act(async () => view.button('Siguiente')!.click());
    assert.match(view.text(), /Paso 3 de 3/);
    await view.type(TICKET);
    await view.submit();
    assert.deepEqual(saved, [CONNECTED]);
    assert.match(view.doc.querySelector('[role="status"]')?.textContent || '', /Mercado Público estaba ocupado con otra consulta, pero el ticket es real/);
    await act(async () => view.button('Listo')!.click());
    assert.equal(closed, true);
  } finally {
    await view.cleanup();
  }
});

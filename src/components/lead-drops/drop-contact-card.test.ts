import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import { JSDOM } from 'jsdom';
import * as leadDrops from '@/lib/lead-drops';

// The page exists before React is loaded, so the card hears typing as a browser's does (lead-drop-flow-ui.test.ts covers the rest).
const dom = new JSDOM('<div id="root"></div>', { url: 'https://app.test/search/contactos/drop-1' });
const previous = { window: (globalThis as any).window, document: (globalThis as any).document };
Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
const React = (await import('react')).default;
const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const require = createRequire(import.meta.url);

const source = await readFile(new URL('./DropContactCard.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const stubs: Record<string, unknown> = {
  '@/components/ui/button': { Button: ({ asChild, variant: _variant, size: _size, ...props }: any) => asChild ? props.children : React.createElement('button', props) },
  '@/components/ui/input': { Input: (props: any) => React.createElement('input', props) },
  '@/components/ui/textarea': { Textarea: (props: any) => React.createElement('textarea', props) },
  '@/components/ui/label': { Label: (props: any) => React.createElement('label', props) },
  'lucide-react': new Proxy({}, { get: () => 'svg' }),
  'next/link': { __esModule: true, default: ({ href, children, ...props }: any) => React.createElement('a', { href, ...props }, children) },
  '@/lib/lead-drops': leadDrops,
  '@/lib/utils': { cn: (...values: unknown[]) => values.filter(Boolean).join(' ') },
};
const card: any = {};
new Function('require', 'exports', code)((id: string) => id in stubs ? stubs[id] : require(id), card);

const item = { leadId: '6accdbfcd5f5d80001cf6901', name: 'Pedro Araya', title: 'Gerente HSE', company: 'Minera Andina', domain: null, industry: 'Minería', size: null, city: null,
  hasEmail: true, hasPhone: false, why: 'Calza con tu cliente ideal por su cargo.', research: [], provider: 'apollo', savedLeadId: 'e-1',
  draft: { subject: 'Brigadas en faena', body: 'Hola {{nombre}},\n\n¿Cómo cubren los turnos de noche?' },
  followUps: [{ day: 3, subject: 'Re: brigadas', body: 'Hola {{nombre}}, ¿lo vemos?' }] };
const type = async (element: Element, value: string) => act(async () => {
  const prototype = element instanceof dom.window.HTMLTextAreaElement ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
  element.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
});
const button = (label: string | RegExp) => [...dom.window.document.querySelectorAll('button')].find(entry => typeof label === 'string' ? entry.textContent === label : label.test(entry.textContent || ''))!;
const press = async (target: Element) => { await act(async () => { target.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); }); };

test('the person rewrites the emails of a contact: what they typed is what is saved, and a refusal keeps their text on screen', async () => {
  const saved: any[] = [];
  let accept = false;
  const actions = { enrich: () => {}, save: () => {}, approve: async () => {}, feedback: async () => {},
    edit: async (_item: unknown, emails: unknown) => { saved.push(JSON.parse(JSON.stringify(emails))); return accept; } };
  const root = createRoot(dom.window.document.getElementById('root')!);
  try {
    await act(async () => root.render(React.createElement(card.DropContactCard, { item, actions, busy: false, enriching: false, defaultOpen: true })));
    const document = dom.window.document;
    // Opened from the email, the campaign is in view: both emails, each with its day.
    assert.match(document.body.textContent || '', /Campaña lista · 2 correos[\s\S]*Primer correo · [\s\S]*Brigadas en faena[\s\S]*Seguimiento 1 · [\s\S]*si no responde/);
    // To read, each email as the contact would get it; to change (below), the text with its variables.
    assert.match(document.body.textContent || '', /Hola Pedro,[\s\S]*¿Cómo cubren los turnos de noche\?[\s\S]*Hola Pedro, ¿lo vemos\?/);
    assert.doesNotMatch(document.body.textContent || '', /\{\{nombre\}\}/);
    await press(button('Editar los correos'));
    const fields = [...document.querySelectorAll('input, textarea')] as Array<HTMLInputElement | HTMLTextAreaElement>;
    assert.deepEqual(fields.map(field => field.value), ['Brigadas en faena', 'Hola {{nombre}},\n\n¿Cómo cubren los turnos de noche?', 'Re: brigadas', 'Hola {{nombre}}, ¿lo vemos?']);
    assert.ok(fields.every(field => document.querySelector(`label[for="${field.id}"]`)), 'every field has its label');
    assert.equal(button('Aprobar y programar').disabled, true, 'nothing is approved while its emails are being changed');
    await type(fields[0], 'Turnos de noche en faena');
    await type(fields[3], 'Hola {{nombre}}, ¿te sirve verlo el jueves?');
    // The server refuses (another tab changed them): the form stays, with what the person typed.
    await act(async () => { document.querySelector('form')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); });
    assert.deepEqual(saved[0], { draft: { subject: 'Turnos de noche en faena', body: 'Hola {{nombre}},\n\n¿Cómo cubren los turnos de noche?' },
      followUps: [{ subject: 'Re: brigadas', body: 'Hola {{nombre}}, ¿te sirve verlo el jueves?' }] });
    assert.equal((document.querySelector('input') as HTMLInputElement).value, 'Turnos de noche en faena');
    accept = true;
    await act(async () => { document.querySelector('form')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); });
    assert.equal(saved.length, 2);
    assert.equal(document.querySelector('form'), null, 'saved: back to reading');
    // «Cancelar» forgets what was typed.
    await press(button('Editar los correos'));
    await type(document.querySelector('input')!, 'Otra cosa');
    await press(button('Cancelar'));
    assert.equal(document.querySelector('form'), null);
    assert.match(document.body.textContent || '', /Asunto: Brigadas en faena/);
  } finally {
    await act(async () => root.unmount());
    Object.assign(globalThis, { ...previous, IS_REACT_ACT_ENVIRONMENT: false });
    dom.window.close();
  }
});

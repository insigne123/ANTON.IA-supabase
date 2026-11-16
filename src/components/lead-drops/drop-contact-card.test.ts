import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import { JSDOM } from 'jsdom';
import * as contactCalls from '@/lib/contact-calls';
import * as leadDropCall from '@/lib/lead-drop-call';
import * as leadDrops from '@/lib/lead-drops';

// The page exists before React is loaded, so the card hears typing as a browser's does (lead-drop-flow-ui.test.ts covers the rest).
const dom = new JSDOM('<div id="root"></div>', { url: 'https://app.test/dashboard/contactos/drop-1' });
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
  // «Para llamar»: the real rules of the number and of the script; the app's «Llamar» and «WhatsApp» as a line that says what it got.
  '@/lib/contact-calls': contactCalls,
  '@/lib/lead-drop-call': leadDropCall,
  '@/components/contact/ContactActions': { ContactActions: ({ phone, whatsappText, contact }: any) => React.createElement('p', { 'data-contact-actions': contact?.leadId || '', 'data-whatsapp': whatsappText || '' }, `Llamar · WhatsApp · ${phone}`) },
  '@/lib/utils': { cn: (...values: unknown[]) => values.filter(Boolean).join(' ') },
};
// The card's own pieces are the real ones, compiled the same way and handed to it: the app's tabs (with their arrow keys), the
// avatar and the stage chip, and «Para llamar» (DropCallPanel).
const compile = async (file: string) => {
  const compiled = ts.transpileModule(await readFile(new URL(file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const exports: any = {};
  new Function('require', 'exports', compiled)((id: string) => id in stubs ? stubs[id] : require(id), exports);
  return exports;
};
stubs['@/hooks/use-scroll-edge-fade'] = { useScrollEdgeFade: () => [() => {}, undefined] };
stubs['@/components/ui/segmented-tabs'] = await compile('../ui/segmented-tabs.tsx');
stubs['./drop-contact-parts'] = await compile('./drop-contact-parts.tsx');
stubs['./DropCallPanel'] = await compile('./DropCallPanel.tsx');
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
const tabs = () => [...dom.window.document.querySelectorAll('[role="tab"]')];
const tab = (label: string) => tabs().find(entry => (entry.textContent || '').startsWith(label))!;
const steps = () => [...dom.window.document.querySelectorAll('ol[aria-label="Correos de la campaña"] button')];
const press = async (target: Element) => { await act(async () => { target.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); }); };

test('the person rewrites the emails of a contact: what they typed is what is saved, and a refusal keeps their text on screen', async () => {
  const saved: any[] = [];
  let accept = false;
  const actions = { enrich: () => {}, save: () => {}, approve: async () => {}, feedback: async () => {}, phone: async () => {}, script: async () => {}, refresh: async () => {},
    edit: async (_item: unknown, emails: unknown) => { saved.push(JSON.parse(JSON.stringify(emails))); return accept; } };
  const root = createRoot(dom.window.document.getElementById('root')!);
  try {
    await act(async () => root.render(React.createElement(card.DropContactCard, { item, actions, busy: false, enriching: false, defaultOpen: true })));
    const document = dom.window.document;
    // The card is its person, where it stands and its sections, one at a time (16 Nov 2026, the redesign): opened from the email,
    // the campaign is the one in view.
    assert.match(document.querySelector('article')!.textContent || '', /^PAPedro ArayaCampaña por aprobarGerente HSE · Minera Andina/);
    assert.deepEqual(tabs().map(entry => [entry.textContent, entry.getAttribute('aria-selected')]), [['Por qué', 'false'], ['Campaña2', 'true'], ['Llamada', 'false']]);
    assert.equal(document.querySelectorAll('[role="tabpanel"]').length, 1);
    // The campaign is a sequence to walk: its steps with the day each goes, and one email to read at a time, as the contact would
    // get it; to change (below), the text with its variables.
    assert.equal(steps().length, 2);
    assert.match(steps()[0].textContent || '', /^1Primer correo/);
    assert.match(steps()[1].textContent || '', /^2Seguimiento 1.* · si no responde$/);
    assert.deepEqual(steps().map(entry => entry.getAttribute('aria-current')), ['step', null]);
    assert.match(document.body.textContent || '', /Primer correo · [^·]+Asunto: Brigadas en faenaCopiarHola Pedro,\s+¿Cómo cubren los turnos de noche\?/);
    assert.doesNotMatch(document.body.textContent || '', /¿lo vemos\?/, 'one email at a time');
    await press(steps()[1]);
    assert.deepEqual(steps().map(entry => entry.getAttribute('aria-current')), [null, 'step']);
    assert.match(document.body.textContent || '', /Seguimiento 1 · [^·]+ · si no respondeAsunto: Re: brigadasCopiarHola Pedro, ¿lo vemos\?/);
    assert.doesNotMatch(document.body.textContent || '', /\{\{nombre\}\}|turnos de noche/);
    await press(steps()[0]);
    // Why it is recommended is its own section: the campaign leaves the screen while it is read.
    await press(tab('Por qué'));
    assert.match(document.body.textContent || '', /Por qué te lo recomendamosCalza con tu cliente ideal por su cargo\./);
    assert.equal(steps().length, 0);
    await press(tab('Campaña'));
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
  }
});

const SCRIPT = { points: ['Turnos de noche: quién responde ante una emergencia en faena.', 'Auditorías de seguridad: evidencia de cada inspección.'],
  opening: 'Hola Pedro, soy Ana de Brigadas del Sur. Te llamo porque apoyamos a faenas con brigadas de emergencia. ¿Cómo cubren hoy los turnos de noche?',
  questions: ['¿Cuántas personas quedan a cargo en el turno de noche?', '¿Cómo registran hoy cada inspección?'],
  objections: [{ objection: 'Ya tenemos proveedor', answer: 'Perfecto. ¿Te sirve comparar cómo cubrimos los turnos de noche, sin compromiso?' }],
  voicemail: 'Hola Pedro, soy Ana de Brigadas del Sur. Te llamaba por las brigadas de emergencia en faena. Te escribo un correo con el detalle.',
  whatsapp: 'Hola Pedro, soy Ana de Brigadas del Sur. Apoyamos a faenas con brigadas de emergencia. ¿Te sirve conversar cinco minutos esta semana?' };

test('«Para llamar»: the mobile with the email or after it, the number with its two ways once it lands, and the script of the call, prepared when asked', async () => {
  const asked: string[] = [];
  const actions = { save: () => {}, approve: async () => {}, feedback: async () => {}, edit: async () => true,
    enrich: (_item: unknown, withPhone?: boolean) => { asked.push(withPhone ? 'enrich+phone' : 'enrich'); },
    phone: async () => { asked.push('phone'); }, script: async (_item: unknown, fresh?: boolean) => { asked.push(fresh ? 'script:fresh' : 'script'); }, refresh: async () => { asked.push('refresh'); } };
  const root = createRoot(dom.window.document.getElementById('root')!);
  const document = dom.window.document;
  const show = (contact: Record<string, unknown>, extra: Record<string, unknown> = {}) => act(async () => root.render(React.createElement(card.DropContactCard, { item: contact, actions, busy: false, enriching: false, ...extra })));
  const text = () => document.body.textContent || '';
  try {
    // Not looked up yet: the email alone is the button; with its mobile, the quieter way under it.
    await show({ ...item, savedLeadId: null });
    assert.ok(button('Enriquecer · 1 crédito'));
    await press(button('O con su teléfono · 8 créditos'));
    assert.deepEqual(asked, ['enrich+phone']);
    // The call is the card's third section: the row of its phone and, under it, the script.
    await press(tab('Llamada'));
    assert.equal(tab('Llamada').getAttribute('aria-selected'), 'true');
    assert.match(text(), /Su teléfono se busca al enriquecerlo: junto con el correo \(8 créditos por ambos\) o después \(8 más\)\./);
    // Without a script yet, it is prepared when asked, and costs no credit.
    await press(button('Preparar guion de llamada'));
    assert.deepEqual(asked, ['enrich+phone', 'script']);
    assert.match(text(), /No usa créditos\./);

    // In «Por escribir», without a mobile: it is looked up from here; one that found nothing says so.
    asked.length = 0;
    await show({ ...item, phone: { state: 'none', missed: false } });
    await press(button('Buscar su teléfono · 8 créditos'));
    assert.deepEqual(asked, ['phone']);
    await show({ ...item, phone: { state: 'none', missed: true } });
    assert.match(text(), /La última búsqueda no encontró un teléfono para este contacto\./);

    // On its way: said as a status, with a way to ask again.
    asked.length = 0;
    await show({ ...item, phone: { state: 'pending' } });
    assert.match(document.querySelector('[role="status"]')?.textContent || '', /Buscando su teléfono/);
    await press(button('Actualizar'));
    assert.deepEqual(asked, ['refresh']);

    // Here: the number with «Llamar» and «WhatsApp» (the app's own, which record the call), the WhatsApp line being the script's.
    await show({ ...item, phone: { state: 'found', number: '+56 9 8765 4321', more: 1 }, call: { script: SCRIPT, at: '2026-11-15T12:00:00.000Z' } });
    assert.match(tab('Llamada').textContent || '', /\(con teléfono\)/, 'the tab says a mobile is there before it is opened');
    const ways = document.querySelector('[data-contact-actions]')!;
    assert.equal(ways.getAttribute('data-contact-actions'), 'e-1');
    assert.equal(ways.getAttribute('data-whatsapp'), SCRIPT.whatsapp);
    // The script in blocks, in the order of the call: what to say first, then what matters to that person by theme next to what
    // to ask, the answers to what they may object, and what to leave if nobody picks up.
    assert.match(text(), /Guion de llamada[\s\S]*Al contestarHola Pedro, soy Ana[\s\S]*Puntos de interésTurnos de noche: quién responde[\s\S]*Preguntas1¿Cuántas personas[\s\S]*2¿Cómo registran[\s\S]*Si te dice…«Ya tenemos proveedor»Perfecto\.[\s\S]*Si no contesta[\s\S]*Primer WhatsApp/);
    assert.deepEqual([...document.querySelectorAll('dl dt')].map(entry => entry.textContent), ['«Ya tenemos proveedor»']);
    asked.length = 0;
    await press(button('Otra versión'));
    assert.deepEqual(asked, ['script:fresh']);

    // From the inbox nobody is signed in: the same number as plain links, the WhatsApp one with the script's first line.
    await show({ ...item, phone: { state: 'found', number: '+56 9 8765 4321', more: 0 }, call: { script: SCRIPT, at: '2026-11-15T12:00:00.000Z' } },
      { mail: { mailbox: 'Gmail', email: 'pedro@mineraandina.cl', connect: { google: '/g', outlook: '/o' }, switchCampaign: async () => {} } });
    assert.equal(document.querySelector('[data-contact-actions]'), null);
    const links = [...document.querySelectorAll('a')].map(link => link.getAttribute('href') || '');
    assert.ok(links.includes('tel:+56987654321'));
    assert.ok(links.some(href => href.startsWith('https://wa.me/56987654321?text=') && decodeURIComponent(href).includes('soy Ana de Brigadas del Sur')));
  } finally {
    await act(async () => root.unmount());
    Object.assign(globalThis, { ...previous, IS_REACT_ACT_ENVIRONMENT: false });
    dom.window.close();
  }
});

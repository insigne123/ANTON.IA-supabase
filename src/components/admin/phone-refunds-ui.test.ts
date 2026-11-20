import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import { JSDOM } from 'jsdom';
import * as creditPrices from '@/lib/credit-prices';
import * as phoneRefunds from '@/lib/phone-refunds';

const dom = new JSDOM('<div id="root"></div>', { url: 'https://app.test/dashboard/admin' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
const React = (await import('react')).default;
const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const require = createRequire(import.meta.url);

const source = await readFile(new URL('./PhoneRefundsCard.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const tag = (name: string) => {
  const Tag = ({ asChild: _asChild, variant: _variant, size: _size, ...props }: any) => React.createElement(name, props);
  Tag.displayName = name;
  return Tag;
};
const stubs: Record<string, unknown> = {
  '@/components/ui/badge': { Badge: tag('span') }, '@/components/ui/button': { Button: tag('button') },
  '@/components/ui/card': { Card: tag('section'), CardContent: tag('div'), CardHeader: tag('div'), CardTitle: tag('div') },
  '@/components/ui/label': { Label: tag('label') }, '@/components/ui/textarea': { Textarea: tag('textarea') },
  '@/lib/credit-prices': creditPrices, '@/lib/phone-refunds': phoneRefunds,
};
const exports: any = {};
new Function('require', 'exports', code)((id: string) => id in stubs ? stubs[id] : require(id), exports);

const claim = (id: string, status: string, extra: Record<string, unknown> = {}) => ({ id, phone: '56987654321', contactName: 'Ana Rojas', credits: 5, status, reportedAt: '2026-12-02T15:00:00Z', reviewedAt: null, reviewNote: null, ...extra });
async function mount(first: unknown, answers: Array<{ status: number; body: unknown }> = []) {
  const posts: any[] = [];
  (globalThis as any).fetch = async (_url: string, init?: any) => {
    if (!init?.method) return new Response(JSON.stringify(first), { status: first ? 200 : 403 });
    posts.push(JSON.parse(init.body));
    const answer = answers.shift()!;
    return new Response(JSON.stringify(answer.body), { status: answer.status });
  };
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  await act(async () => { root.render(React.createElement(exports.PhoneRefundsCard)); });
  for (let turn = 0; turn < 4; turn++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  const settle = async () => { for (let turn = 0; turn < 4; turn++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); };
  const button = (label: string) => [...host.querySelectorAll('button')].find(entry => entry.textContent === label) as HTMLButtonElement | undefined;
  return { host, posts, settle, button, text: () => host.textContent || '', close: () => act(async () => { root.unmount(); host.remove(); }) };
}

test('an organization whose agreement does not include it, with nothing sent, sees no card', async () => {
  const off = await mount({ enabled: false, claims: [], canReview: false, phoneCredits: 8 });
  assert.equal(off.text(), '');
  await off.close();
  const refused = await mount(null);
  assert.equal(refused.text(), '', 'someone who is not an administrator');
  await refused.close();
});

test('the administrator sends the numbers and reads what was taken; the list says where each one stands', async () => {
  const sent = claim('c-1', 'reported');
  const page = await mount({ enabled: true, claims: [], canReview: false, phoneCredits: 5 }, [
    { status: 200, body: { report: { added: 1, repeated: [], unknown: ['56911112222'], invalid: [] }, claims: [sent], canReview: false } },
    { status: 503, body: { error: 'No pudimos guardar los teléfonos. Intenta nuevamente.' } },
  ]);
  assert.match(page.text(), /Teléfonos que no existen/);
  assert.match(page.text(), /Lo probamos en un plazo de 5 días hábiles y, si se confirma, te devolvemos sus 5 créditos\./);
  assert.match(page.text(), /Aún no has enviado teléfonos\./);
  const field = page.host.querySelector('textarea') as HTMLTextAreaElement;
  assert.equal(page.host.querySelector('label')?.getAttribute('for'), field.id, 'the field has its label');
  assert.equal(page.button('Enviar teléfonos')?.disabled, true, 'nothing to send yet');
  const type = async (value: string) => act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
  await type('+56 9 8765 4321\n+56 9 1111 2222');
  await act(async () => { page.button('Enviar teléfonos')!.click(); });
  await page.settle();
  assert.deepEqual(page.posts, [{ action: 'report', phones: '+56 9 8765 4321\n+56 9 1111 2222' }]);
  assert.equal(page.host.querySelector('[role="status"]')?.textContent,
    'Recibimos 1 teléfono: lo probamos y te avisamos aquí. No lo encontramos entre los teléfonos que te entregó ANTON.IA: +56911112222.');
  assert.equal(field.value, '+56 9 8765 4321\n+56 9 1111 2222', 'what was not taken stays to be corrected');
  assert.match(page.text(), /1 en revisión/);
  assert.match(page.text(), /\+56987654321Ana Rojas · Enviado el 2 dic/);
  assert.match(page.text(), /En revisión/);
  assert.equal(page.button('No existe: devolver'), undefined, 'the customer does not answer its own list');
  // A failure is said, and the list stays.
  await act(async () => { page.button('Enviar teléfonos')!.click(); });
  await page.settle();
  assert.equal(page.host.querySelector('[role="alert"]')?.textContent, 'No pudimos guardar los teléfonos. Intenta nuevamente.');
  assert.match(page.text(), /1 en revisión/);
  await page.close();
});

test('the ANTON.IA team answers each phone from the same card; a confirmed one shows its credits', async () => {
  const page = await mount({ enabled: true, claims: [claim('c-1', 'reported'), claim('c-2', 'rejected', { phone: '56223456789', contactName: null })], canReview: true, phoneCredits: 5 }, [
    { status: 200, body: { claims: [claim('c-1', 'confirmed', { reviewedAt: '2026-12-04T15:00:00Z' }), claim('c-2', 'rejected', { phone: '56223456789', contactName: null })], canReview: true } },
  ]);
  assert.ok(page.button('No existe: devolver') && page.button('Sí existe'));
  assert.match(page.text(), /Sin devolución/);
  await act(async () => { page.button('No existe: devolver')!.click(); });
  await page.settle();
  assert.deepEqual(page.posts, [{ action: 'review', id: 'c-1', decision: 'confirmed' }]);
  assert.match(page.text(), /0 en revisión · 1 devuelto \(5 créditos\)/);
  assert.match(page.text(), /Devuelto · 5 créditos/);
  assert.equal(page.button('No existe: devolver'), undefined);
  await page.close();
});

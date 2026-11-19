import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import { JSDOM } from 'jsdom';
import * as leadDrops from '@/lib/lead-drops';
import * as rules from '@/lib/search/recommended-notice';

const dom = new JSDOM('<div id="root"></div>', { url: 'https://app.test/search' });
const previous = { window: (globalThis as any).window, document: (globalThis as any).document };
Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
const React = (await import('react')).default;
const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const require = createRequire(import.meta.url);

const TODAY = '2026-11-19';
let answer: { ok: boolean; body: unknown } | 'down' = { ok: true, body: null };
let organizationId: string | null = 'org-1';
const asked: Array<{ path: string; org: string | undefined }> = [];
const pushed: string[] = [];
let escape: () => void = () => {};
const stubs: Record<string, unknown> = {
  // The app's dialog, as plain elements: what is said, its two buttons, and the answer Escape gives (onOpenChange).
  '@/components/ui/alert-dialog': {
    AlertDialog: ({ open, onOpenChange, children }: any) => { escape = () => onOpenChange(false); return open ? React.createElement('div', { role: 'alertdialog' }, children) : null; },
    AlertDialogContent: ({ children }: any) => React.createElement('div', null, children),
    AlertDialogHeader: ({ children }: any) => React.createElement('header', null, children),
    AlertDialogFooter: ({ children }: any) => React.createElement('footer', null, children),
    AlertDialogTitle: ({ children }: any) => React.createElement('h2', null, children),
    AlertDialogDescription: ({ children }: any) => React.createElement('p', { 'data-description': '' }, children),
    AlertDialogCancel: ({ children }: any) => React.createElement('button', { type: 'button', onClick: () => escape() }, children),
    AlertDialogAction: ({ children, onClick }: any) => React.createElement('button', { type: 'button', onClick }, children),
  },
  'next/navigation': { useRouter: () => ({ push: (href: string) => { pushed.push(href); } }) },
  '@/context/AuthContext': { useAuth: () => ({ organizationId }) },
  '@/lib/admin/chile-time': { dayInZone: () => TODAY },
  '@/lib/authenticated-api-fetch': { authenticatedApiFetch: async (path: string, init: any) => {
    asked.push({ path, org: init?.headers?.['x-organization-id'] });
    if (answer === 'down') throw new Error('offline');
    return { ok: answer.ok, json: async () => answer !== 'down' && answer.body };
  } },
  '@/lib/lead-drops': leadDrops,
  '@/lib/search/recommended-notice': rules,
  'lucide-react': new Proxy({}, { get: () => 'svg' }),
};
const source = await readFile(new URL('./RecommendedNotice.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const notice: any = {};
new Function('require', 'exports', code)((id: string) => id in stubs ? stubs[id] : require(id), notice);

const open = async () => {
  const host = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(React.createElement(notice.RecommendedNotice)));
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  return { host, close: async () => { await act(async () => root.unmount()); host.remove(); } };
};
const board = (id: string) => ({ ok: true, body: { drop: null, board: { id, date: TODAY, items: [{ leadId: 'a' }, { leadId: 'b' }, { leadId: 'c', savedLeadId: 'e', campaign: { id: 'x' } }] } } });

test.after(() => { Object.assign(globalThis, { ...previous, IS_REACT_ACT_ENVIRONMENT: false }); dom.window.close(); });

const click = async (target: Element) => { await act(async () => { target.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); }); };
const buttonOf = (host: Element, label: string) => [...host.querySelectorAll('button')].find(entry => entry.textContent === label)!;

test('arriving at «Buscar prospectos», a large notice says the recommended contacts that wait, with two answers: go to them or close it', async () => {
  answer = board('drop-6');
  let page = await open();
  assert.deepEqual(asked.at(-1), { path: '/api/lead-drops/latest', org: 'org-1' });
  const dialog = page.host.querySelector('[role="alertdialog"]')!;
  assert.equal(dialog.querySelector('h2')!.textContent, 'Te esperan 2 contactos recomendados');
  assert.equal(dialog.querySelector('[data-description]')!.textContent, 'Te quedan 2 de tus 3 contactos recomendados por revisar. Los encuentras en «Tus contactos de hoy», listos para revisar y enviar.');
  assert.match(dialog.textContent || '', /^Sección nueva · Contactos recomendados/);
  assert.deepEqual([...dialog.querySelectorAll('button')].map(entry => entry.textContent), ['Cerrar', 'Ver mis recomendados'], 'two answers, no more');
  // «Cerrar»: gone, remembered, and the person stays on the search.
  await click(buttonOf(page.host, 'Cerrar'));
  assert.equal(page.host.querySelector('[role="alertdialog"]'), null);
  assert.equal(dom.window.localStorage.getItem('anton:search-recommended:drop-6'), '1');
  assert.deepEqual(pushed, []);
  await page.close();

  // The same contacts on the next visit: not said again. The next day's: said, and «Ver mis recomendados» goes to them.
  page = await open();
  assert.equal(page.host.querySelector('[role="alertdialog"]'), null);
  await page.close();
  answer = board('drop-7');
  page = await open();
  await click(buttonOf(page.host, 'Ver mis recomendados'));
  assert.deepEqual(pushed, ['/dashboard/contactos/drop-7']);
  assert.equal(page.host.querySelector('[role="alertdialog"]'), null);
  assert.equal(dom.window.localStorage.getItem('anton:search-recommended:drop-7'), '1', 'coming back to the search does not say it again');
  await page.close();

  // Escape is «Cerrar».
  answer = board('drop-8');
  page = await open();
  assert.ok(page.host.querySelector('[role="alertdialog"]'));
  await act(async () => { escape(); });
  assert.equal(page.host.querySelector('[role="alertdialog"]'), null);
  assert.equal(dom.window.localStorage.getItem('anton:search-recommended:drop-8'), '1');
  await page.close();
});

test('it says nothing when nothing waits, when the answer fails, or before the workspace is known', async () => {
  for (const next of [{ ok: true, body: { drop: null, pull: 'today' } }, { ok: false, body: { error: 'x' } }, 'down' as const]) {
    answer = next;
    const page = await open();
    assert.equal(page.host.innerHTML, '');
    await page.close();
  }
  organizationId = null;
  asked.length = 0;
  answer = board('drop-9');
  const page = await open();
  assert.equal(page.host.innerHTML, '');
  assert.equal(asked.length, 0, 'nothing is asked without a workspace');
  await page.close();
});

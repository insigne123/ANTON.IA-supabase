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
const stubs: Record<string, unknown> = {
  '@/components/ui/button': { Button: ({ asChild, variant: _variant, size: _size, ...props }: any) => asChild ? props.children : React.createElement('button', props) },
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
  'next/link': { __esModule: true, default: ({ href, children, ...props }: any) => React.createElement('a', { href, ...props }, children) },
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

test('«Buscar prospectos» says the recommended contacts that wait for the person, with one way in; closed, it stays closed until the next ones', async () => {
  answer = board('drop-6');
  let page = await open();
  assert.deepEqual(asked.at(-1), { path: '/api/lead-drops/latest', org: 'org-1' });
  const section = page.host.querySelector('section')!;
  assert.equal(section.getAttribute('aria-labelledby'), 'recomendados-aviso');
  assert.equal(section.querySelector('h2')!.textContent, 'Contactos recomendadosNuevo');
  assert.equal(section.querySelector('p')!.textContent, 'Te quedan 2 de tus 3 contactos recomendados por revisar.');
  const link = section.querySelector('a')!;
  assert.deepEqual([link.textContent, link.getAttribute('href')], ['Ver mis recomendados', '/dashboard/contactos/drop-6']);
  const closer = section.querySelector('button')!;
  assert.equal(closer.getAttribute('aria-label'), 'Cerrar el aviso de contactos recomendados');
  await act(async () => { closer.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  assert.equal(page.host.querySelector('section'), null);
  assert.equal(dom.window.localStorage.getItem('anton:search-recommended:drop-6'), '1');
  await page.close();

  // The same contacts on the next visit: still closed. The next day's: said again.
  page = await open();
  assert.equal(page.host.querySelector('section'), null);
  await page.close();
  answer = board('drop-7');
  page = await open();
  assert.match(page.host.textContent || '', /Contactos recomendados/);
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
  answer = board('drop-8');
  const page = await open();
  assert.equal(page.host.innerHTML, '');
  assert.equal(asked.length, 0, 'nothing is asked without a workspace');
  await page.close();
});

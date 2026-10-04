// Render the real workspace with a simulated API boundary. No provider requests,
// authentication tokens, production reads/writes or paid searches are performed.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');

const stubs = { name: 'workspace-boundary', setup(b) {
  b.onResolve({ filter: /^next\/link$|^@\/hooks\/use-toast$/ }, args => ({ path: args.path, namespace: 'stub' }));
  b.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ loader: 'tsx', resolveDir: process.cwd(), contents: args.path === 'next/link'
    ? `import React from 'react'; export default function Link(props) { return <a {...props}/>; }`
    : `export const useToast = () => ({ toast: value => window.notifications.push(value) });` }));
} };
const bundle = await build({ stdin: { loader: 'tsx', resolveDir: process.cwd(), contents: `
  import React from 'react'; import { createRoot } from 'react-dom/client';
  import { OpportunitiesWorkspace } from './src/components/commercial-opportunities/OpportunitiesWorkspace';
  const root = createRoot(document.getElementById('root'));
  window.mount = () => root.render(<OpportunitiesWorkspace key={++window.mountKey}/>);` },
  bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', plugins: [stubs],
  define: { 'process.env.NODE_ENV': '"production"' } });
const cssRoot = resolve('.next/static/css');
const css = (await Promise.all((await readdir(cssRoot)).filter(name => name.endsWith('.css')).map(name => readFile(resolve(cssRoot, name), 'utf8')))).join('\n');
const startedAt = '2026-10-03T12:00:00Z';
const failed = source => ({ id: source, source, status: 'failed', startedAt, finishedAt: '2026-10-03T12:00:10Z', fetched: 0,
  created: 0, updated: 0, costUsd: 0, error: source === 'jsearch' ? 'Consultas limitadas temporalmente.' : 'Parámetros rechazados.' });
const overview = { profile: { id: 'p1', name: 'Contratación operativa', offer: 'Apoyo en contratación de personal operativo.', roles: ['Operario'],
  regions: [], minAds: 3, keywords: ['personal'], unspscCodes: [], sectors: [], minInvestmentUsd: null },
  plan: { sources: [{ source: 'jsearch', enabled: true, label: 'Google for Jobs', estimateUsd: 0.0025, requests: 1, missing: null },
    { source: 'linkedin', enabled: true, label: 'LinkedIn', estimateUsd: 1, requests: 198, missing: null }], estimateUsd: 1.0025 },
  month: { spentUsd: 0, capUsd: 10 }, tenderSearch: { ticket: true, keywords: ['personal'], unspscCodes: [] },
  opportunities: [], tenders: [], projects: [], runs: [failed('linkedin'), failed('jsearch')] };
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, colorScheme: theme });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route(/^https?:/, route => route.abort());
    await page.setContent(`<html class="${theme === 'dark' ? 'dark' : ''}"><body><main id="root" style="padding:16px"></main></body></html>`);
    await page.addStyleTag({ content: css });
    await page.evaluate(data => {
      window.mountKey = 0; window.notifications = []; window.overview = data; window.calls = [];
      window.fetch = async (url, options = {}) => {
        window.calls.push([url, options.method || 'GET']);
        const data = options.method === 'POST' ? { status: 'failed', fetched: 0, qualifying: 0, newQualifying: 0, costUsd: 0,
          sources: [{ source: 'jsearch', error: 'Temporary limit' }, { source: 'linkedin', error: 'Rejected' }] } : window.overview;
        return { ok: true, json: async () => data };
      };
    }, overview);
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(() => window.mount());
    await page.getByRole('heading', { name: 'La búsqueda no se pudo completar' }).waitFor();
    assert.equal(await page.getByText('Ninguna empresa llega a 3 avisos', { exact: true }).count(), 0);
    assert.equal(await page.getByLabel('Problemas de las fuentes').locator('li').count(), 2);
    const contrast = await page.getByLabel('Problemas de las fuentes').evaluate(node => {
      const rgb = value => value.match(/[\d.]+/g).slice(0, 3).map(Number);
      const luminance = color => rgb(color).map(value => { const s = value / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; })
        .reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0);
      const foreground = luminance(getComputedStyle(node).color);
      const background = luminance(getComputedStyle(node.closest('section')).backgroundColor);
      return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
    });
    assert.ok(contrast >= 4.5, `Warning contrast ${contrast.toFixed(2)}/${theme}`);
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Overflow ${width}/${theme}`);
    }
    await page.getByRole('button', { name: 'Revisar y reintentar', exact: true }).click();
    await page.getByRole('alertdialog').waitFor();
    const confirm = page.getByRole('alertdialog').getByRole('button', { name: /Buscar/ });
    await confirm.click();
    await page.waitForFunction(() => window.notifications.length > 0);
    const notification = await page.evaluate(() => window.notifications.at(-1));
    assert.equal(notification.title, 'No se pudo consultar las fuentes');
    assert.equal(notification.variant, 'destructive');
    assert.doesNotMatch(notification.title, /0 empresas/);
    await page.getByRole('tab', { name: /Licitaciones y Compra Ágil/ }).click();
    await page.evaluate(() => { window.overview.runs = ['mercado_publico', 'compra_agil'].map(source => ({ ...window.overview.runs[0], source, id: source })); window.mount(); });
    await page.getByRole('tab', { name: /Licitaciones y Compra Ágil/ }).click();
    await page.getByRole('heading', { name: 'No se pudo consultar las licitaciones' }).waitFor();
    assert.equal(await page.getByText('Ninguna licitación abierta calza', { exact: true }).count(), 0);
    await page.evaluate(() => { window.overview.runs = []; window.mount(); });
    await page.getByRole('heading', { name: 'Aún no hay empresas' }).waitFor();
    await page.evaluate(() => { window.overview.runs = [{ source: 'jsearch', status: 'succeeded', startedAt: '2026-10-03T12:00:00Z', fetched: 0, created: 0, costUsd: 0.0025, error: null }]; window.mount(); });
    await page.getByRole('heading', { name: 'Ninguna empresa llega a 3 avisos' }).waitFor();
    await page.evaluate(() => { window.overview.runs[0].error = 'Una consulta no respondió.'; window.mount(); });
    await page.getByRole('heading', { name: 'Búsqueda incompleta, sin empresas para mostrar' }).waitFor();
    assert.equal(await page.getByText('Ninguna empresa llega a 3 avisos', { exact: true }).count(), 0);
    assert.deepEqual(errors, []);
    console.log(`PASS: opportunities ${theme}, failed search/retry toast/tender failure/first search/true empty/partial search, 390/768/1440 px without overflow (simulated API).`);
    await page.close();
  }
} finally { await browser.close(); }

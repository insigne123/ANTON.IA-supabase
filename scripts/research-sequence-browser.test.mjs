import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';

const scratch = path.join(process.env.LOCALAPPDATA, 'Temp/opencode');
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || path.join(scratch, 'campaign-browser/node_modules/playwright/index.mjs')).href);

test('sequence preparation: four slots, partial progress, retry, reload recovery, editorial issues, responsive and keyboard', async () => {
  const output = await build({
    stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import Page from './src/app/(app)/contact/sequence/page'; createRoot(document.getElementById('root')).render(<Page/>);`, loader: 'tsx', resolveDir: process.cwd() },
    bundle: true, write: false, platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"test"' },
    plugins: [{ name: 'navigation', setup(build) {
      build.onResolve({ filter: /^next\/(link|navigation)$/ }, args => ({ path: args.path, namespace: 'mock' }));
      build.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ loader: 'jsx', resolveDir: process.cwd(), contents: args.path === 'next/link'
        ? `import React from 'react'; export default function Link(props){return <a {...props}/>}`
        : `export const useSearchParams=()=>new URLSearchParams(window.location.search); export const useRouter=()=>({ push: (url) => { window.__pushedUrl = String(url); } });` }));
    } }],
  });
  const temp = mkdtempSync(path.join(scratch, 'sequence-ui-'));
  let browser;
  try {
    execFileSync(process.execPath, ['node_modules/tailwindcss/lib/cli.js', '-i', 'src/app/globals.css', '-o', path.join(temp, 'styles.css')], { stdio: 'pipe' });
    const css = readFileSync(path.join(temp, 'styles.css'), 'utf8') + readFileSync('src/styles/design-tokens.css', 'utf8');
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    for (const theme of ['light', 'dark']) {
      const page = await browser.newPage({ viewport: { width: 380, height: 900 }, colorScheme: theme });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      const id = '10000000-0000-4000-8000-000000000001';
      const snapshotId = '20000000-0000-4000-8000-000000000001';
      const slots = ['Contacto inicial', 'Respaldo', 'Segundo ángulo', 'Cierre'].map((name, index) => ({ index, name, status: 'queued', draftId: null, versionId: null, subject: null, body: null }));
      let view = { id, status: 'running', stage: 'brief', error: null, retryAt: null, researchSnapshotId: snapshotId, styleProfileId: null, editorial: null, slots };
      let retries = 0;
      const requests = [];
      await page.route('**/*', async route => {
        const request = route.request(); requests.push([request.method(), new URL(request.url()).pathname]);
        if (new URL(request.url()).pathname === '/contact/sequence') return route.fulfill({ contentType: 'text/html', body: `<html class="${theme}"><head><style>${css}</style></head><body><div id="root"></div></body></html>` });
        assert.equal(new URL(request.url()).pathname, '/api/research-sequences');
        if (request.method() === 'POST') {
          const payload = request.postDataJSON();
          assert.equal(payload.researchSnapshotId, snapshotId);
          assert.equal(payload.styleProfileId, null);
          assert.equal(payload.instruction, 'más directa, por favor');
          return route.fulfill({ json: { id: '30000000-0000-4000-8000-000000000001', url: '/contact/sequence?jobId=30000000-0000-4000-8000-000000000001' } });
        }
        if (request.method() === 'PATCH') {
          retries++;
          assert.deepEqual(request.postDataJSON(), { jobId: id });
          await new Promise(resolve => setTimeout(resolve, 150));
          view = { ...view, status: 'review_required', stage: 'done', error: null, editorial: { passed: false, issues: ['Correo 2: cambia la apertura repetida.'], versionIds: ['v0', 'v1', 'v2', 'v3'] }, slots: slots.map((slot, index) => ({ ...slot, status: 'ready', draftId: `draft-${index}`, versionId: `v${index}`, subject: `Aplicación ${index + 1}`, body: 'Una aplicación concreta y autorizada.\n\n' + 'texto-largo-'.repeat(30) })) };
          return route.fulfill({ json: { ok: true } });
        }
        return route.fulfill({ json: view });
      });
      const open = async () => {
        await page.goto(`http://sequence.test/contact/sequence?jobId=${id}`);
        await page.evaluate(() => { const native = window.setTimeout; window.setTimeout = (fn, delay, ...args) => native(fn, delay === 5000 ? 40 : delay, ...args); });
        await page.addScriptTag({ content: output.outputFiles[0].text });
      };
      await open();
      await page.getByText('0 de 4 correos guardados', { exact: false }).waitFor();
      assert.equal(await page.locator('ol > li').count(), 4);
      assert.equal(await page.getByRole('link', { name: 'Revisar y editar correos' }).count(), 0);
      await page.getByLabel('Pedir otra versión a la IA').fill('más directa, por favor');
      await page.getByRole('button', { name: 'Preparar otra versión' }).click();
      await page.waitForFunction(() => window.__pushedUrl === '/contact/sequence?jobId=30000000-0000-4000-8000-000000000001');
      view = { ...view, stage: 'follow_ups', slots: slots.map((slot, index) => index < 2 ? { ...slot, status: 'ready', subject: `Guardado ${index}`, body: 'Texto guardado', draftId: `draft-${index}`, versionId: `v${index}` } : { ...slot, status: index === 2 ? 'running' : 'queued' }) };
      await page.getByText('2 de 4 correos guardados', { exact: false }).waitFor();
      view = { ...view, status: 'failed', error: 'No pudimos preparar el segundo ángulo.' };
      await page.getByRole('button', { name: 'Reintentar pendientes' }).click();
      await page.getByRole('button', { name: 'Reanudando…' }).waitFor();
      await page.getByText('Correo 2: cambia la apertura repetida.').waitFor();
      assert.equal(retries, 1);
      assert.equal(await page.getByRole('link', { name: 'Revisar y editar correos' }).getAttribute('href'), '/contact/compose?draftId=draft-0');
      for (const width of [320, 768, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${theme}/${width} overflow`);
        if (process.env.SEQUENCE_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.SEQUENCE_SCREENSHOT_DIR, `sequence-${theme}-${width}.png`), fullPage: true });
      }
      await page.getByRole('link', { name: 'Revisar y editar correos' }).focus();
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Revisar secuencia nuevamente');
      assert.notEqual(await page.evaluate(() => getComputedStyle(document.activeElement).boxShadow), 'none', 'keyboard focus must be visible');
      const contrast = await page.evaluate(() => {
        const luminance = color => {
          const rgb = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => { const c = value / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; });
          return .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];
        };
        const text = document.querySelector('section p.text-muted-foreground');
        const a = luminance(getComputedStyle(text).color), b = luminance(getComputedStyle(text.closest('section')).backgroundColor);
        return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
      });
      assert.ok(contrast >= 4.5, `${theme} secondary text contrast ${contrast}`);
      await open();
      await page.getByText('4 de 4 correos guardados', { exact: false }).waitFor();
      assert.equal(await page.locator('ol > li').count(), 4);
      assert.ok(!requests.some(([, pathname]) => /send|dispatch|approve/.test(pathname)));
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally { await browser?.close(); rmSync(temp, { recursive: true, force: true }); }
});

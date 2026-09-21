// Rendered fixture acceptance: no authentication, providers or production writes.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';

const scratch = path.join(process.env.LOCALAPPDATA, 'Temp/opencode');
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE
  || path.join(scratch, 'campaign-browser/node_modules/playwright/index.mjs')).href);
const output = await build({ stdin: { contents: `import React from 'react';
  import {createRoot} from 'react-dom/client'; import {ProfileReview} from './src/components/cowork/ProfileReview';
  const root=createRoot(document.getElementById('root'));
  window.renderReview=(id)=>root.render(<ProfileReview runId={id} resolving={false}
    onApprove={()=>window.approved=true} onReject={()=>window.rejected=true}/>);
  window.renderReview('valid');`, loader: 'tsx', resolveDir: process.cwd() },
  bundle: true, write: false, platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"test"' } });
const temp = mkdtempSync(path.join(scratch, 'cowork-profile-ui-'));
let browser;
try {
  execFileSync(process.execPath, ['node_modules/tailwindcss/lib/cli.js', '-i', 'src/app/globals.css', '-o', path.join(temp, 'styles.css')], { stdio: 'pipe' });
  const css = readFileSync(path.join(temp, 'styles.css'), 'utf8') + readFileSync('src/styles/design-tokens.css', 'utf8');
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width: 360, height: 850 }, colorScheme: theme });
    const errors = [], external = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'cowork.test') { external.push(url.href); return route.abort(); }
      if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: `<html class="${theme}"><head><style>${css}</style></head>
        <body class="bg-background text-foreground"><main class="mx-auto max-w-2xl p-4"><div id="root"></div></main></body></html>` });
      if (url.pathname.includes('/denied/')) return route.fulfill({ status: 403, json: { error: 'Acceso revocado' } });
      await new Promise(resolve => setTimeout(resolve, 150));
      return route.fulfill({ json: { matches: true, fresh: !url.pathname.includes('/stale/'), label: 'Firma',
        patch: { full_name: 'Ana', signatures: { profile_extended: { services: 'Consultoría comercial' },
          gmail: { enabled: true, html: '<p><b>Ana</b> · Consultoría</p><a href="https://example.com">Sitio</a>'
            + '<script>parent.compromised=true</script><img src="https://tracker.test/pixel">' } } } } });
    });
    await page.goto('http://cowork.test/');
    await page.addScriptTag({ content: output.outputFiles[0].text });
    await page.getByRole('status').waitFor();
    const approve = page.getByRole('button', { name: 'Aprobar y actualizar' });
    await approve.waitFor();
    assert.equal(await approve.isEnabled(), true);
    const iframe = page.locator('iframe');
    assert.equal(await iframe.getAttribute('sandbox'), '');
    await page.frameLocator('iframe').getByText('Ana', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.compromised), undefined);
    assert.deepEqual(external, []);
    for (const width of [360, 768, 1440]) {
      await page.setViewportSize({ width, height: 850 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${theme}/${width}`);
      if (process.env.COWORK_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.COWORK_SCREENSHOT_DIR, `profile-${theme}-${width}.png`), fullPage: true });
    }
    await page.getByRole('button', { name: 'Descartar' }).focus();
    await page.keyboard.press('Tab');
    assert.equal(await approve.evaluate(node => node === document.activeElement), true);
    assert.notEqual(await approve.evaluate(node => getComputedStyle(node).boxShadow), 'none');
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => window.approved), true);
    await page.evaluate(() => window.renderReview('stale'));
    await page.getByText('Tu perfil cambió desde la revisión.', { exact: false }).waitFor();
    assert.equal(await approve.isDisabled(), true);
    await page.evaluate(() => window.renderReview('denied'));
    await page.getByRole('alert').waitFor();
    assert.equal(await iframe.count(), 0);
    assert.equal(await approve.count(), 0);
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('PASS: profile review light/dark at 360/768/1440, keyboard, loading, drift, revocation and sandbox blocks scripts/network.');
} finally { await browser?.close(); rmSync(temp, { recursive: true, force: true }); }

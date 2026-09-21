// Rendered fixture acceptance for the remaining review cards: no
// authentication, providers or production writes.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';

const scratch = path.join(process.env.LOCALAPPDATA, 'Temp/opencode');
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE
  || path.join(scratch, 'campaign-browser/node_modules/playwright/index.mjs')).href);

const cards = {
  CrmRecordReview: {
    approve: 'Aprobar y actualizar', stale: 'La ficha cambió desde la revisión.',
    valid: { gid: 'lead_saved|x', patch: { stage: 'engaged' }, current: {}, matches: true, fresh: true, label: 'Ficha' },
  },
  CrmAssignReview: {
    approve: 'Asignar contacto', stale: 'La colaboración cambió desde la revisión.',
    valid: { op: 'assign', leadId: 'lead', assignedToUserId: 'u1', assignedToName: 'Ana', minutes: null,
      current: { assigned_to_user_id: null, claimed_by_user_id: null, claim_expires_at: null, contact_state: 'new' },
      names: { u1: 'Ana' }, matches: true, fresh: true, label: 'Asignar' },
  },
  ExceptionReview: {
    approve: 'Marcar resuelta', stale: 'La incidencia cambió desde la revisión.',
    valid: { action: 'resolved', reason: 'Reintentado y confirmado', current: { title: 'Fallo', status: 'open' },
      matches: true, fresh: true, label: 'Incidencia' },
  },
  MissionReview: {
    approve: 'Pausar misión', stale: 'La misión cambió desde la revisión.',
    valid: { targetStatus: 'paused', current: { title: 'Misión', status: 'active' }, matches: true, fresh: true, label: 'Misión' },
  },
  CampaignPrepareReview: {
    approve: 'Aprobar y preparar', stale: 'El paso cambió desde la revisión.',
    valid: { stepId: 'step', current: { state: 'ready', nativeDraftId: null }, matches: true, fresh: true, label: 'Paso' },
  },
  SavedSearchReview: {
    approve: 'Actualizar búsqueda', stale: 'La propuesta cambió desde la revisión.',
    valid: { op: 'update', matches: true, name: 'Directores', criteria: { title: 'Director' },
      isShared: false, label: 'Búsqueda' },
  },
  CampaignStopReview: {
    approve: 'Detener seguimiento', stale: 'descarta la propuesta', staleExtra: { stoppable: false },
    valid: { matches: true, label: 'Stop', campaignName: 'Campaña', campaignStatus: 'active',
      recipientName: 'Ana', recipientEmail: 'ana@example.com', enrollmentStatus: 'active', stoppable: true },
  },
};

const imports = Object.keys(cards).map(name => `import {${name}} from './src/components/cowork/${name}';`).join('\n');
const output = await build({ stdin: { contents: `import React from 'react';
  import {createRoot} from 'react-dom/client'; ${imports}
  const map = { ${Object.keys(cards).join(',')} };
  const root=createRoot(document.getElementById('root'));
  window.renderReview=(name,id)=>{ const Card=map[name]; root.render(<Card runId={id} resolving={false}
    onApprove={()=>window.approved=true} onReject={()=>window.rejected=true}/>); };
  window.renderReview('${Object.keys(cards)[0]}','valid');`, loader: 'tsx', resolveDir: process.cwd() },
  bundle: true, write: false, platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"test"' } });
const temp = mkdtempSync(path.join(scratch, 'cowork-reviews-ui-'));
let browser;
try {
  execFileSync(process.execPath, ['node_modules/tailwindcss/lib/cli.js', '-i', 'src/app/globals.css', '-o', path.join(temp, 'styles.css')], { stdio: 'pipe' });
  const css = readFileSync(path.join(temp, 'styles.css'), 'utf8') + readFileSync('src/styles/design-tokens.css', 'utf8');
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const theme of ['light', 'dark']) {
    for (const [name, card] of Object.entries(cards)) {
      const page = await browser.newPage({ viewport: { width: 360, height: 850 }, colorScheme: theme });
      const errors = [], external = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.hostname !== 'cowork.test') { external.push(url.href); return route.abort(); }
        if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: `<html class="${theme}"><head><style>${css}</style></head>
          <body class="bg-background text-foreground"><main class="mx-auto max-w-2xl p-4"><div id="root"></div></main></body></html>` });
        if (url.pathname.includes('/denied/')) return route.fulfill({ status: 403, json: { error: 'Acceso revocado' } });
        await new Promise(resolve => setTimeout(resolve, 100));
        return route.fulfill({ json: url.pathname.includes('/stale/')
          ? { ...card.valid, ...(card.staleExtra || {}), matches: false, fresh: false } : card.valid });
      });
      await page.goto('http://cowork.test/');
      await page.addScriptTag({ content: output.outputFiles[0].text });
      await page.evaluate(([cardName]) => window.renderReview(cardName, 'valid'), [name]);
      await page.getByRole('status').first().waitFor();
      const approve = page.getByRole('button', { name: card.approve });
      await approve.waitFor();
      assert.equal(await approve.isEnabled(), true, `${theme}/${name} approve enabled`);
      for (const width of [360, 1440]) {
        await page.setViewportSize({ width, height: 850 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${theme}/${name}/${width}`);
      }
      await page.getByRole('button', { name: 'Descartar' }).focus();
      await page.keyboard.press('Tab');
      assert.equal(await approve.evaluate(node => node === document.activeElement), true, `${theme}/${name} focus order`);
      await page.keyboard.press('Enter');
      assert.equal(await page.evaluate(() => window.approved), true, `${theme}/${name} keyboard approval`);
      await page.evaluate(([cardName]) => window.renderReview(cardName, 'stale'), [name]);
      await page.getByText(card.stale, { exact: false }).waitFor();
      assert.equal(await approve.isDisabled(), true, `${theme}/${name} drift blocks approval`);
      await page.evaluate(([cardName]) => window.renderReview(cardName, 'denied'), [name]);
      await page.getByRole('alert').waitFor();
      assert.equal(await approve.count(), 0, `${theme}/${name} revocation removes actions`);
      assert.deepEqual(errors, []);
      assert.deepEqual(external, []);
      await page.close();
    }
  }
  console.log('PASS: seven review cards render in light/dark at 360/1440, keyboard approval, drift and revocation without external requests.');
} finally { await browser?.close(); rmSync(temp, { recursive: true, force: true }); }

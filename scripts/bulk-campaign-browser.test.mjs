import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';

const { chromium } = await import(pathToFileURL(path.join(process.env.LOCALAPPDATA, 'Temp/opencode/campaign-browser/node_modules/playwright/index.mjs')).href);
test('campaign workspace: AI rank, manual filters, profiles, AI proposal, individual edit, rejection, approval, revision, history, responsive and keyboard', async () => {
  const output = await build({
    stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {BulkCampaignWorkspace} from './src/components/campaigns/BulkCampaignWorkspace'; createRoot(document.getElementById('root')).render(<BulkCampaignWorkspace/>);`, loader: 'tsx', resolveDir: process.cwd() },
    bundle: true, write: false, platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"test"' },
    plugins: [{ name: 'isolate-navigation-and-inbox', setup(build) {
      build.onResolve({ filter: /^(next\/link|@\/components\/campaigns-v2\/CampaignReviewInbox)$/ }, args => ({ path: args.path, namespace: 'mock' }));
      build.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ loader: 'jsx', resolveDir: process.cwd(), contents: args.path === 'next/link'
        ? `import React from 'react'; export default function Link(props){return <a {...props}/>}`
        : `import React from 'react'; export function CampaignReviewInbox(){return <p>Seguimientos de prueba</p>}` }));
    } }],
  });
  const temp = mkdtempSync(path.join(os.tmpdir(), 'campaign-ui-'));
  let browser;
  try {
    execFileSync(process.execPath, ['node_modules/tailwindcss/lib/cli.js', '-i', 'src/app/globals.css', '-o', path.join(temp, 'styles.css')], { env: process.env, stdio: 'pipe' });
    const css = readFileSync(path.join(temp, 'styles.css'), 'utf8') + readFileSync('src/styles/design-tokens.css', 'utf8');
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    for (const theme of ['light', 'dark']) {
      const page = await browser.newPage({ viewport: { width: 380, height: 900 }, colorScheme: theme });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      let saved = null;
      let assistCalls = 0;
      const assistInputs = [];
      const person = { email: 'ana@example.com', name: 'Ana Pérez', company: 'Empresa', reasons: ['Sin envíos registrados'], blockedReason: null };
      const ranked = { ...person, score: 88 };
      await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: `<html class="${theme}"><head><style>${css}</style></head><body><div id="root"></div></body></html>` });
        const body = route.request().postDataJSON();
        let result;
        if (url.pathname.endsWith('/audience/rank')) result = { people: [ranked], rankedCount: 1, candidateCount: 5, truncated: true, ineligibleCount: 1 };
        else if (url.pathname.endsWith('/audience')) result = { people: [person], total: 1, page: 0, pageSize: 25 };
        else if (url.pathname.endsWith('/assist')) {
          assistCalls++; assistInputs.push(body);
          await new Promise(resolve => setTimeout(resolve, 250));
          if (assistCalls === 1) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'No se pudo generar el correo. Vuelve a intentarlo.' }) });
          result = body.mode === 'sequence'
            ? { messages: [0, ...body.followUpDelays].map((delayDays, index) => ({ subject: `Correo ${index}`, body: `Mensaje completo ${index}`, delayDays })) }
            : { proposal: { subject: 'Propuesta de conversación', body: 'Hola Ana, ¿podemos conversar esta semana?', delayDays: 0 } };
        }
        else if (url.pathname.endsWith('/profiles')) result = route.request().method() === 'GET' ? { profiles: [] } : { profile: { id: 'profile', name: 'Perfil', criteria: {}, created_at: 'now' } };
        else if (url.pathname.endsWith('/history')) result = { recipient: { email: person.email, name: person.name }, events: [{ at: '2026-09-05T00:00:00Z', kind: 'campaign_sent', label: 'Correo inicial de campaña', detail: 'Asunto' }] };
        else if (url.pathname.endsWith('/revise')) {
          saved = { ...saved, status: 'draft', approved_at: null, revision: saved.revision + 1, definition: body.definition, recipients: [{ ...person,
            messages: body.definition.messages.map((message, index) => ({ ...message, draftId: `revised-${saved.revision + 1}-${index}`, versionId: `revised-version-${index}` })) }] };
          result = { campaign: saved };
        }
        else if (body?.action) { saved.status = body.action === 'approve' ? 'approved' : 'rejected'; saved.approved_at = body.action === 'approve' ? new Date().toISOString() : null; result = { campaign: saved }; }
        else if (route.request().method() === 'POST' || route.request().method() === 'PUT') {
          const definition = body.definition || body;
          saved = { id: 'campaign', revision: (saved?.revision || 0) + 1, status: 'draft', definition, review_hash: 'a'.repeat(64), recipients: [{ ...person,
            messages: definition.messages.map((message, index) => ({ ...message, ...(definition.overrides || []).find(value => value.messageIndex === index), draftId: `draft-${index}`, versionId: `version-${index}` })) }] };
          result = { campaign: saved };
        } else result = { campaigns: saved ? [saved] : [], automationEnabled: true };
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify(result) });
      });
      await page.goto('http://campaign.test/');
      await page.addScriptTag({ content: output.outputFiles[0].text });
      await page.getByRole('button', { name: 'Nueva campaña', exact: true }).click();
      await page.getByLabel('Nombre de campaña').fill('Campaña de prueba');
      await page.getByLabel('Describe tu lead ideal').fill('Reclutadores con poder de compra en empresas de retail');
      await page.getByRole('button', { name: 'Buscar leads ideales' }).click();
      await page.getByText('1 resultados', { exact: false }).waitFor();
      await page.getByText('evaluó 5 leads', { exact: false }).waitFor();
      await page.getByRole('button', { name: 'Seleccionar todos' }).click();
      assert.equal(await page.getByRole('checkbox', { name: /Ana Pérez/ }).isChecked(), true);
      await page.getByRole('button', { name: 'Filtros manuales' }).click();
      await page.getByLabel('Tamaño de empresa').fill('11-50');
      await page.getByLabel('Buscar en resultados').fill('ana');
      await page.getByRole('button', { name: 'Buscar con filtros' }).click();
      await page.getByText('Sin envíos registrados', { exact: true }).waitFor();
      await page.getByText('Perfiles de audiencia guardados', { exact: false }).click();
      await page.getByLabel('Nombre del perfil').fill('Perfil de prueba');
      await page.getByRole('button', { name: 'Guardar criterios actuales' }).click();
      await page.getByText('Perfil guardado.', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Continuar a correos' }).click();
      assert.equal(await page.getByRole('button', { name: 'Generar secuencia con IA', exact: true }).isDisabled(), true);
      const objective = 'Presentar el servicio AXIS y proponer una conversación sobre selección de colaboradores';
      await page.getByLabel('¿Qué quieres conseguir con la campaña?').fill(objective);
      assert.equal(await page.getByLabel('¿Cuántos seguimientos quieres?').inputValue(), '');
      assert.equal(await page.getByRole('button', { name: 'Generar secuencia con IA', exact: true }).isDisabled(), true);
      await page.getByLabel('¿Cuántos seguimientos quieres?').selectOption('2');
      await page.getByRole('button', { name: 'Seguimiento 1', exact: true }).click();
      await page.getByLabel('Días después del envío anterior').fill('5');
      await page.getByRole('button', { name: 'Primer correo', exact: true }).click();
      await page.getByRole('button', { name: 'Generar secuencia con IA', exact: true }).click();
      await page.getByRole('button', { name: 'Generando secuencia…' }).waitFor();
      await page.getByRole('alert').filter({ hasText: 'No se pudo generar el correo' }).waitFor();
      assert.equal(await page.getByLabel('¿Qué quieres conseguir con la campaña?').inputValue(), objective);
      assert.equal(await page.getByLabel('Correo', { exact: true }).inputValue(), '');
      assert.equal(await page.getByRole('alert').evaluate(el => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }), true);
      await page.getByRole('button', { name: 'Generar secuencia con IA', exact: true }).click();
      await page.getByText('Secuencia generada: 3 correos. Revisa cada mensaje antes de continuar.', { exact: true }).waitFor();
      assert.equal(assistInputs[1].objective, objective);
      assert.deepEqual(assistInputs[1].followUpDelays, [5, 3]);
      assert.equal(await page.getByLabel('Asunto', { exact: true }).inputValue(), 'Correo 0');
      await page.getByRole('button', { name: 'Seguimiento 2', exact: true }).click();
      assert.equal(await page.getByLabel('Correo', { exact: true }).inputValue(), 'Mensaje completo 2');
      await page.getByRole('button', { name: 'Seguimiento 1', exact: true }).click();
      assert.equal(await page.getByLabel('Días después del envío anterior').inputValue(), '5');
      for (const width of [320, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        const editor = await page.getByLabel('Correo', { exact: true }).boundingBox();
        const assistant = await page.getByRole('complementary', { name: 'Asistente de IA' }).boundingBox();
        assert.equal(width === 1280 ? assistant.x > editor.x + editor.width : assistant.y > editor.y, true);
        if (process.env.CAMPAIGN_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.CAMPAIGN_SCREENSHOT_DIR, `campaign-email-${theme}-${width}.png`), fullPage: true });
      }
      await page.setViewportSize({ width: 380, height: 900 });
      await page.getByLabel('Asunto', { exact: true }).fill('Asunto manual');
      await page.getByLabel('Correo', { exact: true }).fill('Texto manual que debe conservarse hasta aplicar la propuesta.');
      await page.getByLabel('¿Qué quieres cambiar en este correo?').fill('Hazlo más breve');
      await page.getByRole('button', { name: 'Proponer cambios con IA' }).click();
      await page.getByRole('heading', { name: 'Propuesta de IA' }).waitFor();
      assert.equal(await page.getByLabel('Asunto', { exact: true }).inputValue(), 'Asunto manual');
      await page.getByRole('button', { name: 'Aplicar propuesta', exact: true }).click();
      assert.equal(assistInputs.at(-1).messageIndex, 1);
      assert.equal(assistInputs.at(-1).sequenceContext.length, 3);
      assert.equal(await page.getByLabel('Días después del envío anterior').inputValue(), '5');
      await page.getByRole('button', { name: 'Primer correo', exact: true }).click();
      assert.equal(await page.getByLabel('Asunto', { exact: true }).inputValue(), 'Correo 0');
      await page.getByRole('button', { name: 'Proponer nueva secuencia' }).click();
      await page.getByRole('heading', { name: 'Nueva secuencia propuesta' }).waitFor();
      await page.getByRole('button', { name: 'Descartar secuencia' }).click();
      await page.getByRole('button', { name: 'Seguimiento 1', exact: true }).click();
      assert.equal(await page.getByLabel('Asunto', { exact: true }).inputValue(), 'Propuesta de conversación');
      await page.getByRole('button', { name: 'Guardar y revisar correos' }).click();
      await page.getByRole('button', { name: 'Editar correo inicial de esta persona' }).click();
      await page.getByLabel('Asunto individual').fill('Solo para Ana');
      assert.equal(await page.getByRole('button', { name: 'Aprobar campaña' }).isDisabled(), true);
      await page.getByRole('button', { name: 'Guardar edición individual' }).click();
      await page.getByRole('heading', { name: 'Solo para Ana', exact: true }).waitFor();
      for (const width of [320, 380, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${theme}/${width} overflow`);
      }
      await page.getByLabel('Vista previa por destinatario').focus();
      await page.keyboard.press('Tab');
      assert.notEqual(await page.evaluate(() => document.activeElement.tagName), 'BODY');
      await page.getByRole('button', { name: 'Rechazar y editar' }).click();
      await page.getByRole('heading', { name: 'Prepara tu secuencia de correos' }).waitFor();
      await page.getByRole('button', { name: 'Guardar y revisar correos' }).click();
      await page.getByRole('button', { name: 'Aprobar campaña' }).click();
      await page.getByRole('button', { name: 'Pausar campaña' }).waitFor();
      await page.getByText('Ver historial unificado', { exact: true }).click();
      await page.getByText('Correo inicial de campaña', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Editar mensajes pendientes' }).click();
      await page.getByRole('heading', { name: 'Edita los mensajes pendientes' }).waitFor();
      await page.getByLabel('Asunto', { exact: true }).fill('Asunto revisado');
      await page.getByRole('button', { name: 'Guardar pendientes y volver a revisión' }).click();
      await page.getByRole('button', { name: 'Aprobar campaña' }).click();
      await page.getByRole('button', { name: 'Pausar campaña' }).waitFor();
      assert.equal(saved.status, 'approved'); assert.deepEqual(errors, []);
      await page.close();
    }
  } finally { await browser?.close(); rmSync(temp, { recursive: true, force: true }); }
});

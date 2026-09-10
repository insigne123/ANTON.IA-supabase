// UI smoke with a mocked Chrome boundary. Does not contact LinkedIn, Supabase or providers.
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
try {
  for (const colorScheme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width: 380, height: 900 }, colorScheme });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.route(/^https?:/, route => route.abort());
    await page.addInitScript(() => {
      const listeners = [];
      const connection = { origin: 'https://app.antonia.ai', session: { userId: 'test-user', organizationId: 'test-org', organizationName: 'Equipo de pruebas', email: 'seller@example.test', researchEnabled: true, sequencesEnabled: true } };
      const profile = { linkedinUrl: 'https://www.linkedin.com/in/test-person', fullName: 'María Fernández', title: 'Directora de Personas', companyName: 'Empresa de prueba', email: 'maria@example.test', companyDomain: 'example.test', tabId: 12 };
      let connected = false;
      let saved = null;
      const row = { id: 'lead', full_name: profile.fullName, company_name: profile.companyName, title: profile.title, email: profile.email, linkedin_url: profile.linkedinUrl };
      const sessionStore = {};
      window.chrome = {
        runtime: { getManifest: () => ({ host_permissions: [] }), sendMessage: async request => {
          window.requests.push(request);
          let result;
          switch (request.action) {
            case 'PROSPECT_SESSION': result = connected ? connection : null; break;
            case 'PROSPECT_PROFILE': result = profile; break;
            case 'PROSPECT_CONNECT': connected = true; result = { pending: true }; setTimeout(() => listeners.forEach(fn => fn({ prospectConnection: {} }, 'session')), 10); break;
            case 'PROSPECT_PREPARE': result = { ok: true, status: 'prepared', message: 'Mensaje preparado. Envía desde LinkedIn.' }; break;
            case 'PROSPECT_API':
              if (request.body.action === 'enrich') result = { enriched: [{ linkedinUrl: profile.linkedinUrl, fullName: profile.fullName, title: profile.title, companyName: profile.companyName, email: profile.email, companyDomain: profile.companyDomain }] };
              if (request.body.action === 'campaigns') result = { campaigns: [{ id: 'campaign', revision: 1, name: 'Prospección de prueba', editable: true, recipientCount: 2, alreadyAdded: false }] };
              if (request.body.action === 'campaign-add') result = { revision: 2, alreadyAdded: false };
              if (request.body.action === 'lookup') result = { lead: saved };
              if (request.body.action === 'save') { saved = row; result = { lead: row }; }
              if (request.body.action === 'research-status') result = { research: null };
              if (request.body.action === 'message') result = { message: 'Hola María, ¿te parece si conversamos sobre tu equipo?', sources: [], personalized: false };
              break;
          }
          return { ok: true, result };
        } },
        storage: { session: { get: async key => ({ [key]: sessionStore[key] }), set: async items => Object.assign(sessionStore, items) }, onChanged: { addListener: fn => listeners.push(fn), removeListener() {} } },
        tabs: { onActivated: { addListener() {}, removeListener() {} }, onUpdated: { addListener() {}, removeListener() {} } },
      };
      window.requests = [];
    });
    await page.goto(pathToFileURL(resolve(root, 'chrome-extension/panel.html')).href);
    await page.getByRole('button', { name: 'Conectar Anton.IA' }).click();
    await page.getByRole('heading', { name: 'María Fernández' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Guardar lead', exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Enriquecer perfil', exact: true }).click();
    await page.getByRole('button', { name: 'Guardar lead', exact: true }).click();
    await page.getByText('Lead guardado en tu organización.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Contactar', exact: true }).click();
    await page.getByRole('button', { name: 'Redactar mensaje de LinkedIn' }).click();
    await page.getByRole('button', { name: 'Preparar en LinkedIn', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Preparar en LinkedIn' }).click();
    await page.getByText('Mensaje preparado. Envía desde LinkedIn.').waitFor();
    await page.getByText('Añadir a una campaña existente', { exact: true }).click();
    await page.getByRole('button', { name: 'Buscar mis campañas' }).click();
    await page.getByLabel('Campaña', { exact: true }).selectOption('campaign');
    await page.getByRole('button', { name: 'Añadir lead a la campaña' }).click();
    await page.getByText('Lead añadido. Revisa y aprueba la campaña desde la app para iniciar los envíos.').waitFor();
    assert.equal(await page.getByRole('button', { name: 'Añadir lead a la campaña' }).isDisabled(), true);
    assert.equal(await page.evaluate(() => window.requests.some(request => request.action === 'SEND_DM')), false);
    for (const width of [320, 380, 520]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Horizontal overflow at ${width}/${colorScheme}`);
      await page.getByLabel('URL de LinkedIn', { exact: true }).focus();
      await page.keyboard.press('Tab');
      assert.ok(await page.evaluate(() => document.activeElement.tagName !== 'BODY'));
    }
    if (process.env.EXTENSION_SCREENSHOT_DIR) {
      await page.setViewportSize({ width: 380, height: 900 });
      await page.screenshot({ path: resolve(process.env.EXTENSION_SCREENSHOT_DIR, `extension-contact-${colorScheme}.png`), fullPage: true });
    }
    await context.close();
    console.log(`PASS: ${colorScheme}, 320/380/520 px, connect/save/generate/prepare/campaign-add, keyboard focus, no horizontal overflow.`);
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); }

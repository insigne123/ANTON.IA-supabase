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
      window.activeProfile = profile;
      let connected = false;
      let saved = null;
      let researched = false;
      let sent = false;
      const row = { id: 'lead', full_name: profile.fullName, company_name: profile.companyName, title: profile.title, email: profile.email, email_status: 'verified', linkedin_url: profile.linkedinUrl };
      const sessionStore = {};
      window.chrome = {
        runtime: { getManifest: () => ({ host_permissions: [] }), sendMessage: async request => {
          window.requests.push(request);
          let result;
          switch (request.action) {
            case 'PROSPECT_SESSION': result = connected ? connection : null; break;
            case 'PROSPECT_PROFILE': result = window.activeProfile; break;
            case 'PROSPECT_CONNECT': connected = true; result = { pending: true }; setTimeout(() => listeners.forEach(fn => fn({ prospectConnection: {} }, 'session')), 10); break;
            case 'PROSPECT_PREPARE': result = { ok: true, status: 'prepared', message: 'Mensaje preparado. Envía desde LinkedIn.' }; break;
            case 'PROSPECT_SEND': result = sent ? { status: 'confirmed', duplicate: true } : { status: 'confirmed', eventId: 'new-event', synced: true }; sent = true; break;
            case 'PROSPECT_SYNC_SENDS': result = { count: 0 }; break;
            case 'PROSPECT_OPEN': result = true; break;
            case 'PROSPECT_API':
              if (request.body.action === 'phone-status') result = { phone: '+511234567', status: 'completed' };
              if (request.body.action === 'enrich') result = { enriched: [{ linkedinUrl: profile.linkedinUrl, fullName: profile.fullName, title: profile.title, companyName: profile.companyName, email: profile.email, companyDomain: profile.companyDomain, city: 'Lima', country: 'Perú', industry: 'Servicios', seniority: 'director' }] };
              if (request.body.action === 'enrich' && request.body.revealPhone && window.requests.filter(item => item.body?.action === 'enrich').length > 1) result = { enriched: [{ id: 'person-id', linkedinUrl: profile.linkedinUrl, enrichmentStatus: 'pending_phone' }] };
              if (request.body.action === 'campaigns') result = { campaigns: [{ id: 'campaign', revision: 1, name: 'Prospección de prueba', editable: true, recipientCount: 2, alreadyAdded: false }] };
              if (request.body.action === 'campaign-add') result = { revision: 2, alreadyAdded: false };
              if (request.body.action === 'lookup') result = { lead: request.body.profile.linkedinUrl === profile.linkedinUrl ? saved : null };
              if (request.body.action === 'save') { saved = { ...row, data: { extensionDetails: window.omitDetails ? {} : request.body.profile.details } }; result = { lead: saved }; }
              if (request.body.action === 'research') { researched = true; result = { status: 'queued' }; }
              if (request.body.action === 'research-status') result = { research: researched ? { status: 'partial', researchSnapshotId: 'snapshot', reportVersion: 'doc:1', reportSynthesisV2: { status: 'completed' }, reportDocumentV2: { synthesis: { status: 'completed' }, sections: [{ key: 'verdict', title: 'Resumen y decisión', paragraphs: [{ text: 'Análisis comercial de demostración.' }], blocks: [] }], evidenceGraph: {} }, result: { evidence: [{ id: 'fact', kind: 'fact', statement: 'Empresa de demostración', sourceUrl: 'https://example.test' }] } } : null };
              if (['sequence', 'email-draft'].includes(request.body.action)) result = { composeUrl: '/contact/compose?draftId=test' };
              if (request.body.action === 'research-status' && researched && !window.finalReportReady) result = { research: { status: 'partial', researchSnapshotId: 'snapshot', result: { evidence: [{ statement: 'Cita preliminar' }] }, reportSynthesisV2: { status: 'running' } } };
              if (request.body.action === 'message') result = { message: 'Hola María, ¿te parece si conversamos sobre tu equipo?', sources: [], personalized: false };
              break;
          }
          return { ok: true, result };
        } },
        storage: { local: { get: async key => ({ [key]: sessionStore[key] }), set: async items => Object.assign(sessionStore, items), remove: async key => { delete sessionStore[key]; } }, session: { get: async key => ({ [key]: sessionStore[key] }), set: async items => Object.assign(sessionStore, items), remove: async key => { delete sessionStore[key]; } }, onChanged: { addListener: fn => listeners.push(fn), removeListener() {} } },
        tabs: { onActivated: { addListener() {}, removeListener() {} }, onUpdated: { addListener() {}, removeListener() {} } },
      };
      window.requests = [];
    });
    await page.goto(pathToFileURL(resolve(root, 'chrome-extension/panel.html')).href);
    await page.getByRole('button', { name: 'Conectar Anton.IA' }).click();
    await page.getByRole('heading', { name: 'María Fernández' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Guardar lead', exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Enriquecer perfil', exact: true }).click();
    await page.getByText('Más información profesional', { exact: true }).click();
    await page.getByText('Lima, Perú', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Guardar lead', exact: true }).click();
    await page.getByText('Lead guardado en tu organización.', { exact: true }).waitFor();
    assert.equal(await page.getByText('Datos devueltos por Apollo.', { exact: false }).count(), 0);
    assert.equal(await page.getByRole('checkbox', { name: 'Email', exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Buscar teléfono', exact: true }).click();
    const phoneRequest = await page.evaluate(() => window.requests.filter(request => request.body?.action === 'enrich').at(-1));
    assert.equal(phoneRequest.body.revealEmail, false);
    assert.equal(phoneRequest.body.revealPhone, true);
    await page.waitForFunction(() => window.requests.some(request => request.body?.action === 'phone-status'));
    await page.waitForFunction(() => [...document.querySelectorAll('input')].some(input => input.value === '+511234567'));
    await page.getByText('Estado del correo: Verificado por proveedor', { exact: true }).waitFor();
    await page.evaluate(() => { window.omitDetails = true; });
    await page.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
    assert.equal(await page.getByText('Más información profesional', { exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Investigación', exact: true }).click();
    await page.getByRole('button', { name: 'Investigar lead', exact: true }).click();
    let downloads = 0;
    page.on('download', () => downloads++);
    await page.getByRole('button', { name: 'Actualizar estado', exact: true }).click();
    await page.getByText('Preparando el análisis comercial…', { exact: true }).waitFor();
    assert.equal(downloads, 0);
    assert.equal(await page.getByRole('button', { name: 'Descargar PDF', exact: true }).count(), 0);
    await page.evaluate(() => { window.finalReportReady = true; });
    await page.getByRole('button', { name: 'Actualizar estado', exact: true }).click();
    await page.getByText('Informe comercial listo', { exact: true }).waitFor();
    assert.equal(downloads, 0, 'Completing research must not download automatically');
    const manualDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Descargar PDF', exact: true }).click();
    assert.match((await manualDownload).suggestedFilename(), /AntonIA-investigacion.*\.pdf$/);
    await page.getByText('Análisis comercial de demostración.', { exact: true }).waitFor();
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
    await page.getByRole('button', { name: 'Crear secuencia de email', exact: true }).click();
    await page.getByRole('button', { name: 'Revisar correos en la app', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Revisar y enviar', exact: true }).click();
    assert.equal(await page.locator('.send-preview').textContent(), 'Hola María, ¿te parece si conversamos sobre tu equipo?');
    assert.ok(await page.locator('.send-confirm').evaluate(node => document.activeElement === node));
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Revisar y enviar', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Revisar y enviar', exact: true }).click();
    await page.getByRole('button', { name: 'Confirmar envío', exact: true }).click();
    await page.getByText('Mensaje confirmado en LinkedIn y guardado en el historial del contacto.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Mensaje enviado', exact: true }).isDisabled(), true);
    const draft = page.getByRole('textbox', { name: 'Mensaje de LinkedIn', exact: true });
    await draft.fill('Un borrador nuevo');
    await draft.fill('Hola María, ¿te parece si conversamos sobre tu equipo?');
    await page.getByRole('button', { name: 'Revisar y enviar', exact: true }).click();
    await page.getByRole('button', { name: 'Confirmar envío', exact: true }).click();
    await page.getByText('Este mensaje ya está registrado como enviado. No lo reenviamos.', { exact: true }).waitFor();
    await draft.fill('Hola María, ¿te parece si revisamos una propuesta para tu equipo?');
    await page.getByRole('button', { name: 'Revisar y enviar', exact: true }).click();
    for (const width of [320, 380, 520]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Horizontal overflow at ${width}/${colorScheme}`);
      await page.getByLabel('URL de LinkedIn', { exact: true }).focus();
      await page.keyboard.press('Tab');
      assert.ok(await page.evaluate(() => document.activeElement.tagName !== 'BODY'));
      assert.ok(await page.locator('.account').isVisible(), 'Account stays visible at narrow widths');
      assert.ok(await page.evaluate(() => {
        const main = document.querySelector('main').getBoundingClientRect();
        const feedback = document.querySelector('.feedback');
        if (!feedback) return true;
        const footer = feedback.getBoundingClientRect();
        return main.bottom <= footer.top + 1;
      }), 'Feedback must not cover the work area');
    }
    if (process.env.EXTENSION_SCREENSHOT_DIR) {
      await page.setViewportSize({ width: 380, height: 900 });
      await page.locator('.send-confirm').scrollIntoViewIfNeeded();
      await page.screenshot({ path: resolve(process.env.EXTENSION_SCREENSHOT_DIR, `extension-contact-${colorScheme}.png`), fullPage: true });
    }
    const rememberedMessage = await draft.inputValue();
    await page.evaluate(() => { window.activeProfile = { ...window.activeProfile, linkedinUrl: 'https://www.linkedin.com/in/another-profile', fullName: 'Otro perfil' }; });
    await page.waitForFunction(() => document.querySelector('#profile-url').value === 'https://www.linkedin.com/in/another-profile');
    await page.waitForTimeout(500);
    await page.evaluate(() => { window.activeProfile = { ...window.activeProfile, linkedinUrl: 'https://www.linkedin.com/in/test-person' }; });
    await page.waitForFunction(() => document.querySelector('#profile-url').value === 'https://www.linkedin.com/in/test-person');
    await page.waitForTimeout(500);
    assert.equal(await draft.inputValue(), rememberedMessage, 'Returning to a profile restores its draft without AI');
    assert.equal(downloads, 1, 'Returning to a profile must not download its report');
    const beforeOptions = await page.evaluate(() => window.requests.filter(request => request.action === 'PROSPECT_API' && request.body.action === 'message').length);
    await page.getByRole('button', { name: 'Crear 3 opciones con IA', exact: true }).click();
    await page.getByText('Opciones guardadas. Puedes alternar entre ellas sin volver a usar IA.', { exact: true }).waitFor();
    const afterOptions = await page.evaluate(() => window.requests.filter(request => request.action === 'PROSPECT_API' && request.body.action === 'message').length);
    assert.equal(afterOptions - beforeOptions, 3);
    await page.getByRole('combobox', { name: /Opciones guardadas/ }).selectOption('0');
    assert.equal(await page.evaluate(() => window.requests.filter(request => request.action === 'PROSPECT_API' && request.body.action === 'message').length), afterOptions);
    await page.evaluate(() => { window.activeProfile = { ...window.activeProfile, linkedinUrl: 'https://www.linkedin.com/in/another-profile' }; });
    await page.waitForFunction(() => document.querySelector('#profile-url').value === 'https://www.linkedin.com/in/another-profile');
    await page.getByLabel('Seguir el perfil abierto en LinkedIn', { exact: true }).uncheck();
    await page.evaluate(() => { window.activeProfile = { ...window.activeProfile, linkedinUrl: 'https://www.linkedin.com/in/third-profile' }; });
    await page.waitForTimeout(1800);
    assert.equal(await page.locator('#profile-url').inputValue(), 'https://www.linkedin.com/in/another-profile');
    await context.close();
    console.log(`PASS: ${colorScheme}, 320/380/520 px, connect/save/research/generate/prepare/campaign-add/sequence/send confirmation/replay, keyboard focus, no horizontal overflow (mocked boundary).`);
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); }

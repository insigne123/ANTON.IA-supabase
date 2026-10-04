// UI smoke with a mocked Chrome boundary. Does not contact LinkedIn, Supabase or providers.
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
  ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, headless: true } : { channel: 'chrome', headless: true });
const errors = [];
try {
  for (const colorScheme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width: 380, height: 900 }, colorScheme });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.route(/^https?:/, route => route.abort());
    await page.addInitScript(() => {
      const listeners = [];
      const profileListeners = [];
      const connection = { origin: 'https://app.antonia.ai', session: { userId: 'test-user', organizationId: 'test-org', organizationName: 'Equipo de pruebas', email: 'seller@example.test', researchEnabled: true, sequencesEnabled: true } };
      const profile = { linkedinUrl: 'https://www.linkedin.com/in/test-person', fullName: 'María Fernández', title: 'Directora de Personas', companyName: 'Empresa de prueba', email: 'maria@example.test', companyDomain: 'example.test', tabId: 12 };
      window.activeProfile = profile;
      // What LinkedIn's page does when another profile opens: the panel reads it then, not on a timer.
      window.navigateTo = (next, url = next.linkedinUrl) => {
        window.activeProfile = next;
        profileListeners.forEach(fn => fn({ action: 'ANTONIA_PROFILE_CHANGED' }, { id: 'test-extension', tab: { id: 12, active: true, url } }));
      };
      let connected = false;
      let saved = null;
      let researched = false;
      let sent = false;
      const row = { id: 'lead', full_name: profile.fullName, company_name: profile.companyName, title: profile.title, email: profile.email, email_status: 'verified', linkedin_url: profile.linkedinUrl };
      const sessionStore = {};
      window.chrome = {
        runtime: { id: 'test-extension', getManifest: () => ({ host_permissions: [] }),
          onMessage: { addListener: fn => profileListeners.push(fn), removeListener: fn => { const index = profileListeners.indexOf(fn); if (index >= 0) profileListeners.splice(index, 1); } },
          sendMessage: async request => {
          window.requests.push(request);
          let result;
          switch (request.action) {
            case 'PROSPECT_SESSION': result = connected ? connection : null; break;
            case 'PROSPECT_PROFILE': result = window.activeProfile; break;
            case 'PROSPECT_SEARCH_RESULTS': result = window.searchResults || null; break;
            case 'PROSPECT_COMPANY': result = window.companyPage || null; break;
            case 'PROSPECT_ACTIVITY': result = window.activity || { onProfile: true, posts: [{ text: 'Este año duplicamos el equipo de personas en Lima.', when: '2 sem', kind: 'post' }] }; break;
            case 'PROSPECT_PRESENCE': result = Object.fromEntries(request.urls.filter(url => window.presence?.[url]).map(url => [url, window.presence[url]])); break;
            case 'PROSPECT_CONNECT': connected = true; result = { pending: true }; setTimeout(() => listeners.forEach(fn => fn({ prospectConnection: {} }, 'session')), 10); break;
            case 'PROSPECT_PREPARE': result = { ok: true, status: 'prepared', message: 'Mensaje preparado. Envía desde LinkedIn.' }; break;
            case 'PROSPECT_SEND': result = sent ? { status: 'confirmed', duplicate: true } : { status: 'confirmed', eventId: 'new-event', synced: true }; sent = true; break;
            case 'PROSPECT_SYNC_SENDS': result = { count: 0 }; break;
            case 'PROSPECT_OPEN': result = true; break;
            case 'PROSPECT_API':
              if (request.body.action === 'phone-status') result = { phone: '+511234567', status: 'completed' };
              if (request.body.action === 'company') result = window.companyView;
              if (request.body.action === 'save-batch') result = { saved: request.body.profiles.map(({ linkedinUrl, fullName }) => ({ linkedinUrl, fullName })), already: [], blocked: [], failed: [] };
              if (request.body.action === 'quota') result = { credits: { used: 3, limit: 50, remaining: 47 } };
              if (request.body.action === 'enrich') result = { enriched: [{ linkedinUrl: profile.linkedinUrl, fullName: profile.fullName, title: profile.title, companyName: profile.companyName, email: profile.email, companyDomain: profile.companyDomain, city: 'Lima', country: 'Perú', industry: 'Servicios', seniority: 'director' }] };
              if (request.body.action === 'enrich' && request.body.revealPhone && window.requests.filter(item => item.body?.action === 'enrich').length > 1) result = { enriched: [{ id: 'person-id', linkedinUrl: profile.linkedinUrl, enrichmentStatus: 'pending_phone' }] };
              if (request.body.action === 'campaigns') result = { campaigns: [{ id: 'campaign', revision: 1, name: 'Prospección de prueba', editable: true, recipientCount: 2, alreadyAdded: false }] };
              if (request.body.action === 'campaign-add') result = { revision: 2, alreadyAdded: false };
              if (request.body.action === 'lookup') result = { lead: request.body.profile.linkedinUrl === profile.linkedinUrl ? saved : null };
              if (request.body.action === 'save') { saved = { ...row, data: { extensionDetails: window.omitDetails ? {} : request.body.profile.details } }; result = { lead: saved }; }
              if (request.body.action === 'research') { researched = true; result = { status: 'queued' }; }
              if (request.body.action === 'research-status') result = { research: researched ? { status: 'partial', researchSnapshotId: 'snapshot', reportVersion: 'doc:1', reportSynthesisV2: { status: 'completed' }, reportDocumentV2: { synthesis: { status: 'completed' }, sections: [
                { key: 'verdict', title: 'Resumen y decisión', paragraphs: [{ text: 'Análisis comercial de demostración.' }], blocks: [{ type: 'facts', title: 'Contexto confirmado', claimIds: [], payload: ['f_1234567890'] }] },
                { key: 'sources', title: 'Fuentes consultadas', paragraphs: [], blocks: [{ type: 'sources', title: null, claimIds: [], payload: ['src_1234567890'] }] },
              ], evidenceGraph: { facts: [{ id: 'f_1234567890', sourceId: 'src_1234567890', text: 'La empresa opera en Chile.' }], sources: [{ id: 'src_1234567890', title: 'Sitio oficial de la empresa', canonicalUrl: 'https://example.test/', url: 'https://example.test/' }] } }, result: { evidence: [{ id: 'fact', kind: 'fact', statement: 'Empresa de demostración', sourceUrl: 'https://example.test' }] } } : null };
              if (['sequence', 'email-draft'].includes(request.body.action)) result = { composeUrl: '/contact/compose?draftId=test' };
              if (request.body.action === 'research-status' && researched && !window.finalReportReady) result = { research: { status: 'partial', researchSnapshotId: 'snapshot', result: { evidence: [{ statement: 'Cita preliminar' }] }, reportSynthesisV2: { status: 'running' } } };
              if (request.body.action === 'message') result = { message: 'Hola María, ¿te parece si conversamos sobre tu equipo?', personalized: Boolean(request.body.recentActivity?.length), activityRead: request.body.recentActivity?.length || 0,
                sources: request.body.recentActivity?.length ? [{ kind: 'activity', activityKind: request.body.recentActivity[0].kind, when: request.body.recentActivity[0].when, text: request.body.recentActivity[0].text, statement: `Su publicación: «${request.body.recentActivity[0].text}»`, url: '' }] : [] };
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
    await page.getByText('47 créditos hoy', { exact: true }).waitFor();
    assert.match(await page.locator('.chips').textContent(), /^Sin guardar/);
    assert.equal(await page.getByRole('button', { name: 'Guardar lead', exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Enriquecer perfil', exact: true }).click();
    await page.getByText('Más información profesional', { exact: true }).click();
    await page.getByText('Lima, Perú', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Guardar lead', exact: true }).click();
    await page.getByText('Lead guardado en tu organización.', { exact: true }).waitFor();
    assert.match(await page.locator('.chips').textContent(), /Guardado.*Correo verificado/);
    // The next step is researching: the card offers it and the tab does not repeat it.
    await page.getByRole('button', { name: 'Investigar lead', exact: true }).waitFor();
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
    await page.getByRole('tab', { name: 'Investigación', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Investigar lead', exact: true }).count(), 1);
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
    await page.getByText('1: La empresa opera en Chile.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('link', { name: /Sitio oficial de la empresa/ }).getAttribute('href'), 'https://example.test/');
    assert.doesNotMatch(await page.locator('.evidence').textContent(), /payload|claim Ids|src_1234567890|f_1234567890|Type: facts/);
    for (const width of [320, 380, 520]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Research overflow at ${width}/${colorScheme}`);
    }
    assert.equal(downloads, 0, 'Completing research must not download automatically');
    const manualDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Descargar PDF', exact: true }).click();
    assert.match((await manualDownload).suggestedFilename(), /AntonIA-investigacion.*\.pdf$/);
    await page.getByText('Análisis comercial de demostración.', { exact: true }).waitFor();
    assert.match(await page.locator('.chips').textContent(), /Investigado/);
    await page.getByRole('button', { name: 'Escribir mensaje', exact: true }).click();
    assert.equal(await page.getByRole('tab', { name: 'Mensaje', exact: true }).getAttribute('aria-selected'), 'true');
    // Arrow keys move between the tabs, and back.
    await page.getByRole('tab', { name: 'Mensaje', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.getByRole('tab', { name: 'Más', exact: true }).getAttribute('aria-selected'), 'true');
    await page.getByRole('button', { name: 'Sincronizar historial de LinkedIn', exact: true }).waitFor();
    await page.keyboard.press('ArrowLeft');
    assert.equal(await page.getByRole('tab', { name: 'Mensaje', exact: true }).getAttribute('aria-selected'), 'true');
    await page.getByRole('button', { name: 'Redactar mensaje de LinkedIn' }).click();
    await page.getByRole('button', { name: 'Preparar en LinkedIn', exact: true }).waitFor();
    // The draft opens from the person's latest post, read from their open profile, and shows it above.
    await page.getByText('Abre desde su publicación · 2 sem', { exact: true }).waitFor();
    await page.getByText('«Este año duplicamos el equipo de personas en Lima.»', { exact: true }).waitFor();
    await page.getByText('Mensaje breve para LinkedIn. Abre desde su actividad reciente: revisa que la cita sea fiel.', { exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => JSON.stringify(window.requests.find(request => request.body?.action === 'message').body.recentActivity)),
      JSON.stringify([{ text: 'Este año duplicamos el equipo de personas en Lima.', when: '2 sem', kind: 'post' }]));
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
    // Someone else is working the next person: the card says so and asks to coordinate.
    await page.evaluate(() => { window.presence = { 'https://www.linkedin.com/in/another-profile': { label: 'En conversación con Ana', tone: 'warning', blocks: true } }; });
    await page.evaluate(() => { window.navigateTo({ ...window.activeProfile, linkedinUrl: 'https://www.linkedin.com/in/another-profile', fullName: 'Otro perfil' }); });
    await page.waitForFunction(() => document.querySelector('#profile-url').value === 'https://www.linkedin.com/in/another-profile');
    await page.getByText('En conversación con Ana. Coordina con tu equipo antes de escribirle.', { exact: true }).waitFor();
    assert.match(await page.locator('.chips').textContent(), /En conversación con Ana/);
    await page.waitForTimeout(500);
    await page.evaluate(() => { window.navigateTo({ ...window.activeProfile, linkedinUrl: 'https://www.linkedin.com/in/test-person' }); });
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
    await page.evaluate(() => { window.navigateTo({ ...window.activeProfile, linkedinUrl: 'https://www.linkedin.com/in/another-profile' }); });
    await page.waitForFunction(() => document.querySelector('#profile-url').value === 'https://www.linkedin.com/in/another-profile');
    await page.getByLabel('Seguir el perfil abierto en LinkedIn', { exact: true }).uncheck();
    await page.evaluate(() => { window.navigateTo({ ...window.activeProfile, linkedinUrl: 'https://www.linkedin.com/in/third-profile' }); });
    await page.waitForTimeout(500);
    assert.equal(await page.locator('#profile-url').inputValue(), 'https://www.linkedin.com/in/another-profile');
    // Nothing asks for the profile on a timer: without an announcement, the panel does not query.
    const asked = await page.evaluate(() => window.requests.filter(request => request.action === 'PROSPECT_PROFILE').length);
    await page.waitForTimeout(2000);
    assert.equal(await page.evaluate(() => window.requests.filter(request => request.action === 'PROSPECT_PROFILE').length), asked, 'no polling');
    // A LinkedIn people search: the people on screen, the one someone else works can't be chosen, and the rest save in one batch.
    await page.evaluate(() => {
      window.searchResults = { salesNavigator: false, results: [
        { linkedinUrl: 'https://www.linkedin.com/in/ana-rojas', fullName: 'Ana Rojas', headline: 'Jefa de Operaciones en Minera Norte', title: 'Jefa de Operaciones', companyName: 'Minera Norte' },
        { linkedinUrl: 'https://www.linkedin.com/in/another-profile', fullName: 'Otro perfil', headline: 'Gerente General', title: '', companyName: '' },
        { linkedinUrl: 'https://www.linkedin.com/in/luis-soto', fullName: 'Luis Soto', headline: 'Gerente de Personas at Logística Sur', title: 'Gerente de Personas', companyName: 'Logística Sur' },
      ] };
      window.navigateTo(null, 'https://www.linkedin.com/search/results/people/?keywords=operaciones');
    });
    await page.getByRole('heading', { name: '3 personas en esta búsqueda' }).waitFor();
    const searchCard = page.locator('section[aria-labelledby="search-heading"]');
    await searchCard.getByText('En conversación con Ana', { exact: true }).waitFor();
    assert.ok(await searchCard.getByRole('checkbox', { name: /Otro perfil/ }).isDisabled(), 'Someone else works this person: not selectable');
    assert.ok(await searchCard.getByRole('button', { name: 'Elige a quiénes guardar' }).isDisabled());
    await searchCard.getByRole('button', { name: 'Seleccionar disponibles' }).click();
    assert.ok(await searchCard.getByRole('checkbox', { name: /Ana Rojas/ }).isChecked());
    assert.ok(await searchCard.getByRole('checkbox', { name: /Luis Soto/ }).isChecked());
    for (const width of [320, 380, 520]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Horizontal overflow in the search at ${width}/${colorScheme}`);
    }
    const presenceAsked = await page.evaluate(() => window.requests.filter(request => request.action === 'PROSPECT_PRESENCE').length);
    await searchCard.getByRole('button', { name: 'Guardar 2 en Anton.IA' }).click();
    await page.getByText('2 contactos guardados en tu organización.', { exact: true }).waitFor();
    const batch = await page.evaluate(() => JSON.stringify(window.requests.filter(request => request.action === 'PROSPECT_API' && request.body.action === 'save-batch').map(request => request.body.profiles)));
    assert.deepEqual(JSON.parse(batch), [[
      { linkedinUrl: 'https://www.linkedin.com/in/ana-rojas', fullName: 'Ana Rojas', title: 'Jefa de Operaciones', companyName: 'Minera Norte', details: { headline: 'Jefa de Operaciones en Minera Norte' } },
      { linkedinUrl: 'https://www.linkedin.com/in/luis-soto', fullName: 'Luis Soto', title: 'Gerente de Personas', companyName: 'Logística Sur', details: { headline: 'Gerente de Personas at Logística Sur' } },
    ]]);
    await searchCard.getByRole('button', { name: 'Elige a quiénes guardar' }).waitFor();
    await page.waitForFunction(count => window.requests.filter(request => request.action === 'PROSPECT_PRESENCE').length > count, presenceAsked);
    // A company page: its facts, the organization's contacts there, the pilot's hiring signal and the search for its decision makers.
    await page.evaluate(() => {
      window.searchResults = null;
      window.companyPage = { linkedinUrl: 'https://www.linkedin.com/company/minera-norte', name: 'Minera Norte', industry: 'Minería', size: '1.001-5.000 empleados', headquarters: 'Antofagasta', website: 'https://mineranorte.cl', people: false, tabId: 12 };
      window.companyView = { total: 2, truncated: false, searchHref: '/search?company=Minera+Norte&domain=mineranorte.cl&titles=Gerente+de+Operaciones',
        contacts: [
          { name: 'Ana Rojas', title: 'Jefa de Operaciones', linkedinUrl: 'https://www.linkedin.com/in/ana-rojas', hasEmail: true, presence: { label: 'Respondió hace 2 días', tone: 'success', blocks: false } },
          { name: 'Luis Soto', title: 'Subgerente de Abastecimiento', linkedinUrl: '', hasEmail: false, presence: null },
        ],
        opportunity: { company: 'Minera Norte', ads: 6, score: 72, status: 'new', page: '/opportunities', signal: 'Minera Norte publicó 6 avisos de empleo en los últimos 30 días (4 de operador de camión y 2 de mantenedor), según LinkedIn.' } };
      window.navigateTo(null, 'https://www.linkedin.com/company/minera-norte/');
    });
    const companyCard = page.locator('section[aria-labelledby="company-heading"]');
    await companyCard.getByRole('heading', { name: 'Minera Norte' }).waitFor();
    await companyCard.getByText('Minería · 1.001-5.000 empleados · Antofagasta', { exact: true }).waitFor();
    await companyCard.getByRole('heading', { name: '2 contactos guardados' }).waitFor();
    await companyCard.getByText('Respondió hace 2 días', { exact: true }).waitFor();
    assert.equal(await companyCard.getByRole('link', { name: 'Ana Rojas' }).getAttribute('href'), 'https://www.linkedin.com/in/ana-rojas');
    await companyCard.getByText('Está contratando', { exact: true }).waitFor();
    const companyAsked = await page.evaluate(() => JSON.stringify(window.requests.filter(request => request.action === 'PROSPECT_API' && request.body.action === 'company').map(request => request.body.company)));
    assert.deepEqual(JSON.parse(companyAsked).at(-1), { linkedinUrl: 'https://www.linkedin.com/company/minera-norte', name: 'Minera Norte', domain: 'https://mineranorte.cl', industry: 'Minería', size: '1.001-5.000 empleados', headquarters: 'Antofagasta' });
    for (const width of [320, 380, 520]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Horizontal overflow in the company at ${width}/${colorScheme}`);
    }
    await companyCard.getByRole('button', { name: 'Buscar decisores en Anton.IA' }).click();
    await page.waitForFunction(() => window.requests.some(request => request.action === 'PROSPECT_OPEN' && request.path === '/search?company=Minera+Norte&domain=mineranorte.cl&titles=Gerente+de+Operaciones'));
    await companyCard.getByRole('button', { name: /Ver en Oportunidades/ }).click();
    await page.waitForFunction(() => window.requests.some(request => request.action === 'PROSPECT_OPEN' && request.path === '/opportunities'));
    // Its «Personas» tab: the same card, and the people on screen to save, named after the company.
    await page.evaluate(() => {
      window.companyPage = { ...window.companyPage, people: true };
      window.searchResults = { salesNavigator: false, results: [{ linkedinUrl: 'https://www.linkedin.com/in/carla-mena', fullName: 'Carla Mena', headline: 'Jefa de Turno', title: 'Jefa de Turno', companyName: 'Minera Norte' }] };
      window.navigateTo(null, 'https://www.linkedin.com/company/minera-norte/people/');
    });
    await page.getByRole('heading', { name: '1 persona de Minera Norte en pantalla' }).waitFor();
    assert.equal(await companyCard.getByRole('link', { name: /Ver sus personas en LinkedIn/ }).count(), 0, 'Already on its people tab');
    await context.close();
    console.log(`PASS: ${colorScheme}, 320/380/520 px, connect/credits/chips/next step/save/research/generate/prepare/campaign-add/sequence/send confirmation/replay, tabs by keyboard, profile changes by announcement without polling, search batch save with team presence, company card with contacts, hiring signal and decision makers, opening from a recent post, no horizontal overflow (mocked boundary).`);
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); }

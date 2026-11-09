// Journeys of what was asked for on 6 Nov 2026 and reviewed on 9 Nov: «Por escribir» with your leads first and the team's one
// click away, the campaign that says when your base is small, «Conversaciones» opening with a reply already suggested, and the
// signature of your Outlook or Gmail put on your emails without going to «Firmas y estilo». The model and the mailboxes do not
// run in the bench: the journeys answer with the bodies the server returns, and what is measured is the screen.

const OWNER = '00000000-0000-4000-8000-000000000011';

const json = body => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
const answer = (page, pattern, body, method = 'POST') => page.route(pattern, route => (route.request().method() === method ? route.fulfill(json(body)) : route.continue()));
const pressed = async (page, name) => (await page.getByRole('button', { name }).first().getAttribute('aria-pressed').catch(() => null)) === 'true';
const chip = (page, label, count) => page.getByRole('button', { name: new RegExp(`^${label}\\s*${count}$`) }).first().isVisible().catch(() => false);

// Two people the AI proposes from your own saved contacts (src/lib/bulk-campaigns.ts AudiencePerson), and how many you have.
const person = (email, name, company, title) => ({
  email, name, company, title, industry: 'Retail', country: 'Chile', size: '', seniority: '', leadRef: email, lastSentAt: null,
  contacted: false, replied: false, blockedReason: null, reasons: ['Su cargo decide la contratación'], enriched: true, score: 82,
});
const RANKED = {
  people: [person('andrea.soto@retailandino.cl', 'Andrea Soto', 'Retail Andino', 'Gerente de Personas'),
    person('valentina.araya@retailandino.cl', 'Valentina Araya', 'Retail Andino', 'Analista de Talento')],
  rankedCount: 2, candidateCount: 4, poolCount: 4, truncated: false, ineligibleCount: 0, excluded: {}, ownCount: 4,
};

// The signature Camila uses in Outlook, as /api/email-studio/mailbox-signature returns it (no images: the bench has no storage).
const MAILBOX = {
  provider: 'outlook', connected: ['outlook'],
  html: '<table><tr><td><b>Camila Torres</b><br>Gerente comercial · Yago QA<br><a href="https://yago-qa.cl">yago-qa.cl</a></td></tr></table>',
};

export default () => [
  { id: 'por-escribir-mis-leads-y-equipo', persona: 'owner', title: 'Ver primero mis leads y, con un clic, los del equipo con quién los encontró',
    goal: 'Que los números digan lo mismo que la lista que estoy mirando.',
    steps: [
      { say: 'Abro «Por escribir»: empieza en mis leads', do: async c => {
        await c.go('/saved/leads/enriched');
        await c.seeRole('button', /^Mis leads · 16$/);
        c.check('«Mis leads» viene elegido', await pressed(c.page, /^Mis leads/));
        c.check('«Todos» cuenta mis 16, no los 20 del equipo', await chip(c.page, 'Todos', 16));
        c.check('la lista dice 16 de 16', await c.has('16 de 16 contactos'));
        c.check('ningún lead mío dice quién lo encontró', !(await c.has('Lo encontró')));
      } },
      { say: 'Paso a «Todo el equipo»', do: async c => {
        await c.click({ name: /^Todo el equipo · 20$/ });
        await c.see('Lo encontró Diego Fuentes');
        c.check('«Todos» cuenta los 20 del equipo', await chip(c.page, 'Todos', 20));
        c.check('la lista dice 20 de 20', await c.has('20 de 20 contactos'));
      } },
    ] },
  { id: 'por-escribir-sin-leads-propios', persona: 'member', viewport: 'phone', title: 'Alguien nuevo, sin leads propios, entra a «Por escribir» (móvil)',
    goal: 'Entender por qué la lista está vacía y llegar a los del equipo sin buscar cómo.',
    // Every saved contact of the team was found by Camila: Diego has none yet.
    seed: tables => { for (const lead of tables.enriched_leads || []) lead.user_id = OWNER; },
    steps: [
      { say: 'Abro «Por escribir» sin leads propios', do: async c => {
        await c.go('/saved/leads/enriched');
        await c.see('Aún no tienes contactos propios');
        c.check('no dice «No hay contactos con estos filtros»', !(await c.has('No hay contactos con estos filtros')));
        c.check('ofrece buscar prospectos', await c.page.getByRole('button', { name: 'Buscar prospectos' }).first().isVisible().catch(() => false));
      } },
      { say: 'Pulso «Ver los del equipo»', do: async c => {
        await c.click('Ver los del equipo');
        await c.see('Lo encontró Camila Torres');
        c.check('queda elegido «Todo el equipo»', await pressed(c.page, /^Todo el equipo/));
      } },
    ] },
  { id: 'campana-base-chica', persona: 'owner', title: 'Armar una campaña con pocos leads propios',
    goal: 'Saber que mi base es chica y llegar a Cowork para buscar personas nuevas.',
    steps: [
      { say: 'Empiezo una campaña nueva y describo a quién quiero escribirle', do: async c => {
        await answer(c.page, '**/api/campaigns/bulk/audience/rank', RANKED);
        await c.go('/campaigns');
        // The list loaded: «Nueva campaña» is disabled while the campaigns load.
        await c.see('Reclutamiento masivo');
        await c.click('Nueva campaña');
        await c.seeRole('heading', '¿A quién quieres contactar?');
        await c.fill('Describe tu lead ideal', 'Gerentes de Personas de retail en Chile que contraten mucho');
      } },
      { say: 'Pulso «Buscar leads ideales»', do: async c => {
        await c.click('Buscar leads ideales');
        await c.see('es una base chica para una campaña');
        const href = await c.page.getByRole('link', { name: 'Buscar personas nuevas con Cowork' }).first().getAttribute('href').catch(() => '');
        c.check('el botón lleva a Cowork con lo que describí', /^\/cowork\?/.test(href || '') && /retail/i.test(decodeURIComponent(href || '')), href);
        c.check('los dos propuestos vienen elegidos', await c.has('Andrea Soto') && await c.has('Valentina Araya'));
      } },
    ] },
  { id: 'conversaciones-respuesta-sugerida', persona: 'owner', title: 'Abrir Conversaciones y encontrar la respuesta ya sugerida',
    goal: 'Leer quién me respondió y tener la respuesta escrita, sin pulsar «Traer respuestas» ni «Sugerir con IA».',
    steps: [
      { say: 'Abro Conversaciones', do: async c => {
        await answer(c.page, '**/api/replies/sync', { synced: 1, skippedNoToken: 0, errors: [], nextCursor: null });
        await answer(c.page, '**/api/antonia/replies/draft', { draft: { bodyText: 'Hola Andrea:\n\nEl jueves a las 10 me queda perfecto. Te envío la invitación.\n\nSaludos,\nCamila' } });
        await c.go('/contacted');
        await c.seeRole('heading', 'Responder a Andrea Soto');
        await c.page.waitForFunction(() => /jueves a las 10/.test(document.querySelector('#reply-body')?.value || ''), null, { timeout: 12000 });
        c.check('la respuesta viene escrita', true);
        c.check('dice que revisó las cuentas, en singular', await c.has('1 respuesta nueva.'));
      } },
    ] },
  { id: 'conversaciones-sin-sugerencia', persona: 'owner', title: 'Abrir Conversaciones cuando la IA y el correo no responden',
    goal: 'Que lo que no pedí y falló no aparezca como un error rojo.',
    steps: [
      { say: 'Abro Conversaciones con la IA y las cuentas sin responder', do: async c => {
        await c.go('/contacted');
        await c.seeRole('heading', 'Responder a Andrea Soto');
        await c.seeRole('button', 'Sugerir con IA');
        c.check('no hay un error rojo por la sugerencia', !(await c.has('No pudimos preparar una sugerencia')));
        c.check('quedan «Responder» y «Sugerir con IA»', await c.page.getByRole('button', { name: 'Responder', exact: true }).first().isVisible().catch(() => false));
        await c.see('No pudimos revisar tus correos ahora');
        c.check('no dice «No pudimos completar la consulta»', !(await c.has('No pudimos completar la consulta')));
      } },
    ] },
  { id: 'firma-automatica', persona: 'owner', title: 'Mi firma de Outlook va en mis correos sin configurarla',
    goal: 'Que los correos salgan con la firma de siempre, sin pasar por «Firmas y estilo».',
    steps: [
      { say: 'Entro a la app con Outlook conectado y sin firma guardada', do: async c => {
        await answer(c.page, '**/api/email-studio/mailbox-signature', MAILBOX, 'GET');
        await c.go('/dashboard');
        await c.see('Tu firma ya va en tus correos', { timeout: 20000 });
        const profile = c.table('profiles').find(row => row.id === OWNER) || {};
        const outlook = profile.signatures?.outlook || {};
        c.check('quedó activa para Outlook y Gmail', outlook.enabled === true && profile.signatures?.gmail?.enabled === true, JSON.stringify(Object.keys(profile.signatures || {})));
        c.check('es la de su correo', /Gerente comercial/.test(outlook.html || ''), String(outlook.html || '').slice(0, 120));
        c.check('lo demás del perfil sigue igual', Boolean(profile.signatures?.profile_extended), 'profile_extended');
      } },
      { say: 'Pulso «Revisar» en el aviso', do: async c => {
        await c.click({ name: /^Revisar$/ });
        await c.seeRole('heading', 'Firmas y estilo');
        await c.see('Gerente comercial · Yago QA');
        c.check('el diseño elegido es «Tu firma actual»', await c.page.getByRole('radio', { name: /Tu firma actual/ }).first().isChecked().catch(() => false));
      } },
      { say: 'Vuelvo a otra pantalla: no lo trae de nuevo', do: async c => {
        await c.go('/campaigns');
        await c.wait(6000);
        c.check('no repite el aviso', !(await c.has('Tu firma ya va en tus correos')));
      } },
    ] },
];


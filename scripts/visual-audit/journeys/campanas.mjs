// Journeys of «Campañas» (9 Nov 2026 review): the list, a draft in review with an e-mail edited for one person, a launched
// campaign (who answered, who did not get it and why, the approved e-mails), a paused one, a new campaign from the AI audience
// to the written sequence, the manual filters, the individual follow-ups and the archive. The model does not run in the
// bench: the journeys answer with the bodies the server returns, and what is measured is the screen.

const json = body => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
const answer = (page, pattern, body, method = 'POST') => page.route(pattern, route => (route.request().method() === method ? route.fulfill(json(body)) : route.continue()));
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const inFuture = days => new Date(Date.now() + days * 86_400_000).toISOString();
const followUp = (n, recipientName, recipientEmail, stepName, state, nextAction, dueAt) => ({
  stepId: uuid(900 + n), campaignId: uuid(800), enrollmentId: uuid(700 + n), campaignName: 'Primer contacto · Logística', recipientName, recipientEmail,
  stepName, state, dueAt, nativeDraftId: null, composeUrl: null, nextAction,
});
// The individual follow-ups (campaign_recipient_steps): one to review, one waiting its date, one held.
const INBOX = { enabled: true, items: [
  followUp(1, 'Florencia Sepúlveda', 'florencia.sepulveda@retailandino.cl', 'Seguimiento 1', 'ready_to_prepare', 'prepare', inFuture(-1)),
  followUp(2, 'Cristóbal Núñez', 'cristobal.nunez@logisticasur.cl', 'Seguimiento 2', 'not_due', 'prepare', inFuture(3)),
  followUp(3, 'Amanda Vargas', 'amanda.vargas@seguridadaustral.cl', 'Seguimiento 1', 'blocked', 'resolve', null),
], page: { limit: 25, returned: 3, hasMore: false, nextCursor: null }, summary: { scope: 'page', displayed: 3, pending: 2, attention: 1, campaigns: 1 } };

const person = (email, name, company, title, industry = 'Retail') => ({
  email, name, company, title, industry, country: 'Chile', size: '', seniority: 'manager', leadRef: email, lastSentAt: null,
  contacted: false, replied: false, blockedReason: null, reasons: ['Sin envíos registrados', `Cargo: ${title}`], enriched: true, score: 82,
});
const PEOPLE = [
  person('andrea.soto@retailandino.cl', 'Andrea Soto', 'Retail Andino', 'Gerente de Personas'),
  person('valentina.araya@retailandino.cl', 'Valentina Araya', 'Retail Andino', 'Analista de Talento'),
  person('matias.rojas@logisticasur.cl', 'Matías Rojas', 'Logística Sur', 'Jefe de Reclutamiento', 'Logística'),
  { ...person('francisca.munoz@seguridadaustral.cl', 'Francisca Muñoz', 'Seguridad Austral', 'Gerente de Operaciones', 'Seguridad'), blockedReason: 'No contactar o correo rebotado' },
];
const RANKED = { people: PEOPLE, rankedCount: 4, candidateCount: 12, poolCount: 16, truncated: false, ineligibleCount: 1, excluded: {}, ownCount: 16 };
const SEQUENCE = { messages: [
  { subject: '{{empresa}}: contrataciones sin revisar antecedentes a mano', body: 'Hola {{nombre}},\n\nCuando entra un grupo grande a {{empresa}}, revisar los antecedentes uno por uno deja turnos sin cubrir.\n\nAXIS consulta los antecedentes laborales de tus postulantes en el PJUD y procesa 1.000 personas en unos 30 minutos.\n\n¿Cuántos ingresos revisan al mes?', delayDays: 0 },
  { subject: 'RE: {{empresa}}: contrataciones sin revisar antecedentes a mano', body: 'Hola {{nombre}},\n\nRetomo mi correo anterior: ¿quién revisa hoy los antecedentes de los postulantes en {{empresa}}?', delayDays: 3 },
  { subject: '{{empresa}}: un ejemplo en retail', body: 'Hola {{nombre}},\n\nEn temporada alta, una cadena de retail revisó 800 postulantes en una tarde con AXIS.\n\n¿Les serviría algo así para diciembre?', delayDays: 4 },
  { subject: 'Cierro el tema por ahora', body: 'Hola {{nombre}},\n\nNo quiero llenar tu bandeja. Si más adelante revisar antecedentes se vuelve un cuello de botella, aquí estoy.', delayDays: 7 },
] };

const openList = async c => { await c.go('/campaigns'); await c.see('Reclutamiento masivo'); };
const newCampaign = async c => { await openList(c); await c.click('Nueva campaña'); await c.seeRole('heading', '¿A quién quieres contactar?'); };

const journeys = () => [
  { id: 'campanas-lista', persona: 'owner', title: 'Ver mis campañas', goal: 'Saber de un vistazo cuáles salieron, cómo van y cuál espera algo de mí.',
    steps: [{ say: 'Abro Campañas', do: openList }] },
  { id: 'campanas-lista-telefono', persona: 'owner', viewport: 'phone', title: 'Ver mis campañas (móvil)', steps: [{ say: 'Abro Campañas en el teléfono', do: openList }] },
  { id: 'campanas-borrador-revision', persona: 'owner', title: 'Revisar un borrador antes de aprobarlo', goal: 'Ver cómo le llega a cada persona y aprobar.',
    steps: [
      { say: 'Abro el borrador', do: async c => { await openList(c); await c.click({ name: /Reclutamiento masivo · retail/ }); await c.see('Qué pasa al aprobar'); } },
      { say: 'Miro a otra persona', do: async c => { await c.click({ name: /Cristóbal Núñez/ }); } },
      { say: 'Edito el primer correo solo para él', do: async c => {
        await c.click({ name: /^Editar solo para esta persona: primer correo de Cristóbal/ });
        await c.see('Editar solo para Cristóbal Núñez');
        c.check('«Aprobar campaña» espera mientras edito', await c.page.getByRole('button', { name: 'Aprobar campaña' }).isDisabled());
      } },
      { say: 'Cancelo y vuelvo a los correos', do: async c => { await c.click('Cancelar'); await c.click('Editar correos'); await c.seeRole('heading', 'Prepara tu secuencia de correos'); } },
    ] },
  { id: 'campanas-borrador-telefono', persona: 'owner', viewport: 'phone', title: 'Revisar un borrador (móvil)',
    steps: [{ say: 'Abro el borrador en el teléfono', do: async c => { await openList(c); await c.click({ name: /Reclutamiento masivo · retail/ }); await c.see('Qué pasa al aprobar'); } }] },
  { id: 'campanas-aprobada', persona: 'owner', title: 'Ver cómo va una campaña lanzada', goal: 'Saber a quién le llegó, quién falló y qué sigue.',
    steps: [
      { say: 'Abro la campaña aprobada', do: async c => { await openList(c); await c.click({ name: /Logística · centros de distribución/ }); await c.see('Correos enviados'); } },
      { say: 'Veo quién respondió y quién no recibió', do: async c => {
        await c.see('Respondió'); await c.see('No salió');
        c.check('El envío de Outlook confirmado no aparece como problema', !(await c.page.getByText('pendiente de confirmación').count()));
      } },
      { say: 'Abro el historial de Florencia', do: async c => { await c.page.getByText('Ver historial').first().click(); await c.see('Correo inicial de campaña'); } },
      { say: 'Miro los correos aprobados', do: async c => { await c.click('Correos aprobados'); await c.see('Primer correo'); } },
    ] },
  { id: 'campanas-aprobada-telefono', persona: 'owner', viewport: 'phone', title: 'Ver cómo va una campaña (móvil)',
    steps: [{ say: 'Abro la campaña aprobada en el teléfono', do: async c => { await openList(c); await c.click({ name: /Logística · centros de distribución/ }); await c.see('Correos enviados'); } }] },
  { id: 'campanas-pausada', persona: 'owner', title: 'Retomar una campaña en pausa', goal: 'Saber que está detenida y reanudarla.',
    steps: [{ say: 'Abro la campaña en pausa', do: async c => { await openList(c); await c.click({ name: /Minería · contratistas/ }); await c.seeRole('button', 'Reanudar campaña'); } }] },
  { id: 'campanas-nueva-ia', persona: 'owner', title: 'Crear una campaña con la audiencia de la IA', goal: 'De la descripción a la secuencia escrita, con pocos clics.',
    steps: [
      { say: 'Empiezo una campaña nueva', do: async c => { await answer(c.page, '**/api/campaigns/bulk/audience/rank', RANKED); await answer(c.page, '**/api/campaigns/bulk/assist', SEQUENCE); await newCampaign(c); } },
      { say: 'Describo a quién y busco', do: async c => {
        await c.fill('Describe tu lead ideal', 'Gerentes de Personas y jefes de reclutamiento de retail y logística en Chile');
        await c.click('Buscar leads ideales'); await c.see('Andrea Soto');
      } },
      { say: 'Paso a los correos', do: async c => { await c.click('Continuar a correos'); await c.seeRole('heading', 'Prepara tu secuencia de correos'); } },
      { say: 'Genero la secuencia con IA', do: async c => { await c.click('Generar secuencia con IA'); await c.see('Secuencia generada'); } },
      { say: 'Miro un seguimiento', do: async c => { await c.click({ name: /^Seguimiento 2/ }); } },
    ] },
  { id: 'campanas-nueva-ia-telefono', persona: 'owner', viewport: 'phone', title: 'Crear una campaña (móvil)',
    steps: [
      { say: 'Empiezo una campaña nueva en el teléfono', do: async c => { await answer(c.page, '**/api/campaigns/bulk/audience/rank', RANKED); await answer(c.page, '**/api/campaigns/bulk/assist', SEQUENCE); await newCampaign(c); } },
      { say: 'Busco con IA', do: async c => { await c.fill('Describe tu lead ideal', 'Gerentes de Personas de retail en Chile'); await c.click('Buscar leads ideales'); await c.see('Andrea Soto'); } },
      { say: 'Genero la secuencia', do: async c => { await c.click('Continuar a correos'); await c.click('Generar secuencia con IA'); await c.see('Secuencia generada'); } },
    ] },
  { id: 'campanas-filtros', persona: 'owner', title: 'Buscar la audiencia con filtros', goal: 'Elegir por cargo, industria y país sin describir con IA.',
    steps: [
      { say: 'Paso a filtros manuales', do: async c => { await answer(c.page, '**/api/campaigns/bulk/audience', { people: PEOPLE, total: 4, page: 0 }); await newCampaign(c); await c.click('Filtros manuales'); } },
      { say: 'Busco con los filtros', do: async c => { await c.fill('Cargos (separados por comas)', 'Gerente de Personas, Jefe de Reclutamiento'); await c.click('Buscar con filtros'); await c.see('Andrea Soto'); } },
    ] },
  { id: 'campanas-seguimientos', persona: 'owner', title: 'Ver los seguimientos individuales', steps: [{ say: 'Abro Seguimientos individuales', do: async c => { await openList(c); await c.click({ role: 'tab', name: 'Seguimientos individuales' }); await c.wait(1500); } }] },
  { id: 'campanas-seguimientos-con-datos', persona: 'owner', title: 'Revisar los seguimientos individuales en curso',
    steps: [
      { say: 'Abro Seguimientos individuales', do: async c => { await answer(c.page, '**/api/campaigns/v2/inbox', INBOX, 'GET'); await openList(c); await c.click({ role: 'tab', name: 'Seguimientos individuales' }); await c.see('Florencia Sepúlveda'); } },
      { say: 'Miro los que necesitan atención', do: async c => { await c.click({ name: /^Atención/ }); await c.see('Amanda Vargas'); } },
    ] },
  { id: 'campanas-historial', persona: 'owner', title: 'Ver campañas anteriores', steps: [{ say: 'Abro campañas anteriores', do: async c => { await c.go('/campaigns/history'); await c.see('Bienvenida 2025'); } }] },
];

export default journeys;

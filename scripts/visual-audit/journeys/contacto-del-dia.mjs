// Journeys of «Contacto del día» found with Apollo (3 Nov 2026, fixtures/lead-drops.mjs): why we recommend the contact, the first email
// and its three follow-ups, and how it looks once «Enriquecer y guardar» found the email. The lookup spends a credit and the bench writes
// nothing, so the saved state is answered with the shape GET /api/lead-drops/<id> returns after linkDropLead.
const DROP = '00000000-0000-4000-8000-000000000951';
const ENRICHED = '00000000-0000-4000-8000-000000002001';

/** The drop as the server answers it once the contact is in «Por escribir» with its real name. */
async function answerSaved(page) {
  await page.route(`**/api/lead-drops/${DROP}`, async route => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    body.items = body.items.map(item => ({ ...item, name: 'Carolina Vega', keptLeadId: 'kept-1', savedLeadId: ENRICHED }));
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

const steps = [
  { say: 'Abro mi contacto del día', do: async c => { await c.go(`/search/contactos/${DROP}`); await c.see('Por qué te lo recomendamos'); } },
  { say: 'Leo por qué me lo recomiendan y cuánto cuesta ver su correo', do: async c => {
    c.check('dice que ver su correo usa 1 crédito', await c.has('Ver su correo y guardarlo usa 1 crédito'));
    c.check('no muestra el apellido con asteriscos', !(await c.has('***')));
    c.check('la acción principal es «Enriquecer y guardar · 1 crédito»', await c.has('Enriquecer y guardar · 1 crédito'));
  } },
  { say: 'Abro los tres seguimientos', do: async c => {
    await c.click({ name: /Si no responde: 3 seguimientos/ });
    await c.see('Seguimiento 3 · día 11');
  } },
];

// ─── Several contacts a day (12 Nov 2026): a card each, to review, enrich, change and approve ─────────────────────────────────────
// The bench's drop has one contact, so the six are answered here with the shape GET /api/lead-drops/<id> returns for a team whose
// plan says six, and the actions with what POST answers (src/lib/server/lead-drop-campaign.ts). Fictional people and companies.
const id = n => `6accdbfcd5f5d80001cf69${String(n).padStart(2, '0')}`;
const emails = company => ({
  draft: { subject: `Respuesta ante emergencias en ${company}`, body: `Hola {{nombre}},\n\nVi que ${company} está ampliando su operación. Cuando se suma una faena, la brigada propia suele quedar corta en los turnos de noche.\n\nEn Resguardo Norte cubrimos esos turnos con brigadas entrenadas y cobertura aérea.\n\n¿Cómo lo están resolviendo hoy?\n\nSaludos,\nCamila` },
  followUps: [
    { day: 3, subject: 'Re: respuesta ante emergencias', body: 'Hola {{nombre}},\n\n¿Quién ve hoy los planes de emergencia de las faenas nuevas?\n\nSaludos,\nCamila' },
    { day: 7, subject: 'Un caso parecido', body: 'Hola {{nombre}},\n\nA una operación como la suya le armamos la brigada de los turnos de noche en tres semanas. ¿Te sirve ver cómo fue?\n\nSaludos,\nCamila' },
    { day: 11, subject: 'Cierro por ahora', body: 'Hola {{nombre}},\n\nEs mi último correo. Si más adelante revisan su respuesta ante emergencias, quedo atenta.\n\nSaludos,\nCamila' },
  ],
});
const contact = (n, name, title, company, extra = {}) => ({
  leadId: id(n), name, title, company, domain: null, industry: 'Minería', size: null, city: 'Antofagasta', state: null, country: 'Chile', hasEmail: true, hasPhone: false,
  provider: 'apollo', research: [], seniority: 'Gerencia o jefatura', department: null, website: `https://${company.toLowerCase().replace(/[^a-z]/g, '')}.example`,
  why: 'Calza con el cliente ideal de tu empresa por su cargo y su rubro (minería), en Antofagasta.',
  fit: [{ criterion: 'Cargo', theirs: title, wanted: 'Gerente HSE, Jefe de Prevención de Riesgos y 3 más', match: 'yes' },
    { criterion: 'Rubro', theirs: 'Minería', wanted: 'Minería, Energía, Forestal y 3 más', match: 'yes' },
    { criterion: 'Lugar', theirs: 'Antofagasta, Chile', wanted: 'Chile', match: 'yes' }],
  reasons: ['Su cargo suele decidir la contratación de brigadas y planes de emergencia.'],
  brief: { company: `${company} produce cobre en dos faenas de la Región de Antofagasta.`,
    news: { text: 'Anunció una planta concentradora nueva que parte en 2027.', date: '3 nov 2026', source: 'Diario del Norte', url: 'https://diariodelnorte.example/planta-nueva' },
    fit: 'Una planta nueva suma áreas y turnos que hoy no tienen brigada.', role: 'Responde por la seguridad de las faenas y por cumplir ante la autoridad.',
    opener: 'Pregúntale cómo van a cubrir la respuesta ante emergencias en la planta nueva.' },
  ...emails(company), ...extra,
});
const SIX = [
  contact(1, 'Rodrigo Sa***o', 'Gerente HSE', 'Minera Aurora'),
  contact(2, 'Paula Reyes', 'Superintendenta de Seguridad', 'Cobres del Loa', { savedLeadId: ENRICHED, keptLeadId: 'kept-2' }),
  contact(3, 'Marcela Di***z', 'Jefa de Prevención de Riesgos', 'Energía Atacama', { industry: 'Energía' }),
  contact(4, 'Tomás Ib***a', 'Jefe de Emergencias', 'Forestal Los Robles', { industry: 'Forestal', city: 'Concepción', brief: undefined }),
  contact(5, 'Ignacio Mu***z', 'Jefe de Mantención de Planta', 'Celulosa Biobío', { track: 'explore', industry: 'Celulosa', city: 'Concepción',
    why: 'Su cargo es vecino a los que buscas, en tu rubro objetivo (celulosa), en Concepción: te lo proponemos para probar si también te sirve.',
    fit: [{ criterion: 'Cargo', theirs: 'Jefe de Mantención de Planta', wanted: 'Gerente HSE, Jefe de Prevención de Riesgos y 3 más', match: 'partial' }] }),
  contact(6, 'Valentina Co***s', 'Encargada de Protección Industrial', 'Puerto Mejillones', { track: 'explore', industry: 'Puertos',
    why: 'Su cargo es vecino a los que buscas, en tu rubro objetivo (puertos): te lo proponemos para probar si también te sirve.' }),
];
const answered = body => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
/** The six contacts and what each action answers; the page keeps what the last answer said, as with the server. */
async function answerSix(page) {
  let items = SIX;
  await page.route(`**/api/lead-drops/${DROP}`, async route => {
    if (route.request().method() === 'GET') return route.fulfill(answered({ id: DROP, date: '2026-11-13', items,
      criteria: { titles: ['Gerente HSE', 'Jefe de Prevención de Riesgos', 'Superintendente de Seguridad'], industries: ['Minería', 'Energía', 'Forestal'], locations: ['Chile'], sizes: [], source: 'empresa' } }));
    const body = route.request().postDataJSON() || {};
    const change = patch => { items = items.map(item => item.leadId === body.leadId ? { ...item, ...patch(item) } : item); };
    if (body.action === 'approve') {
      const campaign = { id: '00000000-0000-4000-8000-00000000c001', provider: 'google', approvedAt: '2026-11-13T12:00:00.000Z' };
      change(() => ({ campaign }));
      return route.fulfill(answered({ items, campaign, provider: 'Gmail', schedule: ['2026-11-13', '2026-11-16', '2026-11-20', '2026-11-24'] }));
    }
    if (body.action === 'edit') change(item => ({ edited: true, draft: body.emails.draft, followUps: item.followUps.map((step, index) => ({ day: step.day, ...body.emails.followUps[index] })) }));
    if (body.action === 'feedback') change(() => ({ feedback: { ...body.feedback, at: '2026-11-13T12:00:00.000Z' } }));
    return route.fulfill(answered({ items }));
  });
}
const card = (c, name) => c.page.locator('article').filter({ hasText: name });
const sixSteps = [
  { say: 'Abro mis seis contactos del día', do: async c => { await answerSix(c.page); await c.go(`/search/contactos/${DROP}`); await c.see('6 contactos nuevos'); } },
  { say: 'Leo por qué me recomiendan al primero y qué le está pasando a su empresa', do: async c => {
    c.check('hay una tarjeta por contacto', await c.page.locator('article').count() === 6);
    c.check('dice por qué le sirve lo que vendo', await c.has('Una planta nueva suma áreas y turnos que hoy no tienen brigada.'));
    c.check('la novedad trae su medio y su fecha', await c.has('Diario del Norte, 3 nov 2026'));
    c.check('dice cómo abrir', await c.has('Pregúntale cómo van a cubrir la respuesta ante emergencias en la planta nueva.'));
    c.check('los cargos vecinos se dicen como exploración', await c.page.getByText('Para explorar').count() === 2);
    c.check('sin su correo, el paso es enriquecer', await card(c, 'Rodrigo S.').getByRole('button', { name: 'Enriquecer · 1 crédito' }).count() === 1);
  } },
  { say: 'Abro la campaña del segundo: el primer correo y cuándo saldría cada seguimiento', do: async c => {
    await card(c, 'Paula Reyes').getByRole('button', { name: /Campaña lista/ }).click();
    await c.see('Seguimiento 3 ·');
    c.check('cada seguimiento dice que va solo si no responde', await card(c, 'Paula Reyes').getByText('si no responde').count() === 3);
  } },
  { say: 'Cambio el asunto del primer correo y lo guardo', do: async c => {
    await card(c, 'Paula Reyes').getByRole('button', { name: 'Editar los correos' }).click();
    await card(c, 'Paula Reyes').getByLabel('Asunto').first().fill('Brigadas para los turnos de noche');
    await card(c, 'Paula Reyes').getByRole('button', { name: 'Guardar cambios' }).click();
    await c.see('Guardamos tus cambios en los correos de Paula Reyes.');
    c.check('el correo muestra mi asunto', await card(c, 'Paula Reyes').getByText('Brigadas para los turnos de noche').count() === 1);
  } },
  { say: 'Apruebo y programo su campaña', do: async c => {
    await card(c, 'Paula Reyes').getByRole('button', { name: 'Aprobar y programar' }).click();
    await c.see('Campaña de Paula Reyes programada desde Gmail');
    c.check('dice cuándo salen los seguimientos', await c.has('los seguimientos el lun 16 nov, el vie 20 nov y el mar 24 nov'));
    c.check('la tarjeta queda con su campaña en curso', await card(c, 'Paula Reyes').getByText('Campaña en curso').count() === 1);
    c.check('lleva a «Campañas»', await card(c, 'Paula Reyes').getByRole('link', { name: 'Ver la campaña' }).count() === 1);
  } },
  { say: 'Digo que uno no me sirve, y por qué', do: async c => {
    await card(c, 'Ignacio M.').getByRole('button', { name: 'No me sirve' }).click();
    await card(c, 'Ignacio M.').getByRole('button', { name: 'El cargo no decide' }).click();
    await c.see('Dijiste que no te sirve (el cargo no decide): lo tendremos en cuenta.');
  } },
];

export default () => [
  { id: 'contacto-apollo', persona: 'owner', title: 'Contacto del día con Apollo: por qué, el correo y sus seguimientos',
    goal: 'Ver a quién escribirle y por qué, el primer correo y los tres seguimientos, y saber que ver su correo cuesta 1 crédito.', steps },
  { id: 'contacto-apollo-telefono', persona: 'owner', viewport: 'phone', title: 'Contacto del día con Apollo (móvil)',
    goal: 'Lo mismo en una pantalla angosta, sin desbordes.', steps },
  { id: 'contacto-apollo-guardado', persona: 'owner', title: 'Después de «Enriquecer y guardar»',
    goal: 'Con su correo ya en «Por escribir», el siguiente paso es escribirle desde ANTON.IA.',
    steps: [
      { say: 'Abro el contacto ya enriquecido', do: async c => { await answerSaved(c.page); await c.go(`/search/contactos/${DROP}`); await c.see('Carolina Vega'); } },
      { say: 'El siguiente paso es investigarlo y escribirle', do: async c => {
        c.check('«Investigar y escribirle» lleva a «Por escribir»', await c.page.locator(`a[href="/saved/leads/enriched?investigar=${ENRICHED}&empezar=1"]`).count() > 0);
        c.check('ya no ofrece enriquecerlo de nuevo', !(await c.has('Enriquecer y guardar · 1 crédito')));
      } },
    ] },
  { id: 'contactos-seis', persona: 'owner', title: 'Seis contactos al día: revisar, editar y aprobar la campaña de cada uno',
    goal: 'Entender por qué me recomiendan a cada uno, ver su campaña, cambiarla, aprobarla y decir cuál no me sirve, sin salir de la página.', steps: sixSteps },
  { id: 'contactos-seis-telefono', persona: 'owner', viewport: 'phone', title: 'Seis contactos al día (móvil)',
    goal: 'Lo mismo en una pantalla angosta, sin desbordes.', steps: sixSteps },
];

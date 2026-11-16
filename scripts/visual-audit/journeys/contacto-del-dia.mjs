import { createHmac } from 'node:crypto';

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
  { say: 'Abro mi contacto del día', do: async c => { await c.go(`/dashboard/contactos/${DROP}`); await c.see('Por qué te lo recomendamos'); } },
  { say: 'Leo por qué me lo recomiendan y cuánto cuesta ver su correo', do: async c => {
    c.check('dice que ver su correo usa 1 crédito', await c.has('Ver su correo y guardarlo usa 1 crédito'));
    c.check('no muestra el apellido con asteriscos', !(await c.has('***')));
    c.check('la acción principal es «Enriquecer y guardar · 1 crédito»', await c.has('Enriquecer y guardar · 1 crédito'));
    c.check('ofrece buscar también su teléfono, con lo que cuesta', await c.has('O con su teléfono · 8 créditos'));
  } },
  { say: 'Abro «Llamada» y le preparo el guion', do: async c => {
    await c.click({ name: /^Llamada/ });
    await c.see('Preparar guion de llamada');
    c.check('dice que el guion no usa créditos', await c.has('No usa créditos.'));
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
    // «Enriquecer los N»: every lookup found except the last one, which has no email anywhere; then the one answer to the inbox.
    if (body.action === 'enrich') {
      if (body.leadId === id(6)) { change(() => ({ lookup: { attempt: 1, at: '2026-11-13T12:00:00.000Z', missed: true } })); return route.fulfill(answered({ items, lookup: { outcome: 'not_found', email: null, consumed: 0 } })); }
      change(() => ({ savedLeadId: `00000000-0000-4000-8000-0000000030${body.leadId.slice(-2)}`, keptLeadId: `kept-${body.leadId.slice(-2)}`, ...(body.phone ? { phone: { state: 'pending' } } : {}) }));
      return route.fulfill(answered({ items, lookup: { outcome: 'found', email: null, consumed: body.phone ? 8 : 1 } }));
    }
    if (body.action === 'ready') return route.fulfill(answered({ items, mailed: true }));
    if (body.action === 'edit') change(item => ({ edited: true, draft: body.emails.draft, followUps: item.followUps.map((step, index) => ({ day: step.day, ...body.emails.followUps[index] })) }));
    if (body.action === 'feedback') change(() => ({ feedback: { ...body.feedback, at: '2026-11-13T12:00:00.000Z' } }));
    return route.fulfill(answered({ items }));
  });
}
const card = (c, name) => c.page.locator('article').filter({ hasText: name });
// Since 16 Nov 2026 several contacts are a list at the side («Tus contactos») with one card open at a time, and a card's sections
// (why, its campaign, its call) are tabs: a contact is picked from the list, and a section by its tab.
const rail = (c, name) => c.page.getByRole('navigation', { name: 'Tus contactos' }).getByRole('button', { name: new RegExp(name) });
const railCount = (c, text) => c.page.getByRole('navigation', { name: 'Tus contactos' }).getByRole('button', text ? { name: new RegExp(text) } : undefined).count();
const tabOf = (c, name) => c.page.getByRole('tab', { name: new RegExp(`^${name}`) });
const pick = async (c, name) => { await c.clickOn(rail(c, name)); await card(c, name).waitFor(); };
/** Nothing is wider than the screen: the list slides inside its own row. */
const fits = c => c.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const sixSteps = [
  { say: 'Abro mis seis contactos del día', do: async c => { await answerSix(c.page); await c.go(`/dashboard/contactos/${DROP}`); await c.see('6 contactos nuevos'); } },
  { say: 'Veo a los seis en una lista y leo por qué me recomiendan al primero', do: async c => {
    c.check('la lista trae a los seis', await railCount(c) === 6);
    c.check('la lista dice dónde va cada uno', await railCount(c, 'Por enriquecer') === 5 && await railCount(c, 'Campaña por aprobar') === 1);
    c.check('se trabaja un contacto a la vez', await c.page.locator('article').count() === 1);
    c.check('nada se sale de la pantalla', await fits(c));
    c.check('dice cómo abrir', await c.has('Pregúntale cómo van a cubrir la respuesta ante emergencias en la planta nueva.'));
    c.check('dice por qué le sirve lo que vendo', await c.has('Una planta nueva suma áreas y turnos que hoy no tienen brigada.'));
    c.check('la novedad trae su medio y su fecha', await c.has('Diario del Norte, 3 nov 2026'));
    c.check('cómo calza con mi cliente ideal está a la vista', await card(c, 'Rodrigo S.').getByText('Cómo calza con tu cliente ideal').count() === 1);
    c.check('sin su correo, el paso es enriquecer', await card(c, 'Rodrigo S.').getByRole('button', { name: 'Enriquecer · 1 crédito' }).count() === 1);
  } },
  { say: 'Elijo a la segunda y abro su campaña: los pasos con su día, y un correo a la vez', do: async c => {
    await pick(c, 'Paula Reyes');
    await c.clickOn(tabOf(c, 'Campaña'));
    await c.see('Seguimiento 3');
    const sequence = card(c, 'Paula Reyes').getByRole('list', { name: 'Correos de la campaña' });
    c.check('la campaña tiene sus cuatro correos', await sequence.getByRole('button').count() === 4);
    c.check('cada seguimiento dice que va solo si no responde', await sequence.getByText(/si no responde/).count() === 3);
    c.check('parte por el primer correo', await card(c, 'Paula Reyes').getByText('Respuesta ante emergencias en Cobres del Loa').count() === 1);
    await c.clickOn(sequence.getByRole('button', { name: /Seguimiento 1/ }));
    c.check('al elegir un seguimiento se lee ese correo', await card(c, 'Paula Reyes').getByText('¿Quién ve hoy los planes de emergencia de las faenas nuevas?').count() === 1);
    await c.clickOn(sequence.getByRole('button', { name: /Primer correo/ }));
  } },
  { say: 'Cambio el asunto del primer correo y lo guardo', do: async c => {
    await c.clickOn(card(c, 'Paula Reyes').getByRole('button', { name: 'Editar los correos' }));
    await card(c, 'Paula Reyes').getByLabel('Asunto').first().fill('Brigadas para los turnos de noche');
    await c.clickOn(card(c, 'Paula Reyes').getByRole('button', { name: 'Guardar cambios' }));
    await c.see('Guardamos tus cambios en los correos de Paula Reyes.');
    c.check('el correo muestra mi asunto', await card(c, 'Paula Reyes').getByText('Brigadas para los turnos de noche').count() === 1);
  } },
  { say: 'Apruebo y programo su campaña', do: async c => {
    await c.clickOn(card(c, 'Paula Reyes').getByRole('button', { name: 'Aprobar y programar' }));
    await c.see('Campaña de Paula Reyes programada desde Gmail');
    c.check('dice cuándo salen los seguimientos', await c.has('los seguimientos el lun 16 nov, el vie 20 nov y el mar 24 nov'));
    c.check('la tarjeta queda con su campaña en curso', await card(c, 'Paula Reyes').getByText('Campaña en curso').count() === 1);
    c.check('la lista también lo dice', await railCount(c, 'Campaña en curso') === 1);
    c.check('lleva a «Campañas»', await card(c, 'Paula Reyes').getByRole('link', { name: 'Ver la campaña' }).count() === 1);
  } },
  { say: 'Digo que uno no me sirve, y por qué', do: async c => {
    await pick(c, 'Ignacio M.');
    c.check('un cargo vecino se dice como exploración', await card(c, 'Ignacio M.').getByText('Para explorar').count() === 1);
    await c.clickOn(card(c, 'Ignacio M.').getByRole('button', { name: 'No me sirve' }));
    await c.clickOn(card(c, 'Ignacio M.').getByRole('button', { name: 'El cargo no decide' }));
    await c.see('Dijiste que no te sirve (el cargo no decide): lo tendremos en cuenta.');
  } },
];

// ─── «Para llamar» (15 Nov 2026): the mobile with the email or after it, and the script of the call ─────────────────────────────
// The lookup spends credits and the script asks a model, so both are answered here with what the server answers
// (src/lib/server/lead-drop-call.ts): a mobile takes minutes, so asking for it answers «pending» and the number comes with a later read.
const CALL_SCRIPT = {
  points: ['Planta concentradora nueva en 2027: más áreas y turnos que cubrir ante una emergencia.', 'Turnos de noche: quién responde hoy cuando la brigada propia queda corta.',
    'Fiscalización: cómo demuestran ante la autoridad que cada faena tiene su plan.'],
  opening: 'Hola Paula, soy Camila de Resguarda. Te llamo porque vi que Cobres del Loa parte una planta nueva en 2027 y apoyamos a faenas con brigadas de emergencia. ¿Cómo piensan cubrir la respuesta en esa planta?',
  questions: ['¿Quién responde hoy ante una emergencia en los turnos de noche?', '¿La planta nueva va a tener brigada propia o externa?', '¿Cómo registran hoy los simulacros y las inspecciones?'],
  objections: [{ objection: 'Ya tenemos brigada propia', answer: 'Tiene sentido. Muchas faenas la complementan solo en los turnos de noche; ¿te sirve ver cómo lo hacen, sin compromiso?' },
    { objection: 'Mándame un correo', answer: 'Claro, te lo envío hoy. ¿Lo revisamos el jueves en diez minutos?' }],
  voicemail: 'Hola Paula, soy Camila de Resguarda. Te llamaba por la respuesta ante emergencias en la planta nueva. Te escribo un correo con el detalle y te vuelvo a llamar el jueves.',
  whatsapp: 'Hola Paula, soy Camila de Resguarda. Vi que parten una planta nueva en 2027 y apoyamos a faenas con brigadas de emergencia. ¿Te sirve conversar diez minutos esta semana?',
};
async function answerCalls(page) {
  let items = SIX.map((item, index) => index === 1 ? { ...item, phone: { state: 'found', number: '+56 9 8765 4321', more: 1 }, call: { script: CALL_SCRIPT, at: '2026-11-15T12:00:00.000Z' } }
    : index === 2 ? { ...item, name: 'Marcela Díaz', savedLeadId: '00000000-0000-4000-8000-000000002003', keptLeadId: 'kept-3', phone: { state: 'none', missed: false } } : item);
  await page.route(`**/api/lead-drops/${DROP}`, async route => {
    if (route.request().method() === 'GET') return route.fulfill(answered({ id: DROP, date: '2026-11-13', items,
      criteria: { titles: ['Gerente HSE', 'Jefe de Prevención de Riesgos', 'Superintendente de Seguridad'], industries: ['Minería', 'Energía', 'Forestal'], locations: ['Chile'], sizes: [], source: 'empresa' } }));
    const body = route.request().postDataJSON() || {};
    const change = patch => { items = items.map(item => item.leadId === body.leadId ? { ...item, ...patch(item) } : item); };
    if (body.action === 'phone') { change(() => ({ phone: { state: 'pending' } })); return route.fulfill(answered({ items, phone: { outcome: 'pending', consumed: 8 } })); }
    if (body.action === 'script') change(() => ({ call: { script: { ...CALL_SCRIPT, opening: CALL_SCRIPT.opening.replace('Paula', 'Marcela').replace('Cobres del Loa', 'Energía Atacama') }, at: '2026-11-15T12:00:00.000Z' } }));
    return route.fulfill(answered({ items }));
  });
}
const callSteps = [
  { say: 'Abro mis contactos del día', do: async c => { await answerCalls(c.page); await c.go(`/dashboard/contactos/${DROP}`); await c.see('6 contactos nuevos'); } },
  { say: 'Veo que al que aún no enriquezco puedo buscarle también el teléfono', do: async c => {
    c.check('el correo solo sigue siendo el botón', await card(c, 'Rodrigo S.').getByRole('button', { name: 'Enriquecer · 1 crédito' }).count() === 1);
    c.check('con su teléfono es la opción secundaria y dice cuánto cuesta', await card(c, 'Rodrigo S.').getByRole('button', { name: 'O con su teléfono · 8 créditos' }).count() === 1);
  } },
  { say: 'Abro «Llamada» de quien ya tiene su teléfono: el número, cómo llamar o escribir, y el guion por bloques', do: async c => {
    await pick(c, 'Paula Reyes');
    c.check('la pestaña avisa que ya hay teléfono', await tabOf(c, 'Llamada').getByText('(con teléfono)').count() === 1);
    await c.clickOn(tabOf(c, 'Llamada'));
    await c.see('Puntos de interés');
    c.check('puedo llamar', await card(c, 'Paula Reyes').getByRole('link', { name: /Llamar a Paula Reyes/ }).count() === 1);
    c.check('puedo escribir por WhatsApp', await card(c, 'Paula Reyes').getByRole('link', { name: /Escribir a Paula Reyes por WhatsApp/ }).count() === 1);
    c.check('el guion trae qué decir, qué preguntar y qué responder', await c.has('Al contestar') && await c.has('Preguntas') && await c.has('Si te dice…') && await c.has('Si no contesta') && await c.has('Primer WhatsApp'));
    c.check('cada punto de interés parte por su tema', await card(c, 'Paula Reyes').getByText('Turnos de noche:', { exact: true }).count() === 1);
    c.check('cada objeción va con su respuesta al lado', await card(c, 'Paula Reyes').locator('dl dt').count() === 2);
    c.check('se puede copiar y pedir otra versión', await card(c, 'Paula Reyes').getByRole('button', { name: 'Otra versión' }).count() === 1);
    c.check('nada se sale de la pantalla', await fits(c));
  } },
  { say: 'A otra que ya enriquecí le busco el teléfono', do: async c => {
    await pick(c, 'Marcela Díaz');
    await c.clickOn(tabOf(c, 'Llamada'));
    await c.clickOn(card(c, 'Marcela Díaz').getByRole('button', { name: 'Buscar su teléfono · 8 créditos' }));
    await c.see('Buscando el teléfono de Marcela Díaz');
    c.check('dice que llega solo y cuánto usa', await c.has('aparece solo en «Llamada». Usa 8 créditos.'));
    c.check('la tarjeta lo muestra en camino', await card(c, 'Marcela Díaz').getByText('Buscando su teléfono: suele tardar unos minutos').count() === 1);
  } },
  { say: 'Le preparo el guion mientras llega su teléfono', do: async c => {
    await c.clickOn(card(c, 'Marcela Díaz').getByRole('button', { name: 'Preparar guion de llamada' }));
    // «Otra versión» only exists once the script is there (the empty state also speaks of its «puntos de interés»).
    await card(c, 'Marcela Díaz').getByRole('button', { name: 'Otra versión' }).waitFor();
    c.check('el guion es para ella', await card(c, 'Marcela Díaz').getByText(/Hola Marcela, soy Camila/).count() >= 1);
  } },
];

// ─── From the inbox into the app (16 Nov 2026): every button of the emails opens the contacts inside the app ──────────────────────
// The address of the email (`/contactos/<link>`) shows nothing of its own: it checks the link, signed as the app signs it
// (src/lib/server/lead-drop-link.ts, with the bench's INTERNAL_API_SECRET), and sends the person to those contacts in their account.
// Signed in, they land on them; without a session the app asks to sign in and then opens them.
const mailToken = (dropId, days = 14) => {
  const key = createHmac('sha256', 'audit-unused').update('lead-drop-link:v1').digest();
  const body = Buffer.alloc(20);
  Buffer.from(dropId.replace(/-/g, ''), 'hex').copy(body, 0);
  body.writeUInt32BE(Math.floor(Date.now() / 1000) + days * 86_400, 16);
  return Buffer.concat([body, createHmac('sha256', key).update(body).digest().subarray(0, 16)]).toString('base64url');
};
const TOKEN = mailToken(DROP);
const inAppPath = `/dashboard/contactos/${DROP}`;
const arrived = async c => { await c.page.waitForURL(url => url.pathname === inAppPath && !url.search); };
// «Tus contactos de hoy» is a screen of «Hoy» (16 Nov 2026): the menu lists it under «Hoy» while the person has contacts, with how
// many still wait, and the screen it opens shows the person's last ones. Answered here as GET /api/nav/pending and /api/lead-drops/latest do.
async function answerMenu(page) {
  await page.route('**/api/nav/pending', async route => {
    const response = await route.fetch();
    const body = await response.json().catch(() => ({}));
    return route.fulfill(answered({ ...body, contacts: 5 }));
  });
  await page.route('**/api/lead-drops/latest', route => route.fulfill(answered({ drop: null, pull: null, latestId: DROP })));
}
const wide = c => (c.page.viewportSize()?.width ?? 0) >= 1100;
const menuEntry = c => c.page.getByRole('navigation', { name: 'Navegación principal' }).getByRole('link', { name: /Tus contactos de hoy/ });
const mailSteps = [
  { say: 'Con la sesión iniciada, toco el botón de un contacto en el correo de la mañana', do: async c => {
    await answerMenu(c.page); await answerSix(c.page); await c.go(`/contactos/${TOKEN}?c=${id(2)}`); await c.see('6 contactos nuevos');
    await arrived(c);
    c.check('quedo dentro de la app, en mis contactos', new URL(c.page.url()).pathname === inAppPath);
    c.check('el enlace no queda en la dirección', new URL(c.page.url()).search === '');
    if (wide(c)) {
      await menuEntry(c).waitFor();
      c.check('el menú la muestra bajo «Hoy», como la pantalla en que estoy', await menuEntry(c).getAttribute('aria-current') === 'page');
      c.check('con cuántos me quedan por revisar', /5 por revisar/.test(await menuEntry(c).textContent() || ''));
      c.check('«Hoy» queda al lado, sin marcarse', await c.page.getByRole('navigation', { name: 'Navegación principal' }).getByRole('link', { name: 'Hoy', exact: true }).getAttribute('aria-current') === null);
      c.check('es la app de verdad: Cowork y Campañas a un clic', await c.page.getByRole('link', { name: /^Cowork/ }).count() === 1 && await c.page.getByRole('link', { name: 'Campañas' }).count() === 1);
    }
    c.check('la vuelta es a «Hoy»', await c.page.getByRole('main').getByRole('link', { name: 'Hoy', exact: true }).getAttribute('href') === '/dashboard');
    c.check('el contacto del botón llega abierto, en su campaña', await card(c, 'Paula Reyes').getByText('Primer correo ·').count() === 1);
    c.check('la lista trae a los seis', await railCount(c) === 6);
    c.check('abrir no enriquece a nadie', await railCount(c, 'Por enriquecer') === 5);
    c.check('nada se sale de la pantalla', await fits(c));
  } },
  { say: 'Apruebo su campaña ahí mismo', do: async c => {
    await c.clickOn(card(c, 'Paula Reyes').getByRole('button', { name: 'Aprobar y programar' }));
    await c.see('Campaña de Paula Reyes programada desde Gmail');
    c.check('la lista lo dice', await railCount(c, 'Campaña en curso') === 1);
  } },
];
const menuSteps = [
  { say: 'Estoy en «Hoy»: el menú trae «Tus contactos de hoy» debajo', do: async c => {
    await answerMenu(c.page); await answerSix(c.page); await c.go('/dashboard'); await menuEntry(c).waitFor();
    c.check('está bajo «Hoy», sin marcarse todavía', await menuEntry(c).getAttribute('aria-current') === null);
    c.check('lleva a su pantalla dentro de «Hoy»', await menuEntry(c).getAttribute('href') === '/dashboard/contactos');
  } },
  { say: 'La abro desde el menú: mis últimos contactos, en la misma app', do: async c => {
    await c.clickOn(menuEntry(c)); await c.see('6 contactos nuevos');
    c.check('sigo dentro de la app, en la pantalla de «Hoy»', new URL(c.page.url()).pathname === '/dashboard/contactos');
    c.check('el menú la marca', await menuEntry(c).getAttribute('aria-current') === 'page');
    c.check('trae a los seis', await railCount(c) === 6);
    c.check('nada se sale de la pantalla', await fits(c));
  } },
  { say: 'Desde ahí paso a Cowork con un clic', do: async c => {
    await c.clickOn(c.page.getByRole('navigation', { name: 'Navegación principal' }).getByRole('link', { name: /^Cowork/ }));
    await c.page.waitForURL(/\/cowork/);
    c.check('quedo en Cowork', new URL(c.page.url()).pathname.startsWith('/cowork'));
  } },
];
const mailBulkSteps = [
  { say: 'En el correo toco «Con sus teléfonos»: quedo en la app con esa opción elegida, y todavía no gasta nada', do: async c => {
    await answerSix(c.page); await c.go(`/contactos/${TOKEN}?todos=telefono`); await c.see('Enriquecer los 5 de una vez');
    await arrived(c);
    c.check('quedo dentro de la app', new URL(c.page.url()).pathname === inAppPath);
    c.check('viene elegido «Correo y teléfono»', await c.page.getByRole('radio', { name: /Correo y teléfono · 40 créditos/ }).isChecked());
    c.check('ofrece también solo el correo, con su costo', await c.page.getByRole('radio', { name: /Solo correo · 5 créditos/ }).count() === 1);
    c.check('llegar no enriquece a nadie', await railCount(c, 'Por enriquecer') === 5);
    c.check('nada se sale de la pantalla', await fits(c));
  } },
  { say: 'Confirmo: busca a cada uno y me dice qué encontró', do: async c => {
    await c.clickOn(c.page.getByRole('button', { name: 'Enriquecer los 5 · 40 créditos' }));
    await c.see('Listo: encontramos el correo de 4 de 5');
    c.check('dice que quedaron en «Por escribir»', await c.has('quedaron en «Por escribir»'));
    c.check('dice que también van a mi correo', await c.has('También te los enviamos a tu correo, con cada campaña lista para aprobar.'));
    c.check('dice que los teléfonos llegan con su guion', await c.has('Sus teléfonos llegan en unos minutos'));
    c.check('nombra al que quedó sin correo', await c.has('Sin correo:'));
    c.check('la lista muestra cuatro campañas más por aprobar', await railCount(c, 'Campaña por aprobar') === 5);
    c.check('queda uno por enriquecer: ya no ofrece «de una vez»', !(await c.has('de una vez')));
  } },
];
const mailCallSteps = [
  { say: 'En el correo «Para llamar» toco «Llamar»: la app abre a esa persona en su llamada', do: async c => {
    await answerCalls(c.page); await c.go(`/contactos/${TOKEN}?c=${id(2)}&llamar=1`); await c.see('Guion de llamada');
    c.check('quedo dentro de la app', new URL(c.page.url()).pathname === inAppPath);
    c.check('abre la sección «Llamada»', await tabOf(c, 'Llamada').getAttribute('aria-selected') === 'true');
    c.check('con su número y cómo llamar', await card(c, 'Paula Reyes').getByRole('link', { name: /Llamar a Paula Reyes/ }).count() === 1);
    c.check('nada se sale de la pantalla', await fits(c));
  } },
];
const mailVisitorSteps = [
  { say: 'Sin la sesión iniciada, toco el botón del correo', do: async c => {
    await c.go(`/contactos/${TOKEN}?c=${id(2)}`);
    await c.page.waitForURL(/\/login/);
    const url = new URL(c.page.url());
    c.check('la app pide iniciar sesión', url.pathname === '/login');
    c.check('y recuerda adónde iba: mis contactos, con ese contacto', url.searchParams.get('next') === `${inAppPath}?c=${id(2)}`);
    c.check('no muestra ningún contacto sin sesión', await c.page.locator('article').count() === 0);
  } },
  { say: 'Un enlace que no es mío no abre nada', do: async c => {
    await c.go(`/contactos/${'A'.repeat(48)}`);
    await c.see('Este enlace no está disponible');
    c.check('no muestra ningún contacto', await c.page.locator('article').count() === 0);
  } },
];

// ─── Inside the app, in «Hoy» (13 Nov 2026): the six contacts as the first section of the page ─────────────────────────────────────
// «Hoy» reads them from the bench's database (GET /api/lead-drops/latest, for real); what each step answers is the same as on the
// drop's own page. The drop is dated today in Chile, as the morning's would be.
const chileToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date());
const seedHoy = (tables, ctx) => {
  tables.lead_drops = tables.lead_drops.map(row => row.id === DROP ? { ...row, drop_date: chileToday(), status: 'sent', items: structuredClone(SIX) } : row);
  tables.enriched_leads = [...(tables.enriched_leads || []), { id: ENRICHED, organization_id: ctx.ORG, user_id: ctx.OWNER, email: 'paula.reyes@cobresdelloa.example', full_name: 'Paula Reyes' }];
};
const hoy = c => c.page.locator('section#contactos-de-hoy');
const counts = async c => (await hoy(c).locator('dl').first().locator('> div').allTextContents()).join(' · ');
const hoySteps = [
  { say: 'Entro a «Hoy»: mis seis contactos son lo primero', do: async c => {
    await answerSix(c.page); await c.go('/dashboard'); await c.see('6 contactos nuevos para ti');
    c.check('hay una fila por contacto', await hoy(c).locator('article').count() === 6);
    c.check('dice cuántos faltan por enriquecer y por aprobar', await counts(c) === 'Por enriquecer5 · Por aprobar1 · En marcha0');
    c.check('cada fila trae una línea de por qué, no la tarjeta entera', !(await c.has('Diario del Norte, 3 nov 2026')));
    c.check('ya no repite el aviso chico de contactos', await c.page.getByRole('heading', { name: 'Contacto del día' }).count() === 0);
    const top = await hoy(c).boundingBox(), goal = await c.page.getByRole('heading', { name: 'Meta de la semana' }).boundingBox().catch(() => null);
    c.check('va arriba, antes que el resto de «Hoy»', Boolean(top) && top.y < 400);
    if (goal && c.page.viewportSize().width >= 1280) c.check('queda al lado de «Meta de la semana»', goal.x > top.x + top.width - 1);
  } },
  { say: 'Abro el detalle del primero ahí mismo', do: async c => {
    await card(c, 'Rodrigo S.').getByRole('button', { name: /Ver por qué y su campaña/ }).click();
    await c.see('Diario del Norte, 3 nov 2026');
    c.check('dice cómo abrir', await c.has('Pregúntale cómo van a cubrir la respuesta ante emergencias en la planta nueva.'));
    c.check('abierta, la fila es la misma ficha: por qué, su campaña y su llamada', await card(c, 'Rodrigo S.').getByRole('tab').count() === 3);
    c.check('sin su correo, el paso es enriquecer', await card(c, 'Rodrigo S.').getByRole('button', { name: 'Enriquecer · 1 crédito' }).count() === 1);
    c.check('nada se sale de la pantalla', await fits(c));
  } },
  { say: 'Apruebo la campaña de la que ya tiene correo, sin salir de «Hoy»', do: async c => {
    await card(c, 'Paula Reyes').getByRole('button', { name: 'Aprobar y programar' }).click();
    await c.see('Campaña de Paula Reyes programada desde Gmail');
    c.check('los contadores se actualizan', await counts(c) === 'Por enriquecer5 · Por aprobar0 · En marcha1');
    c.check('la fila queda con su campaña en curso', await card(c, 'Paula Reyes').getByText('Campaña en curso').count() === 1);
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
      { say: 'Abro el contacto ya enriquecido', do: async c => { await answerSaved(c.page); await c.go(`/dashboard/contactos/${DROP}`); await c.see('Carolina Vega'); } },
      { say: 'El siguiente paso es investigarlo y escribirle', do: async c => {
        c.check('«Investigar y escribirle» lleva a «Por escribir»', await c.page.locator(`a[href="/saved/leads/enriched?investigar=${ENRICHED}&empezar=1"]`).count() > 0);
        c.check('ya no ofrece enriquecerlo de nuevo', !(await c.has('Enriquecer y guardar · 1 crédito')));
      } },
    ] },
  { id: 'contactos-seis', persona: 'owner', title: 'Seis contactos al día: revisar, editar y aprobar la campaña de cada uno',
    goal: 'Entender por qué me recomiendan a cada uno, ver su campaña, cambiarla, aprobarla y decir cuál no me sirve, sin salir de la página.', steps: sixSteps },
  { id: 'contactos-seis-telefono', persona: 'owner', viewport: 'phone', title: 'Seis contactos al día (móvil)',
    goal: 'Lo mismo en una pantalla angosta, sin desbordes.', steps: sixSteps },
  { id: 'contactos-para-llamar', persona: 'owner', title: 'Llamar a un contacto del día: su teléfono y su guion',
    goal: 'Buscar el teléfono de un contacto, con el correo o después, y tener preparado qué decirle: sus puntos de interés, cómo abrir, qué preguntar y qué responder.', steps: callSteps },
  { id: 'contactos-para-llamar-telefono', persona: 'owner', viewport: 'phone', title: 'Llamar a un contacto del día (móvil)',
    goal: 'Lo mismo desde el teléfono, que es desde donde se llama.', steps: callSteps },
  { id: 'contactos-en-hoy', persona: 'owner', title: 'Mis contactos del día dentro de «Hoy»',
    goal: 'Entrar a la app y encontrar mis contactos del día como lo primero de «Hoy», ver por qué me los recomiendan y aprobar una campaña ahí mismo.',
    seed: seedHoy, steps: hoySteps },
  { id: 'contactos-en-hoy-telefono', persona: 'owner', viewport: 'phone', title: 'Mis contactos del día dentro de «Hoy» (móvil)',
    goal: 'Lo mismo en una pantalla angosta, sin desbordes.', seed: seedHoy, steps: hoySteps },
  { id: 'contactos-del-correo-a-la-app', persona: 'owner', title: 'Del correo a mis contactos, dentro de la app',
    goal: 'Tocar el botón de un contacto en el correo y quedar dentro de la app, en mi cuenta, con ese contacto abierto y el resto de ANTON.IA a un clic.',
    steps: mailSteps },
  { id: 'contactos-del-correo-a-la-app-telefono', persona: 'owner', viewport: 'phone', title: 'Del correo a mis contactos, dentro de la app (móvil)',
    goal: 'Lo mismo desde el teléfono, donde se lee el correo.', steps: mailSteps },
  { id: 'contactos-desde-el-menu', persona: 'owner', title: '«Tus contactos de hoy», una pantalla de «Hoy» en el menú',
    goal: 'Ver mis contactos como parte de la app: bajo «Hoy» en el menú, y con Cowork y el resto a un clic.', steps: menuSteps },
  { id: 'contactos-del-correo-todos', persona: 'owner', title: 'Enriquecer a todos desde el correo, dentro de la app',
    goal: 'Tocar «Con sus teléfonos» en el correo de la mañana, confirmar en la app cuánto se usa y ver qué se encontró.', steps: mailBulkSteps },
  { id: 'contactos-del-correo-todos-telefono', persona: 'owner', viewport: 'phone', title: 'Enriquecer a todos desde el correo (móvil)',
    goal: 'Lo mismo desde el teléfono.', steps: mailBulkSteps },
  { id: 'contactos-del-correo-llamar', persona: 'owner', title: 'Llamar desde el correo: la app abre el guion',
    goal: 'Tocar «Llamar» en el correo que trae un teléfono y quedar en la app, en la llamada de esa persona.', steps: mailCallSteps },
  { id: 'contactos-del-correo-sin-sesion', persona: 'visitor', title: 'El botón del correo, sin la sesión iniciada',
    goal: 'Sin sesión, la app pide entrar y después abre mis contactos; un enlace ajeno no abre nada.', steps: mailVisitorSteps },
];

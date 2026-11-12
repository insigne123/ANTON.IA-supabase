// «¿Es la misma persona?» in the profile search (12 Nov 2026, docs/busqueda-de-leads.md): Apollo answers a pasted LinkedIn address with
// someone at another address; the person sees whom it found, what the AI makes of it, and decides. Apollo and the table do not run in the
// bench: the journey answers with the bodies the server returns (src/app/api/opportunities/enrich-apollo/route.ts and
// src/app/api/leads/identity-reviews/[id]/route.ts), and what is measured is the screen. Fictional people and companies.

const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const PASTED = 'https://www.linkedin.com/in/ana-perez-soto-1a2b3c4d';
const REVIEW_ID = '00000000-0000-4000-8000-0000000000a1';
const review = verdict => ({
  id: REVIEW_ID, requestedLinkedinUrl: PASTED, reason: 'url_differs:high', decision: null, hasContact: true,
  createdAt: '2026-11-12T15:00:00.000Z', expiresAt: '2026-11-19T15:00:00.000Z', verdict,
  candidate: {
    apolloId: 'apollo-ana', fullName: 'Ana María Pérez Soto', firstName: 'Ana María', lastName: 'Pérez Soto', title: 'Jefa de Prevención de Riesgos',
    headline: null, linkedinUrl: 'https://www.linkedin.com/in/ana-maria-perez-soto-123456789', organizationName: 'Energía del Sur',
    organizationDomain: 'energiadelsur.example', organizationIndustry: null, photoUrl: null, city: 'Santiago', state: null, country: 'Chile', seniority: null,
  },
});
const VERDICT = {
  verdict: 'probably_same', by: 'ai', at: '2026-11-12T15:00:05.000Z',
  summary: 'La dirección que pegaste dice Ana Pérez Soto y Apollo devolvió a Ana María Pérez Soto, en la misma empresa.',
  checks: [
    { topic: 'name', status: 'ok', text: 'Los nombres calzan; Apollo agrega «María».' },
    { topic: 'company', status: 'ok', text: 'La web del perfil que pegaste muestra Energía del Sur.' },
    { topic: 'address', status: 'doubt', text: 'Las direcciones son distintas, aunque ambas dicen Ana Pérez Soto.' },
  ],
};
const PROFILE = {
  id: 'profile:ana', sourceProvider: 'apollo', sourceProviderId: 'apollo-ana', fullName: 'Ana María Pérez Soto', firstName: 'Ana María', lastName: 'Pérez Soto',
  email: 'ana.perez@energiadelsur.example', emailStatus: 'verified', linkedinUrl: 'https://www.linkedin.com/in/ana-maria-perez-soto-123456789',
  title: 'Jefa de Prevención de Riesgos', companyName: 'Energía del Sur', companyDomain: 'energiadelsur.example', city: 'Santiago', country: 'Chile',
  phoneNumbers: [], enrichmentStatus: 'completed', serverPersisted: true,
};

/** The two APIs of the screen, as the server answers them: the refused match with whom Apollo found, then the verdict and the decision. */
async function profileApi(page, state) {
  await page.route('**/api/opportunities/enrich-apollo', route => route.fulfill(json({
    queued: false, operationId: 'op-perfil', operationStatus: 'completed', providerUsed: 'apollo', requestedData: { email: true, phone: false },
    usage: { consumed: 1, count: 1, limit: 50, reused: false },
    enriched: [{ id: 'profile:ana', enrichmentStatus: 'failed', errorCode: 'APOLLO_PERSON_IDENTITY_MISMATCH', identityReview: review(null) }],
  })));
  await page.route('**/api/leads/identity-reviews/**', async route => {
    if (route.request().method() === 'GET') {
      // The verdict takes a moment, as the model does: the card shows that it is comparing.
      await new Promise(done => setTimeout(done, 600));
      return route.fulfill(json({ review: review(VERDICT) }));
    }
    const decision = (route.request().postDataJSON() || {}).decision;
    state.decisions.push(decision);
    return route.fulfill(json({ review: { ...review(VERDICT), decision, hasContact: false }, profile: decision === 'same' ? PROFILE : null }));
  });
}

const search = state => ({ say: 'Busco a una persona por la dirección de su perfil', do: async c => {
  await profileApi(c.page, state);
  await c.go('/search');
  // The last search comes back first; on a phone it folds the criteria behind «Editar».
  await c.see('Recuperamos tu última búsqueda', { timeout: 20000 });
  const edit = c.page.getByRole('button', { name: 'Editar', exact: true }).filter({ visible: true });
  if (await edit.count()) await c.clickOn(edit.first());
  await c.clickOn(c.page.getByRole('group', { name: 'Modo de búsqueda' }).getByRole('button', { name: 'Perfil' }));
  await c.fill('URL del perfil de LinkedIn', PASTED);
  await c.clickOn(c.page.getByRole('button', { name: 'Buscar', exact: true }).filter({ visible: true }).first());
  await c.seeRole('heading', '¿Es la misma persona?', { timeout: 20000 });
  await c.see('Ana María Pérez Soto');
  await c.see('Jefa de Prevención de Riesgos · Energía del Sur');
  await c.seeRole('link', 'Perfil que pegaste');
  await c.seeRole('link', 'Perfil que encontró Apollo');
  await c.see('La IA cree que probablemente es la misma persona');
  c.check('no se muestra su correo antes de decidir', !(await c.has('ana.perez@energiadelsur.example')));
  c.check('los enlaces abren los dos perfiles', (await c.page.getByRole('link', { name: /Perfil que encontró Apollo/ }).getAttribute('href')) === PROFILE.linkedinUrl
    && (await c.page.getByRole('link', { name: /Perfil que pegaste/ }).getAttribute('href')) === PASTED);
} });

const accept = state => [search(state), { say: 'Digo que es la misma persona', do: async c => {
  await c.click('Es la misma persona');
  await c.see('ana.perez@energiadelsur.example');
  await c.notSee('¿Es la misma persona?');
  c.check('la decisión llegó al servidor una vez', state.decisions.length === 1 && state.decisions[0] === 'same');
} }];

const refuse = state => [search(state), { say: 'Digo que no es', do: async c => {
  await c.click('No es');
  await c.notSee('¿Es la misma persona?');
  await c.see('El proveedor devolvió a otra persona');
  c.check('no se muestra su correo', !(await c.has('ana.perez@energiadelsur.example')));
  c.check('la decisión llegó al servidor', state.decisions[0] === 'different');
} }];

export default () => [
  { id: 'perfil-misma-persona', persona: 'owner', title: 'Apollo trae a la persona con otra dirección y confirmo que es ella', goal: 'Ver el contacto que ya pagué sin buscar de nuevo.', steps: accept({ decisions: [] }) },
  { id: 'perfil-misma-persona-telefono', persona: 'owner', viewport: 'phone', title: 'Lo mismo desde el teléfono', goal: 'Lo mismo, en el teléfono.', steps: accept({ decisions: [] }) },
  { id: 'perfil-otra-persona', persona: 'owner', title: 'Apollo trae a otra persona y la descarto', goal: 'No mezclar datos de alguien más.', steps: refuse({ decisions: [] }) },
];

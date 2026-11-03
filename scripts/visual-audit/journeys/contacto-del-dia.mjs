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
];

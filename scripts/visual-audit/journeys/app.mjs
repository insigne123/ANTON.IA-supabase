// Journeys of the rest of the app (tanda 6 of docs/evaluacion-exhaustiva-2026-10-24.md): what waits for the person, said in the menu; the
// conversation that waits the most, open beside the list; and how a launched campaign goes, from its row. Reading journeys: they write nothing.
const visible = (locator, timeout = 12000) => locator.first().waitFor({ state: 'visible', timeout }).then(() => true).catch(() => false);
const attached = (locator, timeout = 12000) => locator.first().waitFor({ state: 'attached', timeout }).then(() => true).catch(() => false);

export default () => [
  { id: 'app-menu-pendientes', persona: 'owner', title: 'El menú dice qué me espera, sin entrar a cada sección',
    goal: 'Ver junto a «Conversaciones» y «Cowork» cuántas cosas esperan mi respuesta (APP-23).',
    steps: [
      { say: 'Abro Hoy', do: async c => { await c.go('/dashboard'); await c.seeRole('heading', 'Hoy'); } },
      { say: 'Miro el menú', do: async c => {
        const nav = c.page.getByRole('navigation', { name: 'Navegación principal' });
        c.check('«Conversaciones» dice cuántas personas esperan respuesta', await visible(nav.getByRole('link', { name: /Conversaciones\W+\d+ por responder/ })),
          (await nav.innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200));
        c.check('«Cowork» dice cuántas propuestas esperan', await visible(nav.getByRole('link', { name: /Cowork\W+\d+ esperan tu aprobación/ })));
        c.check('lo que no tiene pendientes no lleva número', !(await nav.getByRole('link', { name: /Buscar prospectos:/ }).count()));
      } },
    ] },
  { id: 'app-menu-telefono', persona: 'owner', viewport: 'phone', title: 'En el teléfono, el botón del menú avisa que hay algo pendiente',
    goal: 'Saber que algo espera sin abrir el menú (APP-23).',
    steps: [
      { say: 'Abro Hoy en el teléfono', do: async c => { await c.go('/dashboard'); await c.seeRole('heading', 'Hoy'); } },
      { say: 'Miro la barra de arriba', do: async c => {
        c.check('un lector de pantalla oye que hay pendientes', await attached(c.page.getByText('Hay pendientes en el menú.')));
      } },
    ] },
  { id: 'app-conversacion-urgente', persona: 'owner', title: 'Conversaciones abre la que más espera, sin elegirla',
    goal: 'Leer y responder primero a quien pidió una reunión (APP-11).',
    steps: [
      { say: 'Abro Conversaciones', do: async c => { await c.go('/contacted'); await c.seeRole('heading', 'Conversaciones'); } },
      { say: 'Miro el panel de la derecha', do: async c => {
        const panel = c.page.getByRole('region', { name: 'Conversación abierta' });
        c.check('se abre la reunión pedida, no «Elige una conversación»', await visible(panel.getByRole('heading', { name: 'Andrea Soto' })),
          (await panel.innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 160));
        c.check('cada fila habla de correos enviados, no de registros', await c.has(/\d+ correos? enviados?/) && !(await c.has(/\d+ registros?\b/)));
      } },
    ] },
  { id: 'app-campanas-resultados', persona: 'owner', title: 'La lista de campañas dice cómo va cada una lanzada',
    goal: 'Saber a cuántos se envió y quién respondió sin abrir la campaña (APP-10).',
    steps: [
      { say: 'Abro Campañas', do: async c => { await c.go('/campaigns'); await c.see('Logística · centros de distribución'); } },
      { say: 'Leo las filas', do: async c => {
        const row = c.page.getByRole('button', { name: /Logística · centros de distribución/ }).first();
        const text = (await row.innerText().catch(() => '')).replace(/\s+/g, ' ');
        c.check('la lanzada dice a cuántos se envió y cuántos respondieron', /Enviada a \d+ de \d+ · \d+ respuestas?/.test(text), text.slice(0, 160));
        const draft = (await c.page.getByRole('button', { name: /Reclutamiento masivo · retail/ }).first().innerText().catch(() => '')).replace(/\s+/g, ' ');
        c.check('el borrador dice lo que va a enviar', /\d+ destinatarios? · \d+ correos? por persona/.test(draft), draft.slice(0, 160));
      } },
    ] },
  { id: 'app-por-escribir-traer', persona: 'owner', title: 'Mirar «Por escribir» no mueve contactos; traerlos es una decisión',
    goal: 'Pasar los contactos guardados que ya tienen correo cuando yo lo pida (APP-13).',
    steps: [
      { say: 'Abro Por escribir', do: async c => {
        const withEmail = () => c.table('leads').filter(lead => String(lead.email || '').includes('@')).length;
        const before = withEmail();
        await c.go('/saved/leads/enriched'); await c.see(/contactos? guardados? ya tienen? correo/); await c.wait(1500);
        c.check('abrir la pantalla no movió a nadie', before > 0 && withEmail() === before, `${before} → ${withEmail()}`);
      } },
      { say: 'Pulso «Traerlos a «Por escribir»»', do: async c => {
        const enrichedBefore = c.table('enriched_leads').length;
        await c.click({ role: 'button', name: /^Traerlos a «Por escribir»/ }); await c.see(/pasaron? a «Por escribir»/);
        c.check('los guardados con correo dejaron la lista de guardados', !c.table('leads').some(lead => String(lead.email || '').includes('@')));
        c.check('y llegaron a «Por escribir»', c.table('enriched_leads').length > enrichedBefore, `${enrichedBefore} → ${c.table('enriched_leads').length}`);
        c.check('el aviso se fue', !(await c.has(/ya tienen? correo/)));
      } },
    ] },
];

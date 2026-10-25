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
        const moving = c.table('leads').filter(lead => String(lead.email || '').includes('@')).map(lead => String(lead.email).toLowerCase());
        await c.click({ role: 'button', name: /^Traerlos a «Por escribir»/ }); await c.see(/pasaron? a «Por escribir»/);
        c.check('los guardados con correo dejaron la lista de guardados', !c.table('leads').some(lead => String(lead.email || '').includes('@')));
        // Who was already in «Por escribir» is not added twice: each one is there once.
        const enriched = new Set(c.table('enriched_leads').map(lead => String(lead.email || '').toLowerCase()));
        c.check('y están en «Por escribir»', moving.length > 0 && moving.every(email => enriched.has(email)), `${moving.filter(email => enriched.has(email)).length} de ${moving.length}`);
        c.check('el aviso se fue', await c.notSee(/ya tienen? correo/, { timeout: 6000 }).then(() => true, () => false));
      } },
    ] },
  { id: 'app-buscar-todo', persona: 'owner', title: 'Encontrar a una persona desde cualquier pantalla, sin saber dónde está',
    goal: 'Con Ctrl+K, escribir un nombre y llegar a su conversación (APP-24).',
    steps: [
      { say: 'Abro Hoy y pulso Ctrl+K', do: async c => {
        // After «Hoy» loads: the screen mounts again once the session resolves.
        await c.go('/dashboard'); await c.seeRole('heading', 'Hoy'); await c.see(/Lo primero hoy/);
        await c.page.keyboard.press('Control+k');
        const box = c.page.getByRole('combobox', { name: 'Buscar e ir a…' });
        c.check('se abre la caja, con el foco en ella', await visible(box) && await box.evaluate(node => node === document.activeElement));
      } },
      { say: 'Escribo «Andrea» y elijo Conversaciones', do: async c => {
        await c.page.keyboard.type('Andrea');
        const option = c.page.getByRole('option', { name: /«Andrea» en Conversaciones/ });
        c.check('ofrece buscar en Conversaciones, la Tabla de datos y Oportunidades', await visible(option)
          && await c.page.getByRole('option', { name: /en la Tabla de datos/ }).count() === 1);
        c.check('la primera opción queda marcada', (await option.getAttribute('aria-selected')) === 'true');
        await c.page.keyboard.press('Enter');
        await c.seeRole('heading', 'Conversaciones');
        const field = c.page.getByRole('textbox', { name: 'Buscar contacto o empresa' });
        await c.wait(800);
        c.check('Conversaciones abre con la búsqueda escrita', (await field.inputValue().catch(() => '')) === 'Andrea', c.page.url());
        c.check('y la encuentra', await c.has('Andrea Soto'));
      } },
    ] },
  { id: 'app-perfil-indice', persona: 'owner', title: 'En Perfil, saber dónde estoy y saltar a mi cliente ideal',
    goal: 'Ir a «Tu cliente ideal» sin recorrer 3.200 px (APP-07).',
    steps: [
      { say: 'Abro Perfil', do: async c => { await c.go('/profile'); await c.seeRole('navigation', 'Partes del perfil'); } },
      { say: 'Pulso «Tu cliente ideal» en el índice', do: async c => {
        const index = c.page.getByRole('navigation', { name: 'Partes del perfil' });
        await c.clickOn(index.getByRole('link', { name: 'Tu cliente ideal' })); await c.wait(1200);
        const heading = c.page.locator('#icp-heading');
        c.check('la página baja hasta «Tu cliente ideal»', await heading.evaluate(node => { const top = node.getBoundingClientRect().top; return top >= 0 && top < window.innerHeight / 2; }).catch(() => false),
          String(await heading.evaluate(node => Math.round(node.getBoundingClientRect().top)).catch(() => 'sin título')));
        c.check('el índice marca dónde estoy', (await index.getByRole('link', { name: 'Tu cliente ideal' }).getAttribute('aria-current')) === 'location');
        c.check('el índice sigue a la vista', await index.isVisible());
      } },
    ] },
  { id: 'app-tabla-telefono', persona: 'owner', viewport: 'phone', title: 'En el teléfono, la Tabla de datos dice a quién y cómo escribirle',
    goal: 'Ver correo, empresa y cargo de cada contacto sin desplazar una tabla de lado (APP-09).',
    steps: [
      { say: 'Abro la Tabla de datos en el teléfono', do: async c => { await c.go('/sheet'); await c.seeRole('heading', 'Tabla de datos'); } },
      { say: 'Leo la primera tarjeta', do: async c => {
        const card = c.page.getByRole('list', { name: 'Contactos' }).getByRole('listitem').first();
        const shown = await visible(card);
        const text = (await card.innerText().catch(() => '')).replace(/\s+/g, ' ');
        c.check('cada contacto es una tarjeta, no una fila cortada', shown && !(await c.page.getByRole('table').count()), text.slice(0, 160));
        c.check('la tarjeta dice el correo y la empresa', /@/.test(text) && / · /.test(text), text.slice(0, 160));
      } },
    ] },
  { id: 'app-tabla-sombra', persona: 'owner', title: 'En escritorio, la columna «Acción» avisa que la tabla sigue',
    goal: 'Saber que hay más columnas a la derecha (APP-09).',
    steps: [
      { say: 'Abro la Tabla de datos', do: async c => { await c.go('/sheet'); await c.seeRole('heading', 'Tabla de datos'); await c.page.getByRole('table').first().waitFor({ timeout: 12000 }); await c.wait(800); } },
      { say: 'Miro la columna «Acción»', do: async c => {
        const head = c.page.getByRole('columnheader', { name: 'Acción' }).first();
        const overflow = await c.page.getByRole('table').first().evaluate(table => { const box = table.parentElement; return box ? box.scrollWidth > box.clientWidth + 1 : false; });
        const shadow = await head.evaluate(node => getComputedStyle(node).boxShadow).catch(() => 'none');
        c.check('con columnas fuera de la vista, «Acción» lleva sombra', !overflow || shadow !== 'none', `${overflow ? 'la tabla sigue a la derecha' : 'la tabla cabe'} · ${shadow}`);
        if (overflow) {
          await c.page.getByRole('table').first().evaluate(table => { const box = table.parentElement; if (box) box.scrollLeft = box.scrollWidth; });
          await c.wait(400);
          c.check('al llegar al final, la sombra se va', (await head.evaluate(node => getComputedStyle(node).boxShadow).catch(() => '')) === 'none');
        }
      } },
    ] },
];

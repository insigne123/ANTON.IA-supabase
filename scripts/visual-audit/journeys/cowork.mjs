// Journeys of Cowork: what a person does with the conversations of fixtures/cowork.mjs. The assistant itself does not run in the bench (there is
// no model and no worker), so these are the reading journeys: coming back to a research that used the web, seeing where each thing it said
// comes from, and finding what Cowork can do. Sending a message is a write the bench blocks; its flow is measured with the harness evaluation.
const run = n => `00000000-0000-4000-8000-${String(9000 + n).padStart(12, '0')}`;

export default () => [
  { id: 'cowork-retomar-investigacion', persona: 'owner', title: 'Retomar una investigación hecha con la web y ver de dónde salió',
    goal: 'Saber qué buscó y qué leyó Cowork para decir que Sodexo Chile está reclutando, y poder abrir sus fuentes.',
    steps: [
      { say: 'Abro Cowork', do: async c => { await c.go('/cowork'); await c.see('Investiga qué hace Sodexo Chile'); } },
      { say: 'Abro la conversación de Sodexo', do: async c => { await c.click({ text: 'Investiga qué hace Sodexo Chile y si está contratando' }); await c.see('sí está reclutando en volumen'); } },
      { say: 'Veo en una línea qué hizo', do: async c => { await c.see('Buscó en la web'); } },
      { say: 'Abro el detalle de lo que consultó', do: async c => {
        await c.click({ role: 'button', name: /Buscó en la web/ });
        await c.see('Leyó una página web');
        c.check('cada búsqueda dice qué buscó y cuántas páginas encontró', await c.has('Sodexo Chile a qué se dedica servicios') && await c.has('3 resultados'));
        c.check('la página que no pudo leer lo dice', await c.has('no se pudo'));
        c.check('la página leída se nombra por su sitio', await c.has('cl.sodexo.com'));
      } },
      { say: 'Reviso que la respuesta cite sus fuentes con enlace', do: async c => {
        const links = await c.page.locator('a[href^="https://"]').evaluateAll(nodes => nodes.map(node => node.getAttribute('href')));
        c.check('la respuesta lleva enlaces a sus fuentes', links.some(link => /cl\.sodexo\.com/.test(link || '')) && links.some(link => /redimin\.cl/.test(link || '')), `${links.length} enlaces`);
        const bare = await c.page.locator('a[href^="https://"]').first().getAttribute('rel');
        c.check('los enlaces externos no pasan el origen', /noopener/.test(bare || ''), `rel=${bare}`);
      } },
      { say: 'Toco la respuesta sugerida', do: async c => { await c.see('Buscar contactos'); } },
    ] },
  { id: 'cowork-que-puedes-hacer', persona: 'owner', title: 'Una persona nueva busca qué puede pedirle a Cowork',
    goal: 'Encontrar la guía de lo que hace, sin salir de la portada.',
    steps: [
      { say: 'Abro Cowork', do: async c => { await c.go('/cowork'); await c.see('¿Qué puedes hacer?'); } },
      { say: 'Pulso «¿Qué puedes hacer?»', do: async c => { await c.click('¿Qué puedes hacer?'); await c.wait(800); } },
      { say: 'Leo la guía', do: async c => {
        const text = await c.page.locator('body').innerText();
        c.check('la guía habla de contactos y campañas', /contacto/i.test(text) && /campa[ñn]a/i.test(text));
        c.check('la guía dice que nada se envía sin aprobación', /aprob/i.test(text));
        // The web group is for whoever's turns can search it (AUDIT_COWORK_WEB=true); with it off, the guide must not promise it.
        const web = process.env.AUDIT_COWORK_WEB === 'true';
        c.check(web ? 'la guía ofrece buscar en la web' : 'la guía no promete la web mientras está apagada', /Buscar en la web/.test(text) === web);
      } },
    ] },
  { id: 'cowork-tarea-por-aprobar', persona: 'owner', title: 'Una tarea larga espera tu aprobación',
    goal: 'Ver qué hará, cuánto puede gastar y poder decidir.',
    steps: [
      { say: 'Abro la tarea propuesta', do: async c => { await c.go(`/cowork?work=${run(6)}`); await c.see('Tarea de 4 pasos'); } },
      { say: 'Veo qué gasta y qué decide quien aprueba', do: async c => {
        c.check('el costo máximo está a la vista', await c.has('10 créditos'));
        c.check('hay un botón para aprobar y uno para descartar', await c.page.getByRole('button', { name: /Aprobar/ }).first().isVisible().catch(() => false) && await c.page.getByRole('button', { name: /Descartar/ }).first().isVisible().catch(() => false));
      } },
    ] },
  { id: 'cowork-telefono', persona: 'owner', viewport: 'phone', title: 'Desde el teléfono: retomar la investigación con la web',
    goal: 'Leer la respuesta y sus fuentes en una pantalla angosta.',
    steps: [
      { say: 'Abro Cowork', do: async c => { await c.go('/cowork'); await c.wait(800); } },
      { say: 'Abro la conversación de Sodexo', do: async c => {
        if (!await c.has('sí está reclutando en volumen')) {
          await c.click({ text: 'Investiga qué hace Sodexo Chile y si está contratando' }).catch(async () => { await c.click({ role: 'button', name: /conversaciones|menú|Menú/i }); await c.click({ text: 'Investiga qué hace Sodexo Chile y si está contratando' }); });
        }
        await c.see('sí está reclutando en volumen');
      } },
      { say: 'Reviso que nada desborde', do: async c => {
        const overflow = await c.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        c.check('sin desborde horizontal', overflow <= 1, `${overflow}px`);
      } },
    ] },
];

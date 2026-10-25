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
  { id: 'cowork-pendientes', persona: 'owner', title: 'Lo que espera mi aprobación queda arriba, aunque sea de otra conversación',
    goal: 'Ver de un vistazo qué propuestas esperan una decisión (COW-16).',
    steps: [
      { say: 'Abro una conversación cualquiera', do: async c => { await c.go(`/cowork?work=${run(1)}`); await c.see('Esperan tu aprobación'); } },
      { say: 'Miro la lista de conversaciones', do: async c => {
        const rail = await c.page.getByRole('navigation', { name: 'Conversaciones' }).first().innerText();
        const waiting = rail.indexOf('Esperan tu aprobación');
        const dates = ['Hoy', 'Ayer', 'Últimos 7 días', 'Últimos 30 días', 'Anteriores'].map(label => rail.indexOf(`\n${label}\n`)).filter(at => at >= 0);
        c.check('las que esperan van primero, con cuántas son', /Esperan tu aprobación · \d+/.test(rail) && dates.every(at => waiting < at), rail.slice(0, 160).replace(/\n/g, ' | '));
      } },
    ] },
  { id: 'cowork-fijadas', persona: 'owner', title: 'La conversación que uso cada semana queda fijada arriba',
    goal: 'Encontrar «Prioridades de esta semana» sin buscarla entre las fechas (COW-12).',
    steps: [
      { say: 'Abro Cowork', do: async c => { await c.go(`/cowork?work=${run(4)}`); await c.see('Fijadas'); } },
      { say: 'Miro la lista y el menú de la fijada', do: async c => {
        const rail = await c.page.getByRole('navigation', { name: 'Conversaciones' }).first().innerText();
        const pinned = rail.indexOf('\nFijadas'), today = rail.indexOf('\nHoy\n');
        c.check('las fijadas van antes de las fechas, con la suya', pinned >= 0 && rail.indexOf('Prioridades de esta semana') > pinned && (today < 0 || pinned < today), rail.slice(0, 200).replace(/\n/g, ' | '));
        await c.click({ role: 'button', name: 'Opciones de «Prioridades de esta semana»' });
        c.check('su menú ofrece quitarla de fijadas', await c.page.getByRole('menuitem', { name: 'Quitar de fijadas' }).isVisible().catch(() => false));
        await c.page.keyboard.press('Escape');
      } },
    ] },
  { id: 'cowork-buscar', persona: 'owner', title: 'Encontrar una conversación por lo que Cowork respondió',
    goal: 'Volver a la investigación que hablaba de minería sin recordar su nombre (COW-09).',
    steps: [
      { say: 'Abro Cowork', do: async c => { await c.go('/cowork'); await c.seeRole('textbox', 'Buscar conversaciones'); } },
      { say: 'Busco «minería»', do: async c => {
        await c.page.getByRole('textbox', { name: 'Buscar conversaciones' }).first().fill('minería');
        const rail = c.page.getByRole('navigation', { name: 'Conversaciones' }).first();
        // The line of the answer that says it, not the word in «Ninguna conversación coincide con «minería»».
        const shown = await rail.getByText(/en minería/).first().waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false);
        const text = (await rail.innerText()).replace(/\s+/g, ' ');
        c.check('aparece la de Sodexo, con la línea donde lo dice', shown && /Investiga qué hace Sodexo/.test(text), text.slice(0, 200));
        c.check('las que no lo dicen no aparecen', !/Muéstrame mi pipeline/.test(text));
      } },
    ] },
  { id: 'cowork-memoria-escrita', persona: 'owner', title: 'Decirle a Cowork qué recordar sin pasar por el chat, y corregir un recuerdo',
    goal: 'Escribir una preferencia y corregir otra en «Lo que Cowork recuerda» (COW-05).', passWrites: [{ pattern: /^\/api\/cowork\/memories/ }],
    steps: [
      { say: 'Abro Cowork y su memoria', do: async c => {
        await c.go('/cowork');
        // The page has to be alive before the dialog opens: the screen mounts again when the session resolves and would close it.
        await c.see('Para hoy');
        await c.wait(1500);
        await c.click({ role: 'button', name: 'Memoria' }); await c.seeRole('dialog', 'Lo que Cowork recuerda'); await c.see('tutea a todos los contactos');
      } },
      { say: 'Escribo algo para que recuerde', do: async c => {
        await c.fill('Que Cowork recuerde', 'Escribe en español neutro');
        await c.click({ role: 'button', name: 'Recordar' }); await c.see('Escribe en español neutro');
        const saved = c.table('suplia_memories').find(row => row.value?.text === 'Escribe en español neutro');
        c.check('queda guardado y aprobado, solo para mí', saved?.status === 'approved' && saved?.scope === 'user', JSON.stringify(saved || null).slice(0, 160));
      } },
      { say: 'Corrijo «tutea a todos los contactos»', do: async c => {
        await c.click({ role: 'button', name: 'Corregir: tutea a todos los contactos' });
        await c.fill({ label: 'Corregir: tutea a todos los contactos' }, 'Trata de usted a los gerentes generales');
        await c.click({ role: 'button', name: 'Guardar' }); await c.see('Trata de usted a los gerentes generales');
        c.check('el recuerdo dice lo corregido', c.table('suplia_memories').some(row => row.value?.text === 'Trata de usted a los gerentes generales'));
        // The owner is an administrator: they may correct what a teammate saved for the team (a member may not: memories.test.ts).
        c.check('como dueña, también corrige lo que otra persona guardó para el equipo', await c.page.getByRole('button', { name: /^Corregir: no escribir a Adecco/ }).count() === 1);
      } },
    ] },
  { id: 'cowork-uso', persona: 'owner', title: 'Saber cuánto del uso del asistente llevo, antes de chocar con el tope',
    goal: 'Ver el uso de la conversación y el del día en el resumen (COW-15).',
    steps: [
      { say: 'Abro la conversación de Sodexo', do: async c => { await c.go(`/cowork?work=${run(7)}`); await c.see('sí está reclutando en volumen'); } },
      { say: 'Abro el resumen de la conversación', do: async c => {
        await c.click({ role: 'button', name: 'Ver resumen de la conversación' });
        await c.see('Uso del asistente');
        const text = await c.page.getByRole('dialog').first().innerText().catch(() => '');
        c.check('el resumen dice el uso de la conversación y el de hoy', /Uso del asistente: esta conversación \d+ % · hoy \d+ %/.test(text), text.match(/Uso del asistente[^\n]*/)?.[0] || 'sin la línea');
      } },
    ] },
  // «Autónomo» (COW-17): it shows with AUDIT_COWORK_AUTONOMY=true, as in production since 24 Oct; it asks once and is remembered.
  ...(process.env.AUDIT_COWORK_AUTONOMY === 'true' ? [
    { id: 'cowork-modo-autonomo', persona: 'owner', title: 'Activar el modo Autónomo sabiendo qué aprueba solo',
      goal: 'Que Cowork avance sin pedir cada paso, sabiendo qué hará por su cuenta y que lo recuerde.',
      steps: [
        { say: 'Abro Cowork', do: async c => { await c.go('/cowork'); await c.see('¿Qué puedes hacer?'); } },
        { say: 'Elijo «Autónomo»', do: async c => {
          await c.choose('Modo de trabajo', 'Autónomo');
          await c.seeRole('dialog', /Trabajar en modo Autónomo/);
          c.check('dice qué aprueba solo y qué nunca', await c.has('Guardar contactos') && await c.has('Enviar correos, activar campañas'));
        } },
        { say: 'Lo activo', do: async c => {
          await c.click('Activar Autónomo'); await c.see('Autónomo: aprueba por ti hasta 3 pasos por conversación');
        } },
        { say: 'Vuelvo a entrar', do: async c => {
          await c.go('/cowork'); await c.see('¿Qué puedes hacer?'); await c.wait(1500);
          c.check('lo recuerda', (await c.page.getByLabel('Modo de trabajo').first().inputValue()) === 'autonomous');
          c.check('sin volver a preguntar', !(await c.has('Trabajar en modo Autónomo')));
        } },
      ] },
  ] : []),
  // The scheduled tasks are off in production: AUDIT_COWORK_SCHEDULES=true turns them on for this bench (COWORK_SCHEDULES_ENABLED).
  ...(process.env.AUDIT_COWORK_SCHEDULES === 'true' ? [
    { id: 'cowork-tareas-programadas', persona: 'owner', title: 'Ver mis tareas programadas y programar una nueva',
      goal: 'Saber qué hace Cowork por mí cada semana, cuándo corre la próxima vez, y crear una tarea nueva con un pedido que ya escribí.',
      steps: [
        { say: 'Abro Cowork', do: async c => { await c.go('/cowork'); await c.see('Investiga qué hace Sodexo Chile'); } },
        { say: 'Abro «Tareas programadas» desde el pie de la lista', do: async c => {
          await c.click({ role: 'button', name: 'Tareas programadas' });
          await c.see('Resumen del lunes');
          c.check('cada tarea dice cuándo corre', await c.has('Los lunes a las 09:00') && await c.has('De lunes a viernes a las 08:30') && await c.has('El día 1 de cada mes a las 18:00'));
          c.check('la tarea activa dice cuándo es la próxima vez y la pausada, que está pausada', await c.has('Próxima:') && await c.has('Pausada porque no pudo iniciarse tres veces seguidas'));
          c.check('se cuenta cuántas hay activas', await c.has('2 de 5 activas'));
          c.check('hay una sola acción principal', await c.page.getByRole('button', { name: 'Nueva tarea' }).count() === 1);
        } },
        { say: 'Abro el menú de la tarea pausada', do: async c => {
          await c.click({ role: 'button', name: /Opciones de «Respuestas nuevas de la mañana»/ });
          c.check('el menú ofrece ejecutarla, editarla, reanudarla y eliminarla', await c.has('Ejecutar ahora') && await c.has('Editar') && await c.has('Reanudar') && await c.has('Eliminar'));
          await c.page.keyboard.press('Escape');
        } },
        { say: 'Pulso «Nueva tarea»', do: async c => {
          await c.click({ role: 'button', name: 'Nueva tarea' });
          await c.see('Qué debe hacer');
          const labels = await c.page.locator('label').allInnerTexts();
          c.check('cada campo tiene su etiqueta', ['Nombre', 'Qué debe hacer', 'Con qué frecuencia', 'A las', 'Qué día'].every(label => labels.some(text => text.includes(label))), labels.join(' | '));
          c.check('el formulario tiene Programar y Cancelar', await c.page.getByRole('button', { name: 'Programar' }).isVisible() && await c.page.getByRole('button', { name: 'Cancelar' }).isVisible());
        } },
        { say: 'Reviso que nada desborde', do: async c => {
          const overflow = await c.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
          c.check('sin desborde horizontal', overflow <= 1, `${overflow}px`);
        } },
      ] },
    { id: 'cowork-programar-pedido', persona: 'owner', title: 'Programar un pedido que acabo de escribir',
      goal: 'Escribir un pedido con su horario y programarlo sin volver a escribirlo.',
      steps: [
        { say: 'Abro Cowork y escribo el pedido', do: async c => {
          await c.go('/cowork');
          // The page has to be alive before it is typed on: a text typed while it loads is dropped when it wakes up.
          await c.see('Para hoy');
          await c.wait(1500);
          await c.fill({ label: 'Escribe tu mensaje' }, 'Cada lunes a las 9, dime a quién escribir hoy');
        } },
        { say: 'Pulso «Programar este pedido»', do: async c => {
          await c.click({ role: 'button', name: 'Programar este pedido' });
          await c.see('Qué debe hacer');
          const form = c.page.getByRole('dialog');
          c.check('el nombre sale del pedido, sin las palabras del horario', await form.locator('input[maxlength="80"]').inputValue() === 'Dime a quién escribir hoy');
          c.check('el pedido queda tal como se escribió', await form.locator('textarea').inputValue() === 'Cada lunes a las 9, dime a quién escribir hoy');
          c.check('el horario sale del pedido: una vez por semana, a las 09:00', await form.locator('select').first().inputValue() === 'weekly' && await form.locator('input[type="time"]').inputValue() === '09:00');
        } },
      ] },
    { id: 'cowork-programar-respuesta', persona: 'owner', title: 'Programar lo que le pedí a Cowork, desde su respuesta',
      goal: 'Repetir un pedido que funcionó sin volver a escribirlo (COW-18).',
      steps: [
        { say: 'Abro la conversación de Sodexo', do: async c => { await c.go(`/cowork?work=${run(7)}`); await c.see('sí está reclutando en volumen'); await c.wait(1500); } },
        { say: 'Pulso «Programar» bajo la respuesta', do: async c => {
          await c.click({ role: 'button', name: 'Programar' });
          await c.see('Qué debe hacer');
          const form = c.page.getByRole('dialog');
          c.check('el pedido queda tal como lo escribí', await form.locator('textarea').inputValue() === 'Investiga qué hace Sodexo Chile y si está contratando');
        } },
      ] },
    { id: 'cowork-tareas-programadas-telefono', persona: 'owner', viewport: 'phone', title: 'Desde el teléfono: ver mis tareas programadas',
      goal: 'Leer la lista de tareas y abrir el formulario en una pantalla angosta, sin desbordes.',
      steps: [
        { say: 'Abro Cowork y la lista de conversaciones', do: async c => {
          await c.go('/cowork');
          await c.see('Para hoy');
          await c.wait(1500);
          await c.click({ role: 'button', name: 'Mostrar conversaciones' });
        } },
        { say: 'Abro «Tareas programadas»', do: async c => {
          await c.click({ role: 'button', name: 'Tareas programadas' });
          await c.see('Resumen del lunes');
          const overflow = await c.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
          c.check('sin desborde horizontal', overflow <= 1, `${overflow}px`);
        } },
      ] },
  ] : []),
  { id: 'cowork-busqueda-editar', persona: 'owner', title: 'Corregir los criterios de una búsqueda antes de aprobarla',
    goal: 'Cambiar el cargo, el lugar y la cantidad en la tarjeta, sin pedirle a Cowork otra versión (COW-29).',
    passWrites: [{ pattern: /^\/api\/cowork\/runs\/[0-9a-f-]{36}\/search-approval$/ }],
    steps: [
      { say: 'Abro la búsqueda que espera mi aprobación', do: async c => {
        await c.go(`/cowork?work=${run(8)}`);
        await c.see('Necesita tu aprobación');
        await c.see('Gerente de Personas');
        await c.wait(1500);
      } },
      { say: 'Edito cargos, lugar y cantidad', do: async c => {
        await c.click({ role: 'button', name: 'Editar criterios' });
        await c.fill({ label: 'Cargos (y parecidos)' }, 'Gerente de Personas\nJefe de Selección');
        await c.fill({ label: 'Ubicación de la persona' }, 'Antofagasta, Chile');
        await c.fill({ label: 'Cantidad' }, '10');
        await c.click({ role: 'button', name: 'Guardar cambios' });
        await c.see('Se buscará con tus cambios.');
        const saved = c.table('cowork_search_proposals')[0]?.criteria;
        c.check('la búsqueda que espera queda con los cambios', JSON.stringify(saved?.titles) === '["Gerente de Personas","Jefe de Selección"]'
          && JSON.stringify(saved?.locations) === '["Antofagasta, Chile"]' && saved?.limit === 10, JSON.stringify(saved || null).slice(0, 200));
        c.check('la tarjeta muestra lo que se va a buscar', await c.has('Jefe de Selección') && await c.has('Antofagasta, Chile') && await c.has('Hasta 10 personas'));
        c.check('«Qué va a pasar» dice la cantidad nueva', await c.has('hasta 10 contactos nuevos') && !(await c.has('hasta 25 contactos nuevos')));
        c.check('la conversación guarda el cambio', c.table('cowork_run_events').some(event => event.kind === 'proposal.edited' && event.payload?.kind === 'search'));
        c.check('sigue esperando mi aprobación', await c.page.getByRole('button', { name: 'Buscar contactos' }).count() === 1);
      } },
    ] },
  { id: 'cowork-editar-anterior', persona: 'owner', title: 'Corregir un mensaje anterior, no solo el último',
    goal: 'Ver que cada mensaje propio se puede editar y qué pasa con lo que siguió (COW-08).',
    steps: [
      { say: 'Abro la conversación de esta semana', do: async c => { await c.go(`/cowork?work=${run(5)}`); await c.see('Aquí va una versión más directa'); await c.wait(1500); } },
      { say: 'Edito mi primer mensaje', do: async c => {
        const buttons = c.page.getByRole('button', { name: 'Editar mensaje' });
        c.check('mi primer mensaje y el último se pueden editar', await buttons.count() === 2, `${await buttons.count()} botones`);
        await buttons.first().click({ force: true });
        await c.see('Se abre como una conversación nueva; esta queda en tu lista.');
        c.check('el texto queda listo para cambiar', await c.page.getByLabel('Edita tu mensaje').inputValue() === '¿A quién le escribo esta semana?');
        await c.page.keyboard.press('Escape');
        await c.notSee('Se abre como una conversación nueva');
      } },
    ] },
  { id: 'cowork-pedidos-guardados', persona: 'owner', title: 'Guardar un pedido que funcionó y repetirlo con «/»',
    goal: 'Guardar el pedido escrito, compartirlo con el equipo y volver a usarlo sin escribirlo (COW-06).', passWrites: [{ pattern: /^\/api\/cowork\/prompts/ }],
    steps: [
      { say: 'Abro Cowork y escribo un pedido', do: async c => {
        await c.go('/cowork');
        // The page has to be alive before it is typed on: a text typed while it loads is dropped when it wakes up.
        await c.see('Para hoy');
        await c.wait(1500);
        await c.fill({ label: 'Escribe tu mensaje' }, 'Busca gerentes de personas en empresas de seguridad privada de Santiago y prepárales un correo');
      } },
      { say: 'Lo guardo para mi equipo', do: async c => {
        await c.click({ role: 'button', name: 'Guardar este pedido' });
        await c.seeRole('dialog', 'Guardar este pedido');
        c.check('la lista trae el mío y el que compartió el equipo, no el privado de otra persona',
          await c.has('Seguimiento sin respuesta') && await c.has('Informe del lunes') && !(await c.has('Mi lista de retail')));
        await c.fill({ label: 'Nombre' }, 'Seguridad privada');
        await c.page.getByLabel('Compartir con mi equipo').check();
        await c.click({ role: 'button', name: 'Guardar pedido' });
        await c.see('Guardaste «Seguridad privada»');
        const saved = c.table('cowork_prompts').find(row => row.title === 'Seguridad privada');
        const me = c.table('cowork_prompts').find(row => row.title === 'Seguimiento sin respuesta')?.user_id;
        c.check('queda guardado a mi nombre y compartido', Boolean(me) && saved?.user_id === me && saved?.shared === true
          && saved?.prompt === 'Busca gerentes de personas en empresas de seguridad privada de Santiago y prepárales un correo', JSON.stringify(saved || null).slice(0, 160));
      } },
      { say: 'Lo uso otra vez con «/»', do: async c => {
        await c.page.keyboard.press('Escape');
        await c.notSee('Guardaste «Seguridad privada»');
        await c.fill({ label: 'Escribe tu mensaje' }, '/segu');
        await c.seeRole('listbox', 'Plantillas');
        c.check('«/» ofrece el pedido guardado y dice que es mío', await c.page.getByRole('option', { name: /Seguridad privada.*Guardado/ }).count() === 1);
        await c.page.keyboard.press('Enter');
        const value = await c.page.getByLabel('Escribe tu mensaje').inputValue();
        c.check('el pedido queda escrito en la caja', value === 'Busca gerentes de personas en empresas de seguridad privada de Santiago y prepárales un correo', value.slice(0, 80));
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

// Journeys of «Oportunidades»: what an administrator and a member do with the workspace of fixtures/opportunity-workspace.mjs.
// Opportunity numbers are the ones of that file: 2 is the tender in preparation with its report (Diego works it, Camila is on it),
// 3 and 6 are assigned to Diego (6 closes tomorrow), 9 is recommended and nobody has it, 10 is submitted and 11 won.
const opp = n => `00000000-0000-4000-8000-${String(9510 + n).padStart(12, '0')}`;
const WORKSPACE = /^\/api\/commercial-opportunities\/[0-9a-f-]{36}\/workspace$/;
const ACTIONS = { pattern: WORKSPACE, actions: ['assign', 'state', 'activity', 'task', 'mark', 'decision', 'decision_reply'] };
const NOTIFY = { pattern: /^\/api\/commercial-opportunities\/workspace$/, actions: ['notification'] };

/** The button of the card of an opportunity, found by its title: the nearest block around the title that has that button is the card. */
const inCard = (c, title, button) => c.page.getByText(title, { exact: true }).filter({ visible: true }).first()
  .locator(`xpath=ancestor::*[.//button[contains(normalize-space(.), "${button}")]][1]`).getByRole('button', { name: new RegExp(button) }).first();
const open = async (c, title, button) => { await c.clickOn(inCard(c, title, button)); };
const workOf = (c, n) => c.table('opportunity_work').find(row => row.opportunity_id === opp(n));
const stateOf = (c, n) => workOf(c, n)?.state ?? 'unassigned';

export default () => [
  // ─── Administrator ───────────────────────────────────────────────────────────────────────────────────────────────────────
  { id: 'admin-asignar', persona: 'owner', title: 'Administrador: asignar una recomendada a Diego desde el embudo', goal: 'Que Diego tenga la Compra Ágil de Maipú con su objetivo, sin salir de la lista.', passWrites: [ACTIONS],
    steps: [
      { say: 'Abro Oportunidades', do: async c => { await c.go('/opportunities'); await c.see('Gestionar oportunidades'); } },
      { say: 'Elijo la etapa Recomendadas', do: async c => { await c.click({ text: 'Recomendadas' }); await c.see('Compra Ágil: personal administrativo de apoyo'); } },
      { say: 'Pulso Asignar en la tarjeta de Maipú', do: async c => { await open(c, 'Compra Ágil: personal administrativo de apoyo', 'Asignar'); await c.seeRole('dialog', /Asignar/); } },
      { say: 'Toco a Diego', do: async c => { await c.click({ role: 'button', name: /Diego Fuentes/ }); } },
      { say: 'Escribo el objetivo', do: async c => { await c.fill({ placeholder: 'Ej.: presentar la oferta antes del cierre' }, 'Postular con el mismo precio por persona de Providencia.'); } },
      { say: 'Pulso Asignar y notificar', do: async c => {
        await c.click('Asignar y notificar'); await c.wait(1500);
        c.check('la oportunidad quedó asignada', stateOf(c, 9) === 'assigned', `estado: ${stateOf(c, 9)}`);
        c.check('Diego es parte del equipo', c.table('opportunity_participants').some(row => row.opportunity_id === opp(9) && row.user_id === '00000000-0000-4000-8000-000000000012'));
        c.check('el objetivo quedó escrito', /precio por persona/.test(workOf(c, 9)?.objective || ''));
        c.check('sigue en la lista, sin abrir la oportunidad', await c.has('Gestionar oportunidades'));
      } },
    ] },
  { id: 'admin-asignar-detalle', persona: 'owner', title: 'Administrador: asignar desde la oportunidad abierta', goal: 'Lo mismo, para quien ya la abrió a leerla.', passWrites: [ACTIONS],
    steps: [
      { say: 'Abro la compra de Maipú', do: async c => { await c.go(`/opportunities?op=${opp(9)}`); await c.see('Asignar equipo'); } },
      { say: 'Pulso Asignar equipo', do: async c => { await c.click('Asignar equipo'); await c.see('Asignar equipo de trabajo'); } },
      { say: 'Toco a Diego', do: async c => { await c.click({ role: 'button', name: /Diego Fuentes/ }); } },
      { say: 'Pulso Asignar y notificar', do: async c => {
        await c.click('Asignar y notificar'); await c.wait(1500);
        c.check('la oportunidad quedó asignada', stateOf(c, 9) === 'assigned', `estado: ${stateOf(c, 9)}`);
      } },
    ] },
  { id: 'admin-decision', persona: 'owner', title: 'Administrador: responder la decisión que pidió Diego', goal: 'Contestar si se ofrece el módulo opcional.', passWrites: [ACTIONS, NOTIFY],
    steps: [
      { say: 'Abro Oportunidades', do: async c => { await c.go('/opportunities'); await c.see('Gestionar oportunidades'); } },
      { say: 'Veo la novedad de la decisión pedida', do: async c => { await c.see('Decisión pedida'); } },
      { say: 'Abro la licitación desde la novedad', do: async c => { await c.click({ text: 'Decisión pedida' }); await c.see('Pide una decisión'); } },
      { say: 'Escribo mi respuesta', do: async c => { await c.fill('Tu respuesta', 'Sí, ofrécelo como opcional con el 12 % extra.'); } },
      { say: 'Pulso Responder', do: async c => {
        await c.click('Responder'); await c.wait(1500);
        c.check('la respuesta quedó en la actividad', c.table('opportunity_activity').some(row => row.opportunity_id === opp(2) && /Respuesta a la decisión/.test(row.body)));
      } },
    ] },
  { id: 'admin-presentada', persona: 'owner', title: 'Administrador: marcar una oportunidad como presentada', goal: 'Que la invitación de aseo pase a «Presentada».', passWrites: [ACTIONS],
    steps: [
      { say: 'Abro Oportunidades', do: async c => { await c.go('/opportunities'); await c.see('Gestionar oportunidades'); } },
      { say: 'Elijo En preparación', do: async c => { await c.click({ text: 'En preparación' }); await c.see('Invitación a cotizar: aseo industrial para planta de producción'); } },
      { say: 'Abro la invitación de aseo', do: async c => { await open(c, 'Invitación a cotizar: aseo industrial para planta de producción', 'Abrir'); await c.see('Asignar equipo'); } },
      { say: 'Cambio la etapa a Presentada', do: async c => {
        await c.choose('Cambiar etapa', 'Presentada'); await c.wait(1200);
        c.check('la oportunidad quedó presentada', stateOf(c, 7) === 'submitted', `estado: ${stateOf(c, 7)}`);
      } },
    ] },
  { id: 'admin-marcar-informe', persona: 'owner', title: 'Administrador: marcar un paso del informe como hecho', goal: 'Que «Pedir las referencias» quede hecho.', passWrites: [ACTIONS],
    steps: [
      { say: 'Abro la licitación', do: async c => { await c.go(`/opportunities?op=${opp(2)}`); await c.see('Qué hacer ahora'); } },
      { say: 'Marco el primer paso', do: async c => {
        await c.click({ role: 'checkbox', name: /Pedir las dos referencias/ }).catch(async () => { await c.click({ role: 'button', name: /Pedir las dos referencias/ }); });
        await c.wait(1200);
        c.check('el paso quedó marcado', c.table('opportunity_report_marks').some(row => row.opportunity_id === opp(2) && row.done), 'opportunity_report_marks');
      } },
    ] },

  // ─── Member ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
  { id: 'miembro-urgente', persona: 'member', title: 'Integrante: abrir lo más urgente y empezar a gestionarlo', goal: 'Empezar la licitación de guardias, que cierra mañana.', passWrites: [ACTIONS, NOTIFY],
    steps: [
      { say: 'Abro Oportunidades', do: async c => { await c.go('/opportunities'); await c.see('Mis oportunidades asignadas'); } },
      { say: 'Veo qué cierra primero', do: async c => {
        const first = await c.page.locator('h3, h2').filter({ hasText: /Servicio de guardias de seguridad/ }).first().isVisible().catch(() => false);
        c.check('lo más urgente se ve sin buscar', first);
      } },
      { say: 'Abro la licitación de guardias', do: async c => { await open(c, 'Servicio de guardias de seguridad para 12 sucursales', 'Abrir y trabajar'); await c.see('Empezar a gestionarla'); } },
      { say: 'Pulso Empezar a gestionarla', do: async c => {
        await c.click('Empezar a gestionarla'); await c.wait(1200);
        c.check('quedó en gestión', stateOf(c, 6) === 'working', `estado: ${stateOf(c, 6)}`);
      } },
    ] },
  { id: 'miembro-bloqueo', persona: 'member', title: 'Integrante: reportar un bloqueo', goal: 'Avisar que falta el certificado de antecedentes.', passWrites: [ACTIONS],
    steps: [
      { say: 'Abro la licitación en gestión', do: async c => { await c.go(`/opportunities?op=${opp(2)}`); await c.see('Reportar un bloqueo'); } },
      { say: 'Pulso Reportar un bloqueo', do: async c => { await c.click('Reportar un bloqueo'); await c.see('Cuenta qué te frena'); } },
      { say: 'Cuento qué me frena', do: async c => { await c.fill({ role: 'textbox', name: /./ }, 'El certificado de antecedentes tarda 5 días hábiles en llegar.').catch(async () => { await c.page.getByRole('dialog').getByRole('textbox').first().fill('El certificado de antecedentes tarda 5 días hábiles en llegar.'); }); } },
      { say: 'Envío el bloqueo', do: async c => {
        await c.page.getByRole('dialog').getByRole('button', { name: /Reportar|Enviar|Avisar|Guardar/ }).last().click(); await c.wait(1500);
        c.check('quedó bloqueada', stateOf(c, 2) === 'blocked', `estado: ${stateOf(c, 2)}`);
      } },
    ] },
  { id: 'miembro-decision', persona: 'member', title: 'Integrante: proponer no postular', goal: 'Plantear a los administradores que no conviene postular a la compra de Maipú.', passWrites: [ACTIONS],
    steps: [
      { say: 'Abro la compra asignada', do: async c => { await c.go(`/opportunities?op=${opp(3)}`); await c.see('Plantear una decisión'); } },
      { say: 'Pulso Plantear una decisión', do: async c => { await c.click('Plantear una decisión'); await c.seeRole('dialog', /Plantear una decisión/); } },
      { say: 'Elijo proponer no postular', do: async c => { await c.click({ role: 'button', name: /no postular/i }).catch(() => c.note('No encuentro la opción «Propongo no postular».')); } },
      { say: 'Escribo el motivo y envío', do: async c => {
        const dialog = c.page.getByRole('dialog');
        await dialog.getByRole('textbox').first().fill('El monto no paga el costo de preparar la oferta.');
        await dialog.getByRole('button', { name: /Enviar|Plantear|Proponer/ }).last().click(); await c.wait(1500);
        c.check('la propuesta quedó en la actividad', c.table('opportunity_activity').some(row => row.opportunity_id === opp(3) && row.kind === 'decision'));
      } },
    ] },
  { id: 'miembro-presentada', persona: 'member', title: 'Integrante: marcar su oferta como presentada', goal: 'Cerrar el trabajo de la licitación de Providencia.', passWrites: [ACTIONS],
    steps: [
      { say: 'Abro la licitación en gestión', do: async c => { await c.go(`/opportunities?op=${opp(2)}`); await c.see('Marcar como presentada'); } },
      { say: 'Pulso Marcar como presentada', do: async c => {
        await c.click('Marcar como presentada'); await c.wait(1500);
        c.check('quedó presentada', stateOf(c, 2) === 'submitted', `estado: ${stateOf(c, 2)}`);
      } },
    ] },
  { id: 'miembro-movil', persona: 'member', viewport: 'phone', title: 'Integrante en el móvil: ver y empezar lo urgente', goal: 'Lo mismo que en el computador, con el pulgar.', passWrites: [ACTIONS, NOTIFY],
    steps: [
      { say: 'Abro Oportunidades', do: async c => { await c.go('/opportunities'); await c.see('Mis oportunidades asignadas'); } },
      { say: 'Abro la urgente', do: async c => { await open(c, 'Servicio de guardias de seguridad para 12 sucursales', 'Abrir y trabajar'); await c.see('Empezar a gestionarla'); } },
      { say: 'Empiezo a gestionarla', do: async c => {
        await c.click('Empezar a gestionarla'); await c.wait(1200);
        c.check('quedó en gestión', stateOf(c, 6) === 'working', `estado: ${stateOf(c, 6)}`);
      } },
    ] },
  { id: 'admin-movil', persona: 'owner', viewport: 'phone', title: 'Administrador en el móvil: ver el embudo y abrir una', goal: 'Revisar qué hay recomendado desde el teléfono.',
    steps: [
      { say: 'Abro Oportunidades', do: async c => { await c.go('/opportunities'); await c.see('Gestionar oportunidades'); } },
      { say: 'Elijo Recomendadas', do: async c => { await c.click({ text: 'Recomendadas' }); await c.see('Compra Ágil: personal administrativo de apoyo'); } },
      { say: 'Abro la compra de Maipú', do: async c => { await open(c, 'Compra Ágil: personal administrativo de apoyo', 'Abrir'); await c.see('Asignar equipo'); } },
    ] },
];

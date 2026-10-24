// Journeys of «Oportunidades»: what an administrator and a member do with the workspace of fixtures/opportunity-workspace.mjs.
// Opportunity numbers are the ones of that file: 2 is the tender in preparation with its report (Diego works it, Camila is on it),
// 3 and 6 are assigned to Diego (6 closes tomorrow), 9 is recommended and nobody has it, 10 is submitted and 11 won.
import { standsOut } from '../checks.mjs';
const opp = n => `00000000-0000-4000-8000-${String(9510 + n).padStart(12, '0')}`;
const WORKSPACE = /^\/api\/commercial-opportunities\/[0-9a-f-]{36}\/workspace$/;
const ACTIONS = { pattern: WORKSPACE, actions: ['assign', 'state', 'activity', 'task', 'mark', 'decision', 'decision_reply'] };
const NOTIFY = { pattern: /^\/api\/commercial-opportunities\/workspace$/, actions: ['notification'] };
const BULK = { pattern: /^\/api\/commercial-opportunities\/workspace$/, actions: ['bulk', 'notification'] };
const CRITERIA = { pattern: /^\/api\/commercial-opportunities\/workspace$/, actions: ['criteria'] };

/**
 * The button of the card of an opportunity, found by its title: the nearest block around the title that has that button is the card.
 * The title also shows in «Cierran esta semana» over the road, whose block holds every card: that one is not the card.
 */
const inCard = (c, title, button) => c.page.getByText(title, { exact: true }).filter({ visible: true })
  .and(c.page.locator('xpath=//*[not(ancestor-or-self::*[@aria-labelledby="pipeline-week"])]')).first()
  .locator(`xpath=ancestor::*[.//button[contains(normalize-space(.), "${button}")]][1]`).getByRole('button', { name: new RegExp(button) }).first();
const open = async (c, title, button) => { await c.clickOn(inCard(c, title, button)); };
const workOf = (c, n) => c.table('opportunity_work').find(row => row.opportunity_id === opp(n));
const stateOf = (c, n) => workOf(c, n)?.state ?? 'unassigned';
/** Whether «Cómo postular» in the header is the filled, main action of the page (the first button of that name: the tab comes after it). */
const applyIsMain = c => c.page.getByRole('button', { name: 'Cómo postular' }).first().evaluate(node => /\bbg-primary\b/.test(node.className)).catch(() => null);

export default () => [
  // ─── Administrator ───────────────────────────────────────────────────────────────────────────────────────────────────────
  { id: 'admin-descartar', persona: 'owner', title: 'Administrador: «No es para nosotros» desde el embudo, y deshacerlo', goal: 'Sacar la compra de Maipú de las recomendadas con su motivo, y arrepentirse.', passWrites: [BULK],
    steps: [
      { say: 'Abro Oportunidades', do: async c => { await c.go('/opportunities'); await c.see('Gestionar oportunidades'); } },
      { say: 'Elijo la etapa Recomendadas', do: async c => { await c.click({ text: 'Recomendadas' }); await c.see('Compra Ágil: personal administrativo de apoyo'); } },
      { say: 'Pulso «No es para nosotros» en la tarjeta de Maipú', do: async c => { await open(c, 'Compra Ágil: personal administrativo de apoyo', 'No es para nosotros'); await c.seeRole('dialog', /No es para nosotros/); } },
      { say: 'Elijo el motivo y archivo', do: async c => {
        c.check('sin motivo no se puede archivar', await c.page.getByRole('button', { name: 'Archivar', exact: true }).isDisabled());
        await c.click({ role: 'radio', name: 'El monto no conviene' });
        await c.click({ role: 'button', name: 'Archivar' }); await c.see('Pasó a «Archivadas»');
        c.check('quedó archivada', stateOf(c, 9) === 'archived', `estado: ${stateOf(c, 9)}`);
        c.check('el motivo quedó en la actividad', c.table('opportunity_activity').some(row => row.opportunity_id === opp(9) && row.kind === 'discarded' && row.data?.reason === 'monto'));
        c.check('salió de las recomendadas', !(await c.has('Compra Ágil: personal administrativo de apoyo')));
      } },
      { say: 'Me arrepiento: Deshacer', do: async c => {
        await c.click('Deshacer'); await c.see('vuelve a las que nadie trabaja');
        c.check('volvió a las que nadie trabaja', stateOf(c, 9) === 'unassigned', `estado: ${stateOf(c, 9)}`);
      } },
    ] },
  { id: 'admin-que-buscamos', persona: 'owner', title: 'Administrador: ver cómo fue la búsqueda, apagar LinkedIn y poner un monto máximo', goal: 'Que la búsqueda diaria no gaste en LinkedIn ni lea licitaciones demasiado grandes.', passWrites: [CRITERIA],
    steps: [
      { say: 'Abro Oportunidades y miro cómo fue la búsqueda de hoy', do: async c => {
        await c.go('/opportunities'); await c.see('Última búsqueda');
        c.check('dice qué fuente no respondió y por qué', await c.has('1 de 2 búsquedas respondieron'));
      } },
      { say: 'Pulso «Qué buscamos»', do: async c => { await c.click('Qué buscamos'); await c.seeRole('dialog', /Qué buscamos/); await c.see('Fuentes'); } },
      { say: 'Apago LinkedIn', do: async c => {
        await c.click({ role: 'switch', name: 'Publicaciones de LinkedIn' });
        c.check('sin LinkedIn no pide búsquedas de publicaciones', !(await c.has('Búsquedas de publicaciones')));
      } },
      { say: 'Escribo el monto máximo y guardo', do: async c => {
        await c.fill('Monto máximo (CLP) · opcional', '200.000.000');
        await c.click({ role: 'button', name: 'Guardar' }); await c.see('Cambios guardados');
        const search = c.table('opportunity_company_context')[0]?.search || {};
        c.check('LinkedIn quedó apagado', search.sources?.posts === false, JSON.stringify(search.sources));
        c.check('el monto máximo quedó guardado', search.tenders?.maxAmount === 200_000_000, `máximo: ${search.tenders?.maxAmount}`);
        c.check('lo que ya estaba sigue igual', search.tenders?.minAmount === 2_000_000 && search.sources?.hiring === false);
      } },
    ] },
  { id: 'admin-varias', persona: 'owner', title: 'Administrador: asignar dos recomendadas de una vez desde la Lista', goal: 'Darle a Diego las dos empresas que contratan, en un paso.', passWrites: [BULK],
    steps: [
      { say: 'Abro la Lista de recomendadas desde su dirección', do: async c => {
        await c.go('/opportunities?vista=lista&etapa=recommended'); await c.see('Retail Andino contrata 40 vendedores para nuevas tiendas');
        c.check('el filtro de la dirección queda marcado', (await c.page.getByRole('button', { name: /^Recomendadas/ }).first().getAttribute('aria-pressed')) === 'true');
      } },
      { say: 'Marco las dos empresas que contratan', do: async c => {
        await c.click({ role: 'checkbox', name: /Retail Andino contrata/ }); await c.click({ role: 'checkbox', name: /Logística Sur busca/ });
        await c.seeRole('region', 'Acciones con las oportunidades seleccionadas'); await c.see('2 seleccionadas');
      } },
      { say: 'Pulso Asignar en la barra', do: async c => { await c.click({ role: 'button', name: 'Asignar' }); await c.seeRole('dialog', /Asignar 2 oportunidades/); } },
      { say: 'Toco a Diego y asigno', do: async c => {
        await c.click({ role: 'button', name: /Diego Fuentes/ }); await c.click('Asignar y notificar'); await c.see('Asignamos 2');
        c.check('las dos quedaron asignadas', stateOf(c, 0) === 'assigned' && stateOf(c, 1) === 'assigned', `estados: ${stateOf(c, 0)}, ${stateOf(c, 1)}`);
        c.check('la selección se vació', !(await c.has('2 seleccionadas')));
      } },
    ] },
  { id: 'admin-filtros-url', persona: 'owner', title: 'Administrador: los filtros viven en la dirección y «Atrás» vuelve al anterior', goal: 'Compartir «Por revisar» de la Lista y volver al filtro de antes.', passWrites: [],
    steps: [
      { say: 'Abro Oportunidades y paso a la Lista', do: async c => { await c.go('/opportunities'); await c.see('Gestionar oportunidades'); await c.click({ role: 'button', name: 'Lista' }); await c.wait(800); } },
      { say: 'Elijo «Por revisar»', do: async c => {
        await c.click({ role: 'button', name: /^Por revisar/ }); await c.wait(800);
        const url = new URL(c.page.url());
        c.check('la dirección lleva la vista y el filtro', url.searchParams.get('vista') === 'lista' && url.searchParams.get('etapa') === 'review', url.search);
      } },
      { say: 'Vuelvo atrás con el navegador', do: async c => {
        await c.page.goBack(); await c.wait(1000);
        c.check('vuelve al filtro anterior', (await c.page.getByRole('button', { name: /^Recomendadas/ }).first().getAttribute('aria-pressed')) === 'true', new URL(c.page.url()).search);
      } },
    ] },
  { id: 'admin-asignar', persona: 'owner', title: 'Administrador: asignar una recomendada a Diego desde el embudo', goal: 'Que Diego tenga la Compra Ágil de Maipú con su objetivo, sin salir de la lista.', passWrites: [ACTIONS],
    steps: [
      { say: 'Abro Oportunidades', do: async c => { await c.go('/opportunities'); await c.see('Gestionar oportunidades'); } },
      { say: 'Elijo la etapa Recomendadas', do: async c => { await c.click({ text: 'Recomendadas' }); await c.see('Compra Ágil: personal administrativo de apoyo'); } },
      { say: 'Pulso Asignar en la tarjeta de Maipú', do: async c => { await open(c, 'Compra Ágil: personal administrativo de apoyo', 'Asignar'); await c.seeRole('dialog', /Asignar/); } },
      { say: 'Toco a Diego', do: async c => { await c.click({ role: 'button', name: /Diego Fuentes/ }); } },
      { say: 'Escribo el objetivo', do: async c => { await c.fill({ placeholder: 'Ej.: presentar la oferta antes del cierre' }, 'Postular con el mismo precio por persona de Providencia.'); } },
      { say: 'Elijo la próxima acción: Mañana', do: async c => {
        const dialog = c.page.getByRole('dialog');
        await c.click({ role: 'button', name: 'Mañana' });
        const on = dialog.getByRole('button', { name: 'Mañana' }).first();
        const { ok, ratio } = await standsOut(on, dialog.getByRole('button', { name: 'En 3 días' }).first());
        c.check('lo elegido se distingue de lo demás', (await on.getAttribute('aria-pressed').catch(() => null)) === 'true' && ok, `contraste ${ratio} a 1`);
      } },
      { say: 'Pulso Asignar y notificar', do: async c => {
        await c.click('Asignar y notificar'); await c.wait(1500);
        c.check('la oportunidad quedó asignada', stateOf(c, 9) === 'assigned', `estado: ${stateOf(c, 9)}`);
        c.check('Diego es parte del equipo', c.table('opportunity_participants').some(row => row.opportunity_id === opp(9) && row.user_id === '00000000-0000-4000-8000-000000000012'));
        c.check('el objetivo quedó escrito', /precio por persona/.test(workOf(c, 9)?.objective || ''));
        c.check('la próxima acción quedó para mañana', Boolean(workOf(c, 9)?.due_at), `due_at: ${workOf(c, 9)?.due_at}`);
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
      { say: 'Veo en «Novedades» que la decisión espera mi respuesta', do: async c => {
        await c.see('Esperan tu respuesta'); await c.see('Diego pide una decisión');
        c.check('la decisión se dice una vez, no también como novedad', !(await c.page.getByText(/^Decisión pedida:/).first().isVisible().catch(() => false)));
      } },
      { say: 'Pulso Responder', do: async c => {
        await c.click('Responder'); await c.see('Pide una decisión'); await c.wait(400);
        c.check('se abre en la caja para responder', (await c.page.evaluate(() => document.activeElement?.id).catch(() => null)) === 'decision-reply');
        c.check('mientras se gestiona, «Cómo postular» es la acción principal', (await applyIsMain(c)) === true);
      } },
      { say: 'Escribo mi respuesta', do: async c => { await c.fill('Tu respuesta', 'Sí, ofrécelo como opcional con el 12 % extra.'); } },
      { say: 'Envío la respuesta', do: async c => {
        await c.click('Responder'); await c.wait(1500);
        c.check('la respuesta quedó en la actividad', c.table('opportunity_activity').some(row => row.opportunity_id === opp(2) && /Respuesta a la decisión/.test(row.body)));
      } },
    ] },
  { id: 'admin-hoy', persona: 'owner', title: 'Administrador: «Hoy» dice qué espera su respuesta y qué cierra sin equipo', goal: 'Saber desde el inicio qué hacer en Oportunidades.', passWrites: [],
    steps: [
      { say: 'Abro Hoy', do: async c => { await c.go('/dashboard'); await c.see('Lo que te espera'); } },
      { say: 'Leo la tarjeta de Oportunidades', do: async c => {
        await c.see('Esperan tu respuesta'); await c.see('Diego pide una decisión');
        await c.see('Cierran esta semana y nadie las trabaja');
        c.check('cada fila abre su oportunidad', await c.page.locator(`a[href="/opportunities?op=${opp(2)}"]`).first().isVisible().catch(() => false));
      } },
      { say: 'Abro Oportunidades y veo lo que cierra esta semana sobre el embudo', do: async c => {
        await c.go('/opportunities'); await c.see('Embudo de oportunidades'); await c.see('Cierran esta semana');
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
  { id: 'admin-perdida', persona: 'owner', title: 'Administrador: cerrar una oportunidad presentada como perdida, con su motivo', goal: 'Que la propuesta presentada pase a «Perdida» y el equipo lea por qué.', passWrites: [ACTIONS],
    steps: [
      { say: 'Abro la oportunidad presentada', do: async c => {
        await c.go(`/opportunities?op=${opp(10)}`); await c.see('Cambiar etapa');
        c.check('presentada, «Cómo postular» ya no es la acción principal', (await applyIsMain(c)) === false);
      } },
      { say: 'Elijo la etapa Perdida', do: async c => { await c.choose('Cambiar etapa', 'Perdida'); await c.seeRole('dialog', /Pasar a Perdida/); c.check('aún no cambió: pide el motivo primero', stateOf(c, 10) === 'submitted', `estado: ${stateOf(c, 10)}`); } },
      { say: 'Cuento qué pasó, en una línea', do: async c => { await c.page.getByRole('dialog').getByRole('textbox').first().fill('Adjudicaron a otra empresa con menor plazo de entrega.'); } },
      { say: 'Pulso Pasar a Perdida', do: async c => {
        await c.page.getByRole('dialog').getByRole('button', { name: 'Pasar a Perdida' }).click(); await c.wait(1500);
        c.check('la oportunidad quedó perdida', stateOf(c, 10) === 'lost', `estado: ${stateOf(c, 10)}`);
        c.check('ya perdida, «Cómo postular» deja de ser la acción principal', (await applyIsMain(c)) === false);
        c.check('el motivo quedó en la actividad', c.table('opportunity_activity').some(row => row.opportunity_id === opp(10) && /perdida\. Adjudicaron a otra empresa/.test(row.body)), 'opportunity_activity');
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
        // The filter that is on must be seen: the list used to start with none marked for a member, and «secondary» on white is 1.1 to 1.
        const mine = c.page.getByRole('button', { name: 'Mi trabajo' }).first();
        const { ok, ratio } = await standsOut(mine, c.page.getByRole('button', { name: 'Nuevas asignaciones' }).first());
        c.check('«Mi trabajo» arranca marcado y se distingue de los demás', (await mine.getAttribute('aria-pressed').catch(() => null)) === 'true' && ok, `contraste ${ratio} a 1`);
      } },
      { say: 'Abro la licitación de guardias', do: async c => { await open(c, 'Servicio de guardias de seguridad para 12 sucursales', 'Abrir y trabajar'); await c.see('Empezar a gestionarla'); } },
      { say: 'Pulso Empezar a gestionarla', do: async c => {
        await c.click('Empezar a gestionarla'); await c.wait(1200);
        c.check('quedó en gestión', stateOf(c, 6) === 'working', `estado: ${stateOf(c, 6)}`);
      } },
    ] },
  { id: 'miembro-hoy', persona: 'member', title: 'Integrante: «Hoy» muestra sus oportunidades y la decisión que pidió', goal: 'Ver desde el inicio lo que trabaja y abrir lo que cierra primero.', passWrites: [NOTIFY],
    steps: [
      // Nothing of prospecting waits for Diego, so «Hoy» says «Nada pendiente por ahora» instead of «Lo que te espera».
      { say: 'Abro Hoy', do: async c => { await c.go('/dashboard'); await c.see('Nada pendiente por ahora'); } },
      { say: 'Leo la tarjeta de Oportunidades', do: async c => {
        await c.see('Esperando respuesta'); await c.see('Pediste una decisión'); await c.see('Las que trabajas'); await c.see('Informes listos');
        c.check('no ve lo que solo administra un administrador', !(await c.page.getByText('Cierran esta semana y nadie las trabaja').first().isVisible().catch(() => false)));
      } },
      { say: 'Abro la licitación de guardias desde Hoy', do: async c => {
        await c.click({ text: 'Servicio de guardias de seguridad para 12 sucursales' }); await c.see('Empezar a gestionarla');
        c.check('llega a la oportunidad', c.page.url().includes(`op=${opp(6)}`), c.page.url());
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

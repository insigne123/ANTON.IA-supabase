// Journeys of «Oportunidades»: what an administrator and a member do with the workspace of fixtures/opportunity-workspace.mjs.
// Opportunity numbers are the ones of that file: 2 is the tender in preparation with its report (Diego works it, Camila is on it),
// 3 and 6 are assigned to Diego (6 closes tomorrow), 9 is recommended and nobody has it, 10 is submitted and 11 won.
import { standsOut } from '../checks.mjs';
const opp = n => `00000000-0000-4000-8000-${String(9510 + n).padStart(12, '0')}`;
/** Diego, the member of the fixtures (ids.mjs). */
const DIEGO = '00000000-0000-4000-8000-000000000012';
const WORKSPACE = /^\/api\/commercial-opportunities\/[0-9a-f-]{36}\/workspace$/;
const ACTIONS = { pattern: WORKSPACE, actions: ['assign', 'state', 'activity', 'task', 'tasks', 'task_status', 'task_delete', 'note_edit', 'note_delete', 'mark', 'decision', 'decision_reply', 'offer_part', 'offer_review', 'offer_prices', 'price_study'] };
const NOTIFY = { pattern: /^\/api\/commercial-opportunities\/workspace$/, actions: ['notification'] };
const BULK = { pattern: /^\/api\/commercial-opportunities\/workspace$/, actions: ['bulk', 'notification'] };
const CRITERIA = { pattern: /^\/api\/commercial-opportunities\/workspace$/, actions: ['criteria'] };
const SETTINGS = { pattern: /^\/api\/commercial-opportunities\/workspace$/, actions: ['admin_settings', 'bulk', 'notification'] };
const DOCUMENTS = { pattern: /^\/api\/commercial-opportunities\/[0-9a-f-]{36}\/documents$/ };

/** Files dragged over the page and dropped where nothing else takes them, as the browser hands them over (OPP-17). */
const dropOnPage = (c, files, { drop = true } = {}) => c.page.evaluate(({ files, drop }) => {
  const data = new DataTransfer();
  for (const file of files) data.items.add(new File([Uint8Array.from(atob(file.base64), char => char.charCodeAt(0))], file.name, { type: file.type }));
  const target = document.querySelector('main') || document.body;
  target.dispatchEvent(new DragEvent('dragover', { dataTransfer: data, bubbles: true, cancelable: true }));
  if (drop) target.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }));
}, { files, drop });

/**
 * The button of the card of an opportunity, found by its title: the nearest block around the title that has that button is the card.
 * The title also shows in «Cierran esta semana» over the road, whose block holds every card: that one is not the card.
 */
const inCard = (c, title, button) => c.page.getByText(title, { exact: true }).filter({ visible: true })
  .and(c.page.locator('xpath=//*[not(ancestor-or-self::*[@aria-labelledby="pipeline-week"])]')).first()
  .locator(`xpath=ancestor::*[.//button[contains(normalize-space(.), "${button}")]][1]`).getByRole('button', { name: new RegExp(button) }).first();
const open = async (c, title, button) => { await c.clickOn(inCard(c, title, button)); };
const workOf = (c, n) => c.table('opportunity_work').find(row => row.opportunity_id === opp(n));
/** Whether a text shows within a few seconds: a check on something that arrives with the next reading of the page. */
const shows = (c, text) => c.page.getByText(text).filter({ visible: true }).first().waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false);
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
        const told = await c.page.getByText(/1 de 2 búsquedas respondieron/i).first().waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false);
        c.check('dice qué fuente no respondió y por qué', told, await c.page.locator('p', { hasText: 'Última búsqueda' }).first().innerText().catch(() => ''));
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
  { id: 'admin-reglas', persona: 'owner', title: 'Administrador: una regla de asignación y «Asignarla» en un paso', goal: 'Que las compras desde $5 M vayan a Diego sin elegirlo cada vez.', passWrites: [SETTINGS],
    steps: [
      { say: 'Abro las Recomendadas del embudo', do: async c => { await c.go('/opportunities'); await c.click({ text: 'Recomendadas' }); await c.see('Define quién trabaja cada rubro'); } },
      { say: 'Abro «Reglas de asignación»', do: async c => { await c.click('Reglas de asignación'); await c.seeRole('dialog', /Reglas de asignación/); } },
      { say: 'Desde $5.000.000, para Diego, y guardo', do: async c => {
        await c.fill('Desde (CLP) · opcional', '5.000.000');
        const person = c.page.getByRole('dialog').getByLabel('Para');
        c.check('cada persona dice cuánto trabaja ya', await person.evaluate(node => [...node.options].some(option => / en curso$/.test(option.text))));
        await person.selectOption(DIEGO);
        await c.click({ role: 'button', name: 'Guardar' }); await c.see('Reglas guardadas');
        const rules = c.table('opportunity_company_context')[0]?.admin_settings?.rules || [];
        c.check('la regla quedó guardada', rules.length === 1 && rules[0].minAmount === 5_000_000 && rules[0].category === null, JSON.stringify(rules));
      } },
      { say: 'Pulso «Asignarla» y confirmo', do: async c => {
        await c.see('1 calza con tus reglas'); c.check('la tarjeta dice a quién va', await shows(c, 'Asignar a Diego…'));
        await c.click({ role: 'button', name: 'Asignarla' }); await c.seeRole('dialog', /Asignar 1 según tus reglas/);
        await c.click({ role: 'button', name: 'Asignar y avisar' }); await c.see('Les avisamos por correo');
        const work = workOf(c, 9);
        c.check('quedó asignada a Diego como responsable', work?.state === 'assigned' && work?.responsible_id === DIEGO, `estado: ${work?.state}, responsable: ${work?.responsible_id}`);
      } },
    ] },
  { id: 'admin-busqueda-guardada', persona: 'owner', title: 'Administrador: guardar una búsqueda de la Lista y que avise de las nuevas', goal: 'Enterarse en el correo de la mañana de las licitaciones nuevas de «antecedentes».', passWrites: [SETTINGS],
    steps: [
      { say: 'Busco «antecedentes» en la Lista', do: async c => { await c.go('/opportunities?vista=lista&etapa=all&q=antecedentes'); await c.see('Guardar esta búsqueda'); } },
      { say: 'Guardo la búsqueda', do: async c => {
        await c.click('Guardar esta búsqueda'); await c.see('Te avisaremos en el correo de la mañana');
        const searches = c.table('opportunity_company_context')[0]?.admin_settings?.searches || [];
        c.check('quedó guardada con aviso para mí', searches.length === 1 && searches[0].query === 'antecedentes' && searches[0].notify.length === 1, JSON.stringify(searches));
        c.check('se ve como guardada', await shows(c, 'Te avisamos de las nuevas'));
      } },
      { say: 'Ya no quiero el aviso', do: async c => {
        await c.click('Te avisamos de las nuevas'); await c.see('Ya no te avisamos de esta búsqueda');
        c.check('el aviso quedó apagado', (c.table('opportunity_company_context')[0]?.admin_settings?.searches?.[0]?.notify || ['x']).length === 0);
      } },
    ] },
  { id: 'admin-preparar-empresa', persona: 'owner', title: 'Administrador: «Prepara tu empresa» lleva a subir los documentos', goal: 'Saber qué falta para postular bien y llegar a donde se sube.',
    steps: [
      { say: 'Abro Oportunidades y leo «Prepara tu empresa»', do: async c => {
        await c.go('/opportunities'); await c.see('Prepara tu empresa');
        c.check('dice cuántos documentos faltan', await shows(c, /0 de 5\. Falta: Certificado F30,/));
      } },
      { say: 'Pulso «Subir documentos»', do: async c => { await c.click('Subir documentos'); await c.see('Documentos de la empresa'); } },
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
  { id: 'admin-perdida', persona: 'owner', title: 'Administrador: registrar el resultado de una presentada, con sus motivos', goal: 'Que la propuesta presentada pase a «Perdida» con lo que dijo Mercado Público y por qué, y el equipo lo lea.', passWrites: [ACTIONS],
    steps: [
      { say: 'Abro la oportunidad presentada', do: async c => {
        await c.go(`/opportunities?op=${opp(10)}`); await c.see('Resultado: Adjudicada');
        c.check('presentada, «Cómo postular» ya no es la acción principal', (await applyIsMain(c)) === false);
        const act = await c.page.getByRole('link', { name: /Ver acta/ }).first().getAttribute('href').catch(() => null);
        c.check('el acta se abre en Mercado Público', Boolean(act?.startsWith('https://www.mercadopublico.cl/')), String(act));
      } },
      { say: 'Pulso Pasar a Perdida en el resultado', do: async c => {
        await c.click({ role: 'button', name: 'Pasar a Perdida' }); await c.seeRole('dialog', /Pasar a Perdida/);
        c.check('aún no cambió: pide el motivo primero', stateOf(c, 10) === 'submitted', `estado: ${stateOf(c, 10)}`);
        const dialog = c.page.getByRole('dialog');
        const winner = await dialog.getByLabel('Quién la ganó (opcional)').inputValue().catch(() => '');
        c.check('quién ganó viene de Mercado Público', winner === 'Centro de Llamadas del Pacífico SpA', winner);
        c.check('«Otro proveedor mejor evaluado» viene marcado', (await dialog.getByRole('button', { name: 'Otro proveedor mejor evaluado' }).getAttribute('aria-pressed').catch(() => null)) === 'true');
      } },
      { say: 'Marco el plazo y cuento qué pasó', do: async c => {
        const dialog = c.page.getByRole('dialog');
        await c.clickOn(dialog.getByRole('button', { name: 'Plazo', exact: true }));
        await dialog.getByLabel('Algo más (opcional)').fill('Pidieron menor plazo de entrega.');
      } },
      { say: 'Pulso Pasar a Perdida', do: async c => {
        await c.page.getByRole('dialog').getByRole('button', { name: 'Pasar a Perdida' }).click(); await c.wait(1500);
        c.check('la oportunidad quedó perdida', stateOf(c, 10) === 'lost', `estado: ${stateOf(c, 10)}`);
        c.check('ya perdida, «Cómo postular» deja de ser la acción principal', (await applyIsMain(c)) === false);
        c.check('los motivos y quién ganó quedaron en la actividad', c.table('opportunity_activity').some(row => row.opportunity_id === opp(10)
          && /^Estado: perdida · Otro proveedor mejor evaluado, Plazo\. Ganó Centro de Llamadas del Pacífico SpA por \$118\.500\.000\. Pidieron menor plazo/.test(row.body)
          && JSON.stringify(row.data?.motives) === '["competitor","deadline"]'), 'opportunity_activity');
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

  { id: 'admin-cambios-informe', persona: 'owner', title: 'Administrador: qué cambió en el informe actualizado, y las preguntas al foro', goal: 'Saber qué movió la nueva versión sin leer el informe completo otra vez.',
    steps: [
      { say: 'Abro la licitación del Registro Civil', do: async c => {
        await c.go(`/opportunities?op=${opp(10)}`); await c.see(/^Cambios desde el informe del /);
        c.check('dice que cambió la recomendación', await shows(c, /^La recomendación cambió: de «Postular si se resuelve lo pendiente» a «Postular»\.$/));
        c.check('nombra el documento que leyó', await shows(c, 'Leyó un documento nuevo: «Aclaraciones del foro.pdf».'));
      } },
      { say: 'Bajo a las preguntas para el comprador', do: async c => {
        await c.clickOn(c.page.getByRole('button', { name: 'Copiar para el foro' }));
        c.check('en una licitación se preguntan en el foro', await shows(c, /^En Mercado Público se preguntan en el foro de la licitación/));
        c.check('y no ofrece un correo', !(await shows(c, 'Abrir en mi correo')));
      } },
    ] },
  { id: 'admin-plan-tareas', persona: 'owner', title: 'Administrador: convertir el plan del informe en tareas', goal: 'Que los pasos del plan queden como tareas con responsable y fecha, sin escribirlas de a una.', passWrites: [ACTIONS],
    steps: [
      // The link of the email of tasks opens the opportunity on «Plan y tareas» (?seccion=tareas).
      { say: 'Abro la licitación en «Plan y tareas»', do: async c => { await c.go(`/opportunities?op=${opp(2)}&seccion=tareas`); await c.see('Plan de trabajo'); await c.see('Agregar 4 pasos del plan'); } },
      { say: 'Pulso «Agregar 4 pasos del plan»', do: async c => {
        await c.click('Agregar 4 pasos del plan'); await c.seeRole('dialog', /Convertir el plan en tareas/);
        const days = await c.page.getByRole('dialog').locator('input[type="date"]').evaluateAll(nodes => nodes.map(node => node.value));
        c.check('cada paso trae su fecha', days.length === 4 && days.every(Boolean), days.join(', '));
      } },
      { say: 'Dejo fuera el primero y me quedo con la firma', do: async c => {
        const dialog = c.page.getByRole('dialog');
        await c.clickOn(dialog.getByRole('checkbox', { name: 'Incluir «Pedir las dos referencias de clientes»' }));
        await dialog.getByLabel('Quién hace «Firmar la declaración jurada en el portal»').selectOption({ label: 'Camila Torres' });
      } },
      { say: 'Creo las tres tareas', do: async c => {
        await c.clickOn(c.page.getByRole('dialog').getByRole('button', { name: 'Crear 3 tareas' })); await c.see('Creamos 3 tareas y avisamos a cada responsable.');
        const created = c.table('opportunity_tasks').filter(row => row.opportunity_id === opp(2) && /^(Calcular el precio por persona|Firmar la declaración jurada en el portal|Subir la oferta al portal)/.test(row.title));
        c.check('quedaron tres tareas, cada una con su fecha', created.length === 3 && created.every(row => row.due_at), JSON.stringify(created.map(row => [row.title, row.due_at])));
        c.check('a Diego le avisamos una vez de sus dos tareas', c.table('opportunity_notifications').filter(row => row.user_id === DIEGO && /^2 tareas para ti/.test(row.title)).length === 1);
        c.check('solo ofrece el paso que dejé fuera', await shows(c, 'Agregar 1 paso del plan'));
      } },
    ] },
  { id: 'admin-mencion', persona: 'owner', title: 'Administrador: pedirle algo a Diego en una nota', goal: 'Que Diego revise el anexo económico y se entere sin que le escriba aparte.', passWrites: [ACTIONS],
    steps: [
      { say: 'Abro la actividad de la licitación', do: async c => { await c.go(`/opportunities?op=${opp(2)}&seccion=actividad`); await c.see('Actividad del equipo'); } },
      { say: 'Escribo «@Die» y elijo a Diego', do: async c => {
        const box = c.page.getByLabel('Registrar avance o nota');
        await box.click(); await box.pressSequentially('Revisa el anexo económico, @Die');
        await c.seeRole('option', 'Diego Fuentes');
        await c.page.keyboard.press('Enter');
        c.check('el nombre entra completo', (await box.inputValue()) === 'Revisa el anexo económico, @Diego Fuentes ', await box.inputValue());
        await box.pressSequentially('antes del jueves.');
      } },
      { say: 'Guardo la nota', do: async c => {
        await c.click('Guardar avance'); await c.see('Le avisamos a la persona que mencionaste.');
        const row = c.table('opportunity_activity').find(item => item.opportunity_id === opp(2) && String(item.body).startsWith('Revisa el anexo económico'));
        c.check('la nota nombra a Diego', JSON.stringify(row?.data?.mentions) === JSON.stringify([DIEGO]), JSON.stringify(row?.data));
        c.check('Diego lo ve en Novedades', c.table('opportunity_notifications').some(item => item.user_id === DIEGO && /^Camila Torres te mencionó/.test(item.title) && /^mention:note:/.test(item.event_key)));
      } },
    ] },

  // ─── Member ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
  { id: 'miembro-mis-tareas', persona: 'member', title: 'Integrante: «Mis tareas» de todas sus oportunidades, y marcar una hecha', goal: 'Ver qué tiene vencido y despacharlo sin abrir cada licitación.', passWrites: [ACTIONS, NOTIFY],
    steps: [
      { say: 'Abro Oportunidades', do: async c => {
        await c.go('/opportunities'); await c.see('Mis oportunidades asignadas');
        c.check('«Mis tareas» dice cuántas tiene', await shows(c, /^Mis tareas\s*3/));
      } },
      { say: 'Pulso «Mis tareas»', do: async c => {
        await c.click({ role: 'button', name: /^Mis tareas/ }); await c.see('Vencidas');
        await c.see('Pedir la visita a terreno de las sucursales');
        c.check('la vencida dice cuándo venció, en rojo', await c.page.getByText(/^Venció el /).first().evaluate(node => /text-destructive/.test(node.className)).catch(() => false));
        c.check('la dirección es la de «Mis tareas»', c.page.url().includes('vista=tareas'), c.page.url());
      } },
      { say: 'Marco hecha la vencida', do: async c => {
        await c.click({ role: 'checkbox', name: 'Marcar «Pedir la visita a terreno de las sucursales» como hecha' });
        await c.see('Hecha: «Pedir la visita a terreno de las sucursales».');
        c.check('quedó hecha', c.table('opportunity_tasks').find(row => row.title === 'Pedir la visita a terreno de las sucursales')?.status === 'done');
        c.check('salió de la lista', !(await shows(c, 'Vencidas')));
      } },
      { say: 'Abro la licitación de otra tarea', do: async c => {
        await c.clickOn(c.page.getByRole('button', { name: 'Compra Ágil: revisión de antecedentes de postulantes', exact: true })); await c.see('Plan de trabajo');
        c.check('abre en «Plan y tareas»', await shows(c, 'Preparar el anexo técnico'));
      } },
    ] },
  { id: 'miembro-nota', persona: 'member', title: 'Integrante: leer lo que le pidieron y corregir su nota', goal: 'Responder a la mención de Camila y arreglar un dato de su propia nota.', passWrites: [ACTIONS, NOTIFY],
    steps: [
      { say: 'Abro Oportunidades y veo la mención en Novedades', do: async c => {
        await c.go('/opportunities'); await c.see('Camila Torres te mencionó');
        c.check('las menciones tienen su tipo en Novedades', await shows(c, 'Tareas y menciones'));
      } },
      { say: 'Abro la mención', do: async c => {
        await c.click({ text: /^Camila Torres te mencionó/ }); await c.see('Actividad del equipo');
        c.check('abre en la nota', await shows(c, '¿confirmas con Retail Andino que firman el certificado esta semana?'));
      } },
      { say: 'Corrijo mi nota', do: async c => {
        await c.click({ role: 'button', name: 'Opciones de tu nota' }); await c.click({ role: 'menuitem', name: 'Editar' });
        const box = c.page.getByLabel('Editar la nota');
        await box.fill('Leí las bases: piden dos referencias y el certificado de antecedentes. El certificado llega el lunes.');
        await c.clickOn(c.page.getByRole('button', { name: 'Guardar', exact: true }));
        // The new text is in the box while it saves (React writes it there too): «editada» shows once it is saved and read again.
        await c.see(/· editada/);
        const row = c.table('opportunity_activity').find(item => item.opportunity_id === opp(2) && item.kind === 'progress');
        c.check('la nota quedó corregida y dice que se editó', /llega el lunes/.test(row?.body) && Boolean(row?.data?.editedAt), JSON.stringify(row?.data));
        c.check('se lee la nota corregida', await shows(c, 'El certificado llega el lunes.'));
      } },
    ] },

  { id: 'miembro-oferta', persona: 'member', title: 'Integrante: corregir una sección del borrador de oferta y darla por revisada', goal: 'Dejar la oferta en las palabras del equipo antes de presentarla, sin pasar por el Word.', passWrites: [ACTIONS],
    steps: [
      { say: 'Abro «Cómo postular» de la licitación', do: async c => {
        await c.go(`/opportunities?op=${opp(2)}`); await c.see('Qué hacer ahora');
        await c.clickOn(c.page.getByRole('button', { name: 'Cómo postular' }).first()); await c.see('Tu oferta · borrador');
      } },
      { say: 'Corrijo la sección de experiencia', do: async c => {
        await c.click({ role: 'button', name: 'Editar la sección «Experiencia en verificación de antecedentes»' });
        await c.page.getByLabel('Texto de la sección «Experiencia en verificación de antecedentes»').fill('Hemos verificado antecedentes para 12 empresas del retail, con 9.000 informes al año.');
        await c.clickOn(c.page.getByRole('button', { name: 'Guardar', exact: true })); await c.see(/^Editada por Diego Fuentes/);
        const draft = c.table('opportunity_offer_drafts').find(row => row.opportunity_id === opp(2))?.draft;
        c.check('quedó en el borrador, con el texto de la IA debajo', draft?.edits?.['technical:0']?.text === 'Hemos verificado antecedentes para 12 empresas del retail, con 9.000 informes al año.'
          && /\[N\.º de clientes\]/.test(draft?.technical?.[0]?.body), JSON.stringify(draft?.edits));
      } },
      { say: 'La marco como revisada', do: async c => {
        await c.click('Marcar como revisada'); await c.see(/^Revisado por Diego Fuentes el /);
        c.check('dice quién la revisó', c.table('opportunity_offer_drafts').find(row => row.opportunity_id === opp(2))?.draft?.review?.by === DIEGO);
        c.check('y queda en la actividad', c.table('opportunity_activity').some(row => row.opportunity_id === opp(2) && row.body === 'Oferta revisada antes de presentarla'));
      } },
    ] },
  { id: 'miembro-precio', persona: 'member', title: 'Integrante a cargo: el precio guardado para el equipo, y su valor en la oferta económica', goal: 'Ajustar el cálculo del precio sin perderlo al cambiar de equipo, y llevar el precio a la oferta.', passWrites: [ACTIONS],
    steps: [
      { say: 'Abro «Calcular el precio» de la licitación', do: async c => {
        await c.go(`/opportunities?op=${opp(2)}&seccion=postular`); await c.see('Tu oferta · borrador');
        await c.clickOn(c.page.getByText('Calcular el precio', { exact: true })); await c.see(/^Guardado para quien fija los precios · Diego Fuentes/);
        c.check('abre el cálculo guardado, no uno vacío', await c.page.getByLabel('Sueldo base del perfil 1').inputValue() === '750000');
        c.check('con sus versiones', await shows(c, /^Versiones guardadas/));
      } },
      { say: 'Subo el sueldo base y se guarda solo', do: async c => {
        await c.page.getByLabel('Sueldo base del perfil 1').fill('780000');
        await c.page.waitForTimeout(2000); await c.see(/^Guardado para quien fija los precios · Diego Fuentes/);
        const latest = c.table('opportunity_price_studies').filter(row => row.opportunity_id === opp(2)).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
        c.check('quedó una versión nueva con el sueldo nuevo', latest?.study?.profiles?.[0]?.base === '780000' && c.table('opportunity_price_studies').filter(row => row.opportunity_id === opp(2)).length === 3,
          JSON.stringify(latest?.study?.profiles?.[0]));
      } },
      { say: 'Llevo el precio al mes a la oferta económica', do: async c => {
        await c.clickOn(c.page.getByRole('button', { name: 'Usar', exact: true })); await c.see(/^Listo: \$[\d.]+ en «Verificación de antecedentes por persona»\.$/);
        const prices = c.table('opportunity_offer_drafts').find(row => row.opportunity_id === opp(2))?.prices;
        c.check('la línea tiene su precio unitario', Number(prices?.['0']) > 0, JSON.stringify(prices));
      } },
    ] },
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
      // Its report reads 4 of 10 parts in two minutes: the office says what is left at that pace, not a fixed promise (OPP-19).
      { say: 'Veo cuánto le falta al informe', do: async c => { await c.see('Lee «Bases técnicas.pdf» · parte 5 de 10'); await c.see(/Quedan unos \d+ minutos/); } },
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
  { id: 'miembro-bases-zip', persona: 'member', title: 'Integrante: soltar el ZIP de las bases en la licitación, sin buscar dónde', goal: 'Que las bases que bajó de Mercado Público queden en el expediente de la licitación de guardias.', passWrites: [DOCUMENTS],
    steps: [
      { say: 'Abro la licitación que preparo', do: async c => { await c.go(`/opportunities?op=${opp(2)}`); await c.see('Qué hacer ahora'); } },
      { say: 'Arrastro el ZIP que bajé sobre la página', do: async c => {
        const { default: JSZip } = await import('jszip');
        const archive = new JSZip();
        archive.file('Bases técnicas.txt', 'Servicio de guardias 24/7 para 12 sucursales, con supervisor y rondas cada hora. Experiencia mínima de 3 años.');
        archive.file('Anexo 2 Formulario económico.txt', 'Precio mensual por puesto, con y sin IVA, en pesos chilenos.');
        c.zip = { name: 'Bases licitación guardias.zip', type: 'application/zip', base64: Buffer.from(await archive.generateAsync({ type: 'uint8array' })).toString('base64') };
        await dropOnPage(c, [c.zip], { drop: false });
        c.check('la página dice que puede soltarlo ahí', await c.page.getByText('Suelta para subirlos a esta oportunidad').isVisible());
      } },
      { say: 'Lo suelto', do: async c => {
        await dropOnPage(c, [c.zip]);
        await c.see('En el expediente');
        // Each one goes up and is read; then the list of the expediente shows it (the upload list shows it first).
        await c.page.getByText('Anexo 2 Formulario económico.txt').filter({ visible: true }).nth(1).waitFor({ state: 'visible', timeout: 20000 }).catch(() => undefined);
        const saved = c.table('opportunity_documents').filter(row => row.opportunity_id === opp(2)).map(row => row.name);
        c.check('las dos bases quedaron en el expediente', ['Bases técnicas.txt', 'Anexo 2 Formulario económico.txt'].every(name => saved.includes(name)), saved.join(', '));
        c.check('quedó en «Documentos»', new URL(c.page.url()).searchParams.get('seccion') === 'documentos', new URL(c.page.url()).search);
        c.check('el aviso de soltar se fue', !(await c.page.getByText('Suelta para subirlos a esta oportunidad').isVisible()));
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
  { id: 'miembro-movil-tareas', persona: 'member', viewport: 'phone', title: 'Integrante en el móvil: «Mis tareas» y la lista de una oportunidad', goal: 'Revisar qué tiene vencido desde el teléfono.', passWrites: [ACTIONS, NOTIFY],
    steps: [
      { say: 'Abro «Mis tareas»', do: async c => { await c.go('/opportunities?vista=tareas'); await c.see('Vencidas'); await c.see('Pedir la visita a terreno de las sucursales'); } },
      { say: 'Abro la licitación de una tarea', do: async c => {
        await c.clickOn(c.page.getByRole('button', { name: 'Compra Ágil: revisión de antecedentes de postulantes', exact: true })); await c.see('Plan de trabajo');
        c.check('la tarea dice su fecha y su responsable', await shows(c, 'Preparar el anexo técnico'));
      } },
    ] },
  { id: 'admin-movil', persona: 'owner', viewport: 'phone', title: 'Administrador en el móvil: ver el embudo y abrir una', goal: 'Revisar qué hay recomendado desde el teléfono.',
    steps: [
      { say: 'Abro Oportunidades', do: async c => { await c.go('/opportunities'); await c.see('Gestionar oportunidades'); } },
      { say: 'Elijo Recomendadas', do: async c => { await c.click({ text: 'Recomendadas' }); await c.see('Compra Ágil: personal administrativo de apoyo'); } },
      { say: 'Abro la compra de Maipú', do: async c => { await open(c, 'Compra Ágil: personal administrativo de apoyo', 'Abrir'); await c.see('Asignar equipo'); } },
    ] },
];

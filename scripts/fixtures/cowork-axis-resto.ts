// AXIS benchmark, the other 24 operations of the package (the 20 ★ are in cowork-axis-paquete.ts): same account, same way of
// reading an answer, same comparison with what the previous AI achieved and where it failed (`axis.reference`).
//
// Where the app has a read for what the operation needs, the world returns that read in the shape the real capability returns
// (audience.analyze with the first 100 contacts and their role, campaigns.retry_review, deliverability.*, linkedin.jobs,
// compliance.check, contacted rows with the columns of contacted_leads…). The figures of the package that no read of the app can
// produce (54 recruiters out of 2,512 contacts, 1,618 records without a title) are not placed in a field nobody returns: the
// world carries what the reads show (a sample of 100, a search that stops at 20) and the case expects the answer to say how far
// it sees. A limit told is not a failure, an invented result is. The lists of recipients of the big batches (D4, H1) are summarized in
// `summary`: the real read lists them all. No database, mailbox or provider is touched.
import { classifyAudienceRole } from '../../src/lib/cowork/audience-analysis';
import { contactRecordEvidence } from '../../src/lib/cowork/contact-evidence';
import { CONTACT_POLICY } from '../../src/lib/compliance';
import { contrastSender, diagnoseBounces, evaluateDkim, evaluateDmarc, evaluateMx, evaluateSpf, summarizeDomain, topRecipientDomains } from '../../src/lib/deliverability';
import { compareChannels } from '../../src/lib/metrics';
import type { CoworkUserContext } from '../../src/lib/cowork/decision-context';
import { CORPUS_NOW, type CorpusCase, type CorpusTurnResult } from './cowork-conversation-corpus';
import {
  AXIS_LEAD, axis, axisShown, avoids, before, commonWith, contacted, endsAsking, id, noCoverage, noSend, norm, onlyKnown, person,
  reads, readsAny, says, saysAny, search, world, axisUserContext, type ReadValue,
} from './cowork-axis-paquete';

const FIRST = ['Andrés', 'Bárbara', 'Claudio', 'Daniela', 'Esteban', 'Francisca', 'Gonzalo', 'Helena', 'Ignacio', 'Javiera', 'Kevin', 'Lorena'];
const LAST = ['Araya', 'Bravo', 'Cortés', 'Donoso', 'Espinoza', 'Flores', 'Godoy', 'Hidalgo', 'Ibarra', 'Jara', 'Lillo'];
const personName = (index: number) => `${FIRST[index % FIRST.length]} ${LAST[(index * 7) % LAST.length]}`;

/** Ids of the people the cases of this file name; the ones of the ★ file keep theirs (AXIS_LEAD). */
export const AXIS_REST = {
  piloto: id(1210), manager: id(1212), elisa: id(1213), daniel: id(1214), bruno: id(1215), rodrigo: id(1216), tomas: id(1217),
  campaign: id(1221), plan: id(1222), tanda: id(1223),
};

/** `audience.analyze` as the real capability returns it (analyzeStoredAudience): the companies by vertical, and the first 100 contacts
 * with the role the app reads from each title. The rest of the account is not in this read: `contactsTruncated` says so. */
function audienceRead(contacts: Array<[string | null, string]>, verticals: Array<{ industry: string; companiesObserved: number; companiesWithRecordedSend: number }>, total = 2512) {
  return {
    queriedAt: '2026-09-25T13:00:00Z', scope: 'organization_stored_audience', coverage: { leadsComplete: true, historyComplete: true }, missingCompany: 0,
    verticals: verticals.map(vertical => ({ ...vertical, companiesWithoutObservedSend: vertical.companiesObserved - vertical.companiesWithRecordedSend,
      newCompanyPercent: (vertical.companiesObserved - vertical.companiesWithRecordedSend) / vertical.companiesObserved * 100, denominator: 'distinct_normalized_company_names_in_stored_leads' })),
    contacts: contacts.slice(0, 100).map(([title, company], index) => ({ id: id(2000 + index), name: personName(index), title, company, classification: classifyAudienceRole(title) })),
    contactsTruncated: total > 100,
    limitation: 'Frescura respecto a envíos registrados en la app, no al mercado completo ni a LinkedIn no sincronizado. Nombres equivalentes por alias/dominio requieren conciliación. Los roles son hipótesis; no autorizan envíos ni descarte.',
    consistency: 'Lectura paginada sin snapshot transaccional; cambios concurrentes pueden alterar la población.',
  };
}
const COMPANIES = ['Constructora Pehuén', 'Servicios Integrales', 'Inmobiliaria Sur', 'Ingeniería Andes', 'Minera Norte', 'Retail Sur', 'Transportes Andes', 'Clínica Bosque', 'Staffing Norte', 'Logística Austral'];
const STORED_VERTICALS = [
  { industry: 'Construcción', companiesObserved: 348, companiesWithRecordedSend: 163 },
  { industry: 'Aseo y servicios a edificios', companiesObserved: 120, companiesWithRecordedSend: 97 },
  { industry: 'Seguridad', companiesObserved: 61, companiesWithRecordedSend: 38 },
  { industry: 'Minería, logística, retail, salud y hotelería', companiesObserved: 1240, companiesWithRecordedSend: 161 },
];

/** A row of `contacted.search` as the real capability returns it (the columns of contacted_leads). */
const sentRow = (n: number, name: string, email: string, company: string, extra: Record<string, unknown> = {}) =>
  ({ id: id(3000 + n), lead_id: id(3500 + n), name, email, company, status: 'sent', provider: 'gmail', subject: 'Antecedentes laborales sin trámites manuales',
    sent_at: '2026-09-02T13:00:00Z', replied_at: null, reply_intent: null, ...extra });

/** `contacted.timeline` as the real capability returns it: the rows of one contact and what the records do and do not prove. */
const timeline = (rows: Array<{ id: string } & Record<string, unknown>>) => ({ contacted: rows, scope: 'organization_contacted', truncated: false,
  ...contactRecordEvidence(rows, false, CORPUS_NOW.toISOString()), mailboxCoverage: noCoverage, mailboxSyncedAt: null });

/** `metrics.channels` as the real capability returns it: the last 30 days of email and LinkedIn, and what cannot be compared. */
const channelsRead = { scope: 'organization_metrics', ...compareChannels({
  email: { channel: 'email', period: 'last_30_days', sent: 165, replies: 2, positives: 1, meetings: 0, pending: 0, sources: ['contacted_leads'] },
  linkedin: { channel: 'linkedin', period: 'last_30_days', sent: 34, replies: 9, positives: 0, meetings: 0, pending: 3, sources: ['cowork_linkedin_jobs', 'extension_linkedin_sends', 'cowork_linkedin_threads'] } }),
  linkedinDetail: { jobsByStatus: { confirmed: 34 }, sendsByStatus: {}, inboundThreads: 9, pendingReplies: 3, sweep: [], positivesUnknown: true, meetingsUnknown: true }, coverage: noCoverage,
  limitation: 'LinkedIn aún no registra positivos ni reuniones vinculadas; cualquier comparación es, como máximo, cautelosa.' };

/** `campaigns.company_plan` as the real capability returns it. */
const companyPlan = (assignments: Array<{ email: string; company: string; sendDay: string }>, extra: Record<string, unknown> = {}) => ({
  scope: 'own_campaign_company_plan', campaignId: AXIS_REST.plan, campaignStatus: 'active', startDay: '2026-09-25', scheduled: true,
  assignments: assignments.map(item => ({ ...item, companyKey: norm(item.company).replace(/[^a-z0-9]+/g, '-'), basis: 'company_name', reservedDay: item.sendDay })),
  limitation: 'El plan es determinista; la garantia real la da la reserva persistida mas el preflight antes del proveedor.', ...extra });

const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;
const drafts = (result: CorpusTurnResult) => (result.blocks || []).flatMap(block => block.type === 'email_draft' ? [block] : []);
const tables = (result: CorpusTurnResult) => (result.blocks || []).flatMap(block => block.type === 'table' ? [block] : []);
/** The card addressed to whoever the pattern names (accents and case ignored): its title or its recipients. */
const draftFor = (result: CorpusTurnResult, name: RegExp) => drafts(result).find(block => name.test(norm(`${block.title} ${(block.to || []).join(' ')}`)));
/** The cells of the first table that has a column for each pattern (accents and case ignored), in the order of the patterns. */
const tableCells = (result: CorpusTurnResult, ...columns: RegExp[]): string[][] | null => {
  for (const block of tables(result)) {
    const positions = columns.map(column => block.columns.findIndex(name => column.test(norm(name))));
    if (positions.every(position => position >= 0)) return block.rows.map(row => positions.map(position => row[position] ?? ''));
  }
  return null;
};
/** What the person reads in a card, for a check on an email they would send. */
const draftsText = (result: CorpusTurnResult) => norm(drafts(result).map(block => `${block.subject}\n${block.body}`).join('\n\n'));

/** The 24 operations that are not ★. `userContext` comes from the real loader (axisUserContext). */
export function axisRestCorpus(userContext: CoworkUserContext | null): CorpusCase[] {
  const w = (own: Record<string, ReadValue>, savedEmails: string[] = []) => world(own, userContext, savedEmails);
  const known = (...values: number[]) => [2512, 990, 165, 557, 186, 84, 1619, 151, 262, 52, 210, ...values];
  const meta = (...args: Parameters<typeof axis>) => ({ ...axis(...args), star: false });

  const cases: CorpusCase[] = [];
  const add = (entry: Omit<CorpusCase, 'origin'>) => cases.push({ ...entry, origin: `Paquete AXIS ${entry.axis?.op}: ${entry.title}` });

  // ── A · Investigar y armar audiencia
  const RECRUITERS = ['Jefa de Reclutamiento', 'Analista de Selección', 'Reclutador', 'Coordinadora de Reclutamiento', 'Talent Acquisition Specialist', 'Jefe de Selección'];
  const DECISION = ['Gerente de Personas', 'Gerente de Operaciones', 'Gerente General', 'Director de Recursos Humanos', 'Gerente de Servicios', 'Gerente de Administración'];
  const a1Contacts = Array.from({ length: 100 }, (_, index): [string, string] =>
    [index % 17 === 5 ? RECRUITERS[Math.floor(index / 17)] : DECISION[index % DECISION.length], COMPANIES[index % COMPANIES.length]]);
  const OUTSOURCERS = ['Staffing Norte', 'Servicios Integrales', 'Outsourcing Andes', 'Personas y Servicios', 'Selección Austral'];
  const recruiterPeople = Array.from({ length: 20 }, (_, index) =>
    person(id(2600 + index), personName(index + 40), RECRUITERS[index % RECRUITERS.length], OUTSOURCERS[index % OUTSOURCERS.length], index % 3 ? `p${index}@ejemplo.cl` : null));

  add({ id: 'axis-a1-hipotesis', title: 'Evaluar una hipótesis comercial con datos',
    request: 'Deberíamos intentar conectar y contactar con reclutadores de empresas de outsourcing, ya que son quienes usan herramientas como la nuestra y podrían referirnos con la persona indicada. ¿Qué te parece?',
    axis: meta('A1', 'A · Investigar y armar audiencia', 'parcial',
      ['Buscar en el historial la evidencia a favor y en contra antes de opinar', 'Dimensionar el segmento: de unos 2.500 contactos solo 54 eran de reclutamiento (2 %)', 'Validar con el caso vivo (el único usuario real del producto era un administrativo de reclutamiento de un cliente en piloto) y nombrar el defecto de ejecución: un reclutador no puede firmar, así que el pedido cambia de «reunámonos» a «pruébalo gratis»', 'Armar la lista aparte sin gastar créditos'],
      { result: 'Solo 54 de unos 2.500 contactos (2 %) eran de reclutamiento. Validó la idea con el único usuario real del producto (un administrativo de reclutamiento de un cliente en piloto), nombró el defecto (un reclutador no firma: el pedido pasa de «reunámonos» a «pruébalo gratis») y armó una lista aparte de 148 personas en 40 empresas sin gastar créditos.',
        failed: 'La lista de 466 personas se había armado filtrando por poder de decisión, así que por construcción excluía a los reclutadores.' }),
    world: w({
      'audience.analyze': audienceRead(a1Contacts, STORED_VERTICALS),
      'leads.search': search(recruiterPeople, { truncated: true }),
      'crm.search': { items: [{ id: AXIS_REST.piloto, name: 'Ana Ruiz', title: 'Analista de Selección', company: 'Alimentos del Valle', stage: 'pilot' }], returned: 1, limit: 20, scope: 'organization_crm', truncated: false },
    }),
    checks: commonWith(
      readsAny('mira su propia base antes de opinar', 'audience.analyze', 'leads.search', 'crm.search'),
      says('dimensiona el segmento con lo que ve y dice hasta dónde ve', /(reclut|selecci)/, /(primeros 100|100 contactos|mas de 20|al menos 20|hasta 20|no (veo|alcanzo a ver|puedo ver)[^.]{0,40}(todos|completa|toda|2\.?512))/),
      says('nombra el defecto de ejecución: un reclutador no firma', /(no (puede|podria|suele)? ?(firmar|decidir|comprar)|no firma|no decide|no es quien (firma|decide|compra))/),
      says('cambia el pedido: de reunirse a probar sin costo', /(cuenta de prueba|prueba)/, /(sin (costo|cargo)|gratis|dos semanas)/),
      saysAny('valida con el caso vivo: el usuario real de un cliente en piloto', /piloto/, /usuario real/),
      says('propone la lista aparte sin gastar créditos', /aparte/, /(sin (gastar|usar) (creditos|un credito)|no (gasta|gastare|uso|usare)[^.]{0,30}creditos)/),
      onlyKnown('no inventa tamaños que nadie leyó', known(100)),
      noSend, endsAsking)});

    add({ id: 'axis-a3-empresas', title: 'Construir la lista de empresas objetivo antes de buscar personas',
    request: 'Parte generando el listado de empresas que vamos a buscar, luego busquemos a las personas.',
    axis: meta('A3', 'A · Investigar y armar audiencia', 'parcial',
      ['Derivar las empresas de la búsqueda de personas (la herramienta de empresas cuesta créditos)', 'Filtrar por tamaño (200 o más empleados; 500 o más en construcción) y exigir al menos un decisor con correo verificado', 'Deduplicar por dominio exacto o nombre normalizado completo, nunca por coincidencia parcial, y excluir competidores directos y organismos públicos extranjeros', 'Entregar el listado en un archivo con el estado de cada empresa: nueva, trabajada o excluida'],
      { result: '149 empresas: 58 nuevas, 87 ya trabajadas y 4 excluidas (dos de la lista de exclusión, un competidor que presta el mismo servicio y una agencia de gobierno extranjera). Listado en archivo con el estado de cada una y lectura del vertical más fresco.',
        failed: 'Una regla de coincidencia parcial daba positivo entre dos empresas sin relación porque el nombre de una contenía las letras de la otra; se eliminó: solo dominio exacto o nombre normalizado completo.' }),
    world: w({
      'audience.analyze': audienceRead(a1Contacts, STORED_VERTICALS),
      'crm.search': { items: [{ id: id(1301), name: 'Héctor Vidal', title: 'Gerente Legal', company: 'Casino Central', stage: 'contacted' },
        { id: id(1302), name: 'Gerente de Compras', title: 'Gerente de Compras', company: 'Clínica Bosque', stage: 'quote_sent' }], returned: 2, limit: 20, scope: 'organization_crm', truncated: false },
    }),
    checks: commonWith(
      readsAny('mira lo que ya tiene guardado y contactado para marcar cada empresa', 'audience.analyze', 'contacted.search', 'crm.search'),
      says('deriva las empresas de la búsqueda de personas, porque la de empresas cuesta créditos', /(desde|a partir de|de) la busqueda de personas/, /empresas?[^.]{0,80}creditos|creditos[^.]{0,80}empresas?/),
      says('filtra por tamaño: 200 empleados o más, y 500 en construcción', /\b200\b/, /\b500\b/, /construccion/),
      says('exige al menos un decisor con correo verificado', /decisor/, /verificad/),
      says('deduplica por dominio exacto o nombre normalizado, nunca por coincidencia parcial', /(dominio exacto|nombre normalizado|nombre completo)/, /(parcial|contiene|substring)/),
      says('excluye competidores y organismos públicos extranjeros', /competidor/, /(organismos? publicos?|agencias? de gobierno|gobierno extranjero)/),
      says('marca cada empresa como nueva, trabajada o excluida', /nuev/, /trabajad/, /excluid/),
      saysAny('entrega el listado en un archivo', /(excel|csv|archivo|descarg)/),
      noSend, endsAsking)});

  // The first 100 contacts of the account: 64 have no title, which is what the package found (1,618 of 2,512 records had none).
  const A6_TITLED: Array<[string, number]> = [['Gerente de Personas', 6], ['Gerente de Servicios Transitorios', 3], ['Gerente General', 4], ['Director de Operaciones', 4], ['Gerente de Administración', 2], ['Dueño', 2],
    ['Jefa de Selección', 3], ['Analista de Recursos Humanos', 3], ['Asistente de Gerencia', 2], ['Coordinadora de Reclutamiento', 1], ['Contador Auditor', 3], ['Ingeniero de Proyectos', 2], ['Prevencionista de Riesgos', 1]];
  const a6Titles = [...A6_TITLED.flatMap(([title, count]) => Array.from({ length: count }, () => title)), ...Array.from({ length: 64 }, () => null)];
  const a6Contacts = a6Titles.map((title, index): [string | null, string] => [title, COMPANIES[(index * 3) % COMPANIES.length]]);
  add({ id: 'axis-a6-decisor-referidor', title: 'Clasificar cargos: decisor, referidor o descarte',
    request: 'A veces no contactamos a la persona del área correcta, pero esa persona, al ser de un cargo alto, nos refiere dentro de la empresa. Dame el listado de todas las personas que debería contactar por LinkedIn: cada persona contactada alguna vez que tenga poder de decisión.',
    axis: meta('A6', 'A · Investigar y armar audiencia', 'parcial',
      ['Clasificar a las personas en tres grupos: quién firma, quién puede derivar aunque no sea del área y quién no aporta ninguna de las dos cosas', 'Decir cuántos registros no tienen cargo antes de clasificar', 'Comparar por palabra completa: el término corto «cio» no puede descartar a «servicios»', 'Ordenar por prioridad (más toques por correo sin responder primero), poner a los referidores desde el primer día y escribir un mensaje distinto para cada grupo'],
      { result: '466 personas en 351 empresas: 436 decisores y 30 referidores, con un mensaje por grupo.',
        failed: '1.618 de 2.512 registros no tenían cargo y hubo que recuperarlo desde los archivos del proveedor; el término «cio» daba positivo dentro de «servicios» y descartaba a los gerentes de servicios transitorios, que eran el cliente ideal; la primera versión dejaba a los referidores al final del calendario.' }),
    world: w({
      'audience.analyze': audienceRead(a6Contacts, STORED_VERTICALS),
      'contacted.search': contacted([sentRow(1, personName(3), 'a@ejemplo.cl', 'Constructora Pehuén'), sentRow(2, personName(5), 'b@ejemplo.cl', 'Servicios Integrales')], { truncated: true }),
    }),
    checks: commonWith(
      readsAny('mira su base antes de clasificar', 'audience.analyze', 'leads.search', 'contacted.search'),
      says('dice cuántos de los que ve no tienen cargo', /(sin cargo|no (tienen|traen) cargo|falta(n)? el cargo)/, /\b64\b/),
      says('clasifica en tres grupos: decisores, referidores y descarte', /decisor/, /referidor/, /(descart|no aporta)/),
      says('compara por palabra completa y no descarta a los gerentes de servicios', /(palabra completa|palabra entera|limite de palabra)/, /servicios/),
      saysAny('pone a los referidores desde el primer día', /referidor[^.]{0,80}(primer dia|dia 1|desde el inicio|primero|desde el comienzo)/, /(primer dia|dia 1|primero)[^.]{0,80}referidor/),
      saysAny('ordena por los toques por correo sin responder', /(mas toques|mas correos|toques)[^.]{0,80}(sin respuesta|sin responder)/),
      { label: 'escribe un mensaje distinto para los decisores y para los referidores', test: result => drafts(result).length >= 2 || (axisShown(result).match(/mensaje (para|a) (los )?(decisores|referidores)/g) || []).length >= 2 },
      onlyKnown('no inventa cifras', known(100)),
      noSend, endsAsking)});

  const a8People = [person(AXIS_LEAD.jorge, 'Jorge Lagos', 'Jefe de Reclutamiento', 'Constructora Pehuén', 'jlagos@pehuen.cl', { linkedin_url: 'https://www.linkedin.com/in/jorge-lagos' }),
    person(AXIS_LEAD.carla, 'Carla Ibáñez', 'Jefa de Selección', 'Inmobiliaria Sur', 'cibanez@inmosur.cl', { linkedin_url: 'https://www.linkedin.com/in/carla-ibanez' }),
    person(AXIS_LEAD.felipe, 'Felipe Araya', 'Head of Recruitment', 'Ingeniería Andes', 'faraya@ingandes.cl', { linkedin_url: 'https://www.linkedin.com/in/felipe-araya' }),
    person(AXIS_LEAD.marcela, 'Marcela Rojas', 'Líder de Reclutamiento', 'Servicios Norte', 'mrojas@sernorte.cl', { linkedin_url: 'https://www.linkedin.com/in/marcela-rojas' })];
  add({ id: 'axis-a8-perfil-real', title: 'Verificar el perfil real antes de invitar',
    request: 'Antes de invitarlos, revisa los perfiles de LinkedIn de los primeros 36 contactos de la lista y dime cuáles no sirven: que el cargo y la empresa sean los que dice la base.',
    axis: meta('A8', 'A · Investigar y armar audiencia', 'faltante',
      ['Abrir el perfil público y contrastar cargo y empresa contra lo que dice la base', 'Descartar con el motivo: datos viejos, buscando empleo, perfil inactivo, sin botón de conexión o invitación ya pendiente', 'Informar la tasa observada de descartes en la muestra revisada'],
      { result: 'De 36 perfiles revisados, 14 (39 %) no servían: datos viejos (6), buscando empleo (2), perfil inactivo (2), sin botón de conexión (4) y ya pendientes (2). Cada descarte quedó registrado con su motivo; la estimación inicial con cuatro casos era 25 %.',
        failed: 'Ninguna en particular; el aprendizaje fue que la tasa real de descartes era mucho más alta que la estimada con una muestra chica.' }),
    world: w({
      'leads.search': search(a8People, { truncated: true }),
      'linkedin.jobs': { scope: 'own_linkedin_jobs', pending: [{ id: id(1401), kind: 'invite', canonical_url: 'https://www.linkedin.com/in/carla-ibanez', display_name: 'Carla Ibáñez', status: 'queued', created_at: '2026-09-24T15:00:00Z', expired: false, expiresInDays: 14 }],
        recent: [], executionNote: 'Un trabajo en cola no es un envío: ejecútalo desde la extensión ante el perfil verificado. Lo incierto nunca se reintenta solo.' },
      'linkedin.quota': { scope: 'own_linkedin_quota', pending: 38, sent: 20, limit: 100, windowDays: 7, allowed: true },
    }),
    checks: commonWith(
      readsAny('mira la lista y los trabajos antes de contestar', 'leads.search', 'linkedin.jobs', 'linkedin.quota'),
      says('dice con claridad que no puede abrir perfiles de LinkedIn desde el chat', /(no puedo|no tengo|no es posible)[^.]{0,80}(abrir|revisar|ver|leer|entrar)[^.]{0,60}(perfil|linkedin)/),
      avoids('no inventa descartes ni una tasa observada', /\b\d+ de (los )?(36|treinta y seis)[^.]{0,80}(no sirv|descart)/, /\b(39|25) ?%[^.]{0,40}(de (los )?perfiles|descart)/),
      says('nombra los motivos por los que un perfil no sirve', /(datos (viejos|desactualizados))/, /(sin boton|no (ofrece|tiene|muestra)[^.]{0,30}conectar)/, /pendiente/),
      says('ofrece que la extensión verifique cada perfil al invitar', /extension/, /(verific|revis|contrast)[^.]{0,80}(perfil|cargo)/),
      saysAny('entrega la lista de perfiles para que se revise', /(url|enlace|link)s?[^.]{0,60}perfil|perfil[^.]{0,60}(url|enlace|link)/),
      noSend, endsAsking)});

  // ── B · Estrategia y planificación
  add({ id: 'axis-b2-mensaje-propio', title: 'Sistematizar un mensaje que el usuario escribió',
    request: 'Este mail lo mandé yo y me parece interesante. Le voy a mandar este mensaje a Patricio Soto, de Constructora Pehuén; ayúdame con un borrador de LinkedIn con este estilo.\n\nAsunto: Reunión\n\nHola Patricio,\n¿Te interesaría una reunión de 10 minutos para ver el producto funcionando? AXIS verifica a empresas como la tuya con consultas judiciales automáticas en el Poder Judicial, sin trámites manuales y con resultados claros para Tu Equipo De Selección.\nSeguramente ya usan alguna de las alternativas conocidas del mercado. Esto hace lo mismo y a un mejor precio. Además, tenemos clientes en distintos rubros que ya lo usan y nos pueden dar referencias cuando quieras, y si prefieres podemos coordinar una videollamada.\n\nNicolás',
    axis: meta('B2', 'B · Estrategia y planificación', 'cubierta',
      ['Identificar qué hace bien el mensaje (el pedido en la línea 2, una sola frase de producto, ancla competitiva, cierre simple) y conservarlo', 'Corregir solo lo que está mal: el error de contenido (el producto verifica a las personas que la empresa contrata, no «a empresas como la tuya»), el largo y las mayúsculas mal puestas', 'Que el resultado suene a él y no a la IA, con los cambios explicados uno a uno', 'Escribir el borrador de LinkedIn con el mismo estilo'],
      { result: 'El mensaje corregido conservó su estructura y su voz; los cambios quedaron explicados uno a uno y los borradores de LinkedIn salieron con el mismo estilo.',
        failed: 'Ninguna en particular: el valor estuvo en corregir solo lo que estaba mal.' }),
    world: w({
      'leads.search': search([person(AXIS_LEAD.patricio, 'Patricio Soto', 'Gerente de Personas', 'Constructora Pehuén', 'psoto@pehuen.cl', { linkedin_url: 'https://www.linkedin.com/in/patricio-soto' })]),
    }),
    checks: commonWith(
      says('nombra lo que el mensaje hace bien y lo conserva', /(pedido|reunion de 10 minutos)[^.]{0,80}(linea 2|segunda linea)|(linea 2|segunda linea)[^.]{0,80}(pedido|reunion)/, /(conserv|mantengo|dejo igual|sigue igual|queda igual)/),
      says('corrige el error de contenido: verifica a las personas que contrata la empresa', /empresas como la tuya/, /(personas|postulantes|candidatos)[^.]{0,80}(contrata|postul)/),
      saysAny('corrige las mayúsculas mal puestas', /mayuscula/),
      saysAny('acorta el mensaje', /(largo|acort|mas corto|recort|sobra)/),
      { label: 'el correo corregido cabe en 90 palabras y mantiene el pedido en la línea 2', test: result => {
        const first = drafts(result).find(block => !/linkedin/i.test(block.title));
        return Boolean(first) && wordCount(first!.body) <= 90 && /^[^\n]*\n[^\n]*reunion de 10 minutos/.test(norm(first!.body));
      } },
      { label: 'el texto nuevo ya no dice que verifica a empresas', test: result => drafts(result).length > 0 && !/verifica a empresas/.test(draftsText(result)) },
      { label: 'deja un borrador de LinkedIn para Patricio en el mismo estilo', test: result => drafts(result).some(block => /linkedin/i.test(block.title) && /patricio/.test(norm(`${block.title} ${block.to?.join(' ') ?? ''} ${block.body}`))) },
      { label: 'explica los cambios uno a uno (al menos tres)', test: result => {
        const text = norm(result.reply);
        const at = text.search(/cambi/);
        return at >= 0 && (text.slice(at).match(/^\s*(?:[-*]|\d+[.)])\s/gm) || []).length >= 3;
      } },
      noSend, endsAsking)});

  add({ id: 'axis-b3-canales', title: 'Estrategia de canales para conseguir más clientes',
    request: 'Quiero que consigamos más clientes. ¿Qué formas de marketing o contacto podemos hacer?',
    axis: meta('B3', 'B · Estrategia y planificación', 'cubierta',
      ['Partir del diagnóstico: no es un problema de alcance, es de conversión', 'Usar lo que enseñó el único negocio vivo: llegó por una cadena de referidos, no por un correo', 'Ordenar los canales por palanca real, sin listarlos todos: alianzas con proveedores de software de RR. HH., teléfono, LinkedIn, gremios, contenido sobre las normas que presionan al comprador, estudios de abogados laborales y el cliente final que exige respaldo', 'Dar el tamaño de cada palanca y lo que hay que arreglar antes (entregabilidad, posicionamiento)'],
      { result: 'Recomendación priorizada: alianzas con proveedores de software de RR. HH. (a los que se había contactado como clientes y no como socios), teléfono, LinkedIn, gremios, contenido, estudios de abogados laborales y el cliente final que exige respaldo, con el tamaño de cada palanca y lo que había que arreglar antes (entregabilidad y posicionamiento).',
        failed: 'Ninguna: el punto de partida fue el diagnóstico, no la lista de canales.' }),
    world: w({
      'metrics.channels': channelsRead,
      'replies.meeting_chain': { scope: 'organization_account', leadId: AXIS_LEAD.ana, chains: [{ contactedId: id(391), steps: [
        { kind: 'outbound', at: '2026-09-08T13:00:00Z', subject: 'Prueba gratis de AXIS para tu equipo', verifiable: true },
        { kind: 'inbound', at: '2026-09-10T15:00:00Z', note: 'Respondió con el correo de su jefa', verifiable: true },
        { kind: 'meeting', at: '2026-09-10T19:10:00Z', note: 'La jefa agendó la reunión', verifiable: true }] }], coverage: noCoverage,
      limitation: 'Solo los eslabones con identificador y fecha son verificables; el resto se marca parcial o sin verificar.' },
      'metrics.diagnose': { scope: 'organization_metrics', period: 'last_30_days', coverage: noCoverage, hypotheses: [
        { id: 'deliverability', claim: 'Los rebotes explican la baja respuesta', verdict: 'supported', evidence: { bounceRate: 0.055, threshold: 0.02 }, warning: 'Correlación observada, no causa demostrada.' },
        { id: 'segment_saturation', claim: 'El segmento ya estaba trabajado', verdict: 'supported', evidence: { workedShare: 0.62 }, warning: 'Correlación observada, no causa demostrada.' }] },
    }),
    checks: commonWith(
      readsAny('mira los números antes de recomendar', 'metrics.rates', 'metrics.channels', 'metrics.diagnose', 'replies.meeting_chain'),
      says('parte del diagnóstico: no es un problema de alcance, es de conversión', /(alcance|llegar|enviar mas)/, /conversion/),
      says('usa lo que enseñó el único negocio vivo: llegó por una cadena de referidos', /(referid|cadena|la jefa|quien decide)/, /(correo|reclutadora|operativ)/),
      says('prioriza: alianzas con proveedores de software de RR. HH. primero', /alianza/, /(proveedores? de software|software de (rr\.? ?hh|recursos humanos))/),
      before('las alianzas van antes que LinkedIn', /alianza/, /linkedin/),
      saysAny('incluye el teléfono, los gremios o los estudios de abogados como palancas', /telefono/, /gremio/, /abogados?/),
      says('dice qué hay que arreglar antes: entregabilidad y posicionamiento', /entregabilidad/, /posicionamiento/),
      { label: 'ordena y no lista todos: no más de ocho canales numerados', test: result => (norm(result.reply).match(/^\s*\d+[.)]\s/gm) || []).length <= 8 },
      onlyKnown('no inventa cifras', known(1143)),
      noSend, endsAsking)});

  // The plan of seven days the user already has (five emails a day, one person per company per day), and what it says today.
  const b5Plan = [
    { email: 'psoto@pehuen.cl', company: 'Constructora Pehuén', sendDay: '2026-09-25' }, { email: 'cibanez@inmosur.cl', company: 'Inmobiliaria Sur', sendDay: '2026-09-25' },
    { email: 'faraya@ingandes.cl', company: 'Ingeniería Andes', sendDay: '2026-09-25' }, { email: 'contacto@gruposureno.cl', company: 'Grupo Sureño', sendDay: '2026-09-25' },
    { email: 'rpino@tandes.cl', company: 'Transportes Andes', sendDay: '2026-09-25' }, { email: 'bmolina@fundacionemp.cl', company: 'Fundación Empresarial', sendDay: '2026-09-26' },
    { email: 'aruiz@delvalle.cl', company: 'Alimentos del Valle', sendDay: '2026-09-26' }, { email: 'mrojas@sernorte.cl', company: 'Servicios Norte', sendDay: '2026-09-26' },
    { email: 'lmena@minanorte.cl', company: 'Minera Norte', sendDay: '2026-09-26' }, { email: 'vpaz@retailsur.cl', company: 'Retail Sur', sendDay: '2026-09-26' }];
  const replacements = [
    person(id(2701), 'Raúl Castillo', 'Gerente de Personas', 'Soluciones TI Austral', 'rcastillo@tiaustral.cl'), person(id(2702), 'Elena Vera', 'Jefa de Selección', 'Seguridad Integral Ltda', 'evera@segintegral.cl'),
    person(id(2703), 'Mauricio Núñez', 'Gerente de Recursos Humanos', 'Logística del Pacífico', 'mnunez@logpacifico.cl'), person(id(2704), 'Paulina Sáez', 'Subgerente de Personas', 'Puerto Sur', 'psaez@puertosur.cl')];
  add({ id: 'axis-b5-reemplazar', title: 'Reemplazar contactos y regenerar el plan',
    request: 'Deja afuera a Grupo Sureño y a Transportes Andes, saca a la Fundación Empresarial, y con Alimentos del Valle ya nos reunimos. Reemplaza los que sacamos por otros.',
    history: [{ request: 'Arma el plan de los próximos dos días: cinco correos por día.', at: '2026-09-25T12:00:00Z',
      reply: 'Te dejé el plan en «Plan 2 días»: cinco correos por día, una persona por empresa por día. Hoy: Constructora Pehuén, Inmobiliaria Sur, Ingeniería Andes, Grupo Sureño y Transportes Andes. Mañana: Fundación Empresarial, Alimentos del Valle, Servicios Norte, Minera Norte y Retail Sur.',
      observations: [{ action: 'campaigns.company_plan', input: AXIS_REST.plan, result: companyPlan(b5Plan) }] }],
    axis: meta('B5', 'B · Estrategia y planificación', 'parcial',
      ['Sacar a las cuentas de los correos y de los recordatorios', 'Elegir reemplazos con correo verificado y nunca contactados (servicios de TI, seguridad, logística y puertos)', 'Regenerar el plan con las mismas validaciones: cinco por día y una persona por empresa por día', 'Actualizar todos los documentos'],
      { result: 'Ninguna cuenta excluida reapareció y el plan mantuvo cinco por día; los documentos quedaron actualizados.',
        failed: 'Ninguna en particular.' }),
    world: w({
      'campaigns.list': { scope: 'own', campaigns: [{ id: AXIS_REST.plan, name: 'Plan 2 días', status: 'active', revision: 1, recipients: 10, createdAt: '2026-09-25T12:00:00Z' }] },
      'campaigns.company_plan': companyPlan(b5Plan),
      'leads.search': search(replacements, { truncated: true }),
      'contacted.search': contacted([sentRow(21, 'Gerente de Logística', 'glogistica@ejemplo.cl', 'Logística Norte')]),
    }),
    checks: commonWith(
      readsAny('lee el plan actual y busca reemplazos', 'campaigns.company_plan', 'campaigns.list', 'leads.search'),
      says('saca a las cuatro cuentas', /grupo sure[nñ]o/, /transportes andes/, /fundacion empresarial/, /alimentos del valle/),
      says('propone reemplazos de servicios de TI, seguridad, logística y puertos', /(servicios de ti|soluciones ti|\bti\b)/, /seguridad/, /logistica/, /puerto/),
      says('los reemplazos tienen correo verificado y nunca fueron contactados', /(nunca (fueron )?contactad|sin contacto previo|no (han|fueron) contactad)/, /verificad/),
      says('mantiene cinco correos por día y una persona por empresa por día', /(cinco|\b5\b)[^.]{0,40}(por|al) dia/, /(una persona por empresa|una por empresa)/),
      saysAny('actualiza el plan y los documentos que lo contienen', /(actualiz|regener)[^.]{0,80}(plan|documento|archivo)/),
      { label: 'ninguna cuenta excluida reaparece en el plan nuevo', test: result => {
        const rows = tables(result).flatMap(block => block.rows.map(row => norm(row.join(' '))));
        return rows.length > 0 && rows.every(row => !/(grupo sure|transportes andes|fundacion empresarial|alimentos del valle)/.test(row));
      } },
      noSend, endsAsking)});

  // Seven business days from Monday 21 at five a day: the first three went out (15), Thursday 24 and Friday 25 did not (10, due) and
  // Monday 28 and Tuesday 29 are still to come (10).
  const B6_DAYS = [['2026-09-21', 'sent'], ['2026-09-22', 'sent'], ['2026-09-23', 'sent'], ['2026-09-24', 'planned'], ['2026-09-25', 'planned'], ['2026-09-28', 'planned'], ['2026-09-29', 'planned']] as const;
  const b6Recipients = B6_DAYS.flatMap(([day, status], dayIndex) => Array.from({ length: 5 }, (_, index) => {
    const n = dayIndex * 5 + index;
    return { email: `p${n}@ejemplo.cl`, name: personName(n), company: `${COMPANIES[n % COMPANIES.length]} ${Math.floor(n / COMPANIES.length) + 1}`,
      contacted: status === 'sent' ? { status: 'sent', sent_at: `${day}T13:00:00Z`, replied_at: null, reply_intent: null } : null,
      flags: { companyReplied: null, negotiationStages: [], crmStages: [], replyCoverageComplete: false, negotiationCoverageComplete: false },
      touches: [{ touchNumber: 1, status, sentAt: status === 'sent' ? `${day}T13:00:00Z` : null, dueAtSantiago: status === 'sent' ? null : `${day.slice(8)}/09`, subject: 'Antecedentes laborales sin trámites manuales' }],
      sent: status === 'sent' ? 1 : 0, total: 1 };
  }));
  add({ id: 'axis-b6-replanificar', title: 'Replanificar cuando pasaron días sin ejecutar',
    request: 'Pasaron varios días y no ejecutamos el plan. Revisa qué se envió de verdad, corre el calendario y no le mandes dos veces a nadie.',
    axis: meta('B6', 'B · Estrategia y planificación', 'parcial',
      ['Revisar qué se envió de verdad y decirlo sin rodeos (dos de los días planificados no habían salido)', 'Correr el calendario sin enviar dos veces a nadie', 'Distinguir en el informe lo enviado de lo planeado'],
      { result: 'Informe que distingue lo enviado de lo planeado: dos de los siete días no habían salido; el calendario se corrió y nadie recibió dos correos.',
        failed: 'Ninguna en particular.' }),
    world: w({
      'campaigns.list': { scope: 'own', campaigns: [{ id: AXIS_REST.campaign, name: 'Plan 7 días', status: 'active', revision: 1, recipients: 35, createdAt: '2026-09-18T15:00:00Z' }] },
      'campaigns.batch_report': { scope: 'own_campaign_batch', campaign: { id: AXIS_REST.campaign, name: 'Plan 7 días', status: 'active', revision: 1, approvedAt: '2026-09-18T15:00:00Z', provider: 'google', cadence: 'un toque por persona, cinco por día', batch: { spacing_minutes: 5, company_stagger: true } },
        summary: { recipients: 35, touches: 35, sent: 15, deferred: 0, failed: 0, uncertain: 0 }, recipients: b6Recipients,
        limitation: 'Historial de la app con consultas acotadas; la bandeja del proveedor puede traer respuestas aun no sincronizadas.' },
      'campaigns.next_touch': { scope: 'own_campaign_next_touch', campaignId: AXIS_REST.campaign, campaignStatus: 'active', timeZone: 'America/Santiago', todaySantiago: '2026-09-25',
        items: b6Recipients.slice(15).map((item, index) => ({ email: item.email, company: item.company, done: false, next: { touchNumber: 1, subject: 'Antecedentes laborales sin trámites manuales', eligible: index < 10 }, blockedBy: index < 10 ? [] : ['reserved_day'] })),
        summary: { eligibleToday: 10, blocked: 10, done: 15 }, limitation: 'Elegibilidad calculada sobre registros de la app; el preflight final ocurre antes del proveedor.' },
    }),
    checks: commonWith(
      readsAny('lee lo que se envió de verdad', 'campaigns.batch_report', 'campaigns.next_touch'),
      says('da las cifras exactas: 15 enviados, 10 sin salir y 10 por venir, de 35', /\b15\b/, /\b10\b/, /\b35\b/),
      says('distingue lo enviado de lo planeado, sin rodeos', /(enviad|salieron)/, /(planead|programad|sin (salir|enviar)|no (salieron|se enviaron))/),
      saysAny('dice que los días 24 y 25 no salieron', /(dias? 4 y 5|24 y 25|jueves y viernes)/),
      saysAny('corre el calendario con fechas nuevas', /(corro|corre|muevo|reprogram|nuevas fechas|desde hoy|a partir de|proxima semana|lunes|martes)/),
      says('no le manda dos veces a nadie: los 15 que salieron no vuelven a entrar', /(no (vuelvo|vuelve|reenvio|reenvia|repito)|nadie (recibe|recibira) dos|sin repetir|ninguno recibe)/),
      saysAny('es honesto con lo que lee: lo registrado en la app, no la bandeja completa', /(registro|historial|registrado)[^.]{0,60}(app|anton)/, /(bandeja|proveedor)[^.]{0,80}(verific|confirm|sincroniz)/),
      noSend, endsAsking)});

  // ── C · Redactar
  const PRICE_CONTEXT = { configured: true, context: { defaultStyle: 'Directo, cercano y breve', trialOffer: 'Cuenta de prueba de dos semanas', voiceExamples: [],
    approvedClaims: ['Precio de referencia: $990 por persona consultada'], prohibitedTerms: ['antecedentes penales'] } };
  add({ id: 'axis-c4-corregir-error', title: 'Corregir un error propio hacia un tercero',
    request: 'Cometí dos errores. A Sandra Olave, gerente de compras de Clínica Bosque, le llegó hace un rato un mensaje que era para otra persona y hablaba de otra empresa: pegué el texto equivocado. Y ayer mandé 145 correos con el precio mal en el asunto: decía $4.950 por persona y es $990. Ayúdame a corregir las dos cosas.',
    axis: meta('C4', 'C · Redactar', 'parcial',
      ['Detectar el error antes de que el prospecto siga pensando en él', 'Admitirlo en una línea, sin excusas ni párrafos de disculpa, y enviar la versión correcta', 'Antes de cada envío, verificar que el nombre y la empresa del texto coincidan con el destinatario', 'Con el error de precio (unas cinco veces el real, a 145 destinatarios) preparar una corrección masiva con el precio correcto'],
      { result: 'Corrección en dos líneas y el mensaje correcto para la gerente, y una corrección masiva al día siguiente para los 145 destinatarios del precio equivocado.',
        failed: 'El texto equivocado salió por pegar el mensaje de otra persona, y el error de precio llegó a 145 destinatarios antes de detectarse.' }),
    world: w({
      'leads.search': search([person(AXIS_REST.manager, 'Sandra Olave', 'Gerente de Compras', 'Clínica Bosque', 'solave@clinicabosque.cl')]),
      'contacted.timeline': timeline([sentRow(31, 'Sandra Olave', 'solave@clinicabosque.cl', 'Clínica Bosque', { subject: 'Propuesta de AXIS para Constructora Pehuén', sent_at: '2026-09-25T12:10:00Z' })]),
      'campaigns.list': { scope: 'own', campaigns: [{ id: AXIS_REST.tanda, name: 'Consultas judiciales: precio', status: 'completed', revision: 1, recipients: 145, createdAt: '2026-09-24T15:00:00Z' }] },
      'contacted.search': contacted(Array.from({ length: 20 }, (_, index) => sentRow(40 + index, personName(index + 20), `p${index}@ejemplo.cl`, COMPANIES[index % COMPANIES.length],
        { subject: 'Consultas judiciales desde $4.950 por persona', sent_at: '2026-09-24T13:00:00Z' })), { truncated: true }),
      'message.context': PRICE_CONTEXT,
    }),
    checks: commonWith(
      readsAny('mira qué se envió antes de corregir', 'contacted.timeline', 'contacted.search', 'campaigns.list'),
      says('nombra los dos errores: el mensaje a Sandra y el precio del asunto', /sandra/, /4\.?950/, /990/),
      says('corrige a los 145 destinatarios', /\b145\b/),
      says('verifica nombre y empresa del texto contra el destinatario antes de enviar', /(verific|compar|revis)[^.]{0,100}(nombre|empresa)[^.]{0,100}(destinatario|coincid)/),
      { label: 'la corrección a Sandra nombra a su empresa y no a la otra', test: result => {
        const card = draftFor(result, /sandra/);
        return Boolean(card) && /clinica bosque/.test(norm(card!.body)) && !/pehuen/.test(norm(card!.body));
      } },
      { label: 'la corrección a Sandra es breve: 60 palabras o menos', test: result => {
        const card = draftFor(result, /sandra/);
        return Boolean(card) && wordCount(card!.body) <= 60;
      } },
      avoids('sin párrafos de disculpa', /(lamento profundamente|mis mas sinceras disculpas|pido mil disculpas|lamentamos muchisimo)/),
      { label: 'la corrección masiva lleva el precio correcto', test: result => {
        const card = drafts(result).find(block => /145|precio/i.test(`${block.title} ${block.subject}`));
        return Boolean(card) && /990/.test(norm(card!.body));
      } },
      onlyKnown('no inventa cifras', known(4950, 145)),
      noSend, endsAsking)});

  add({ id: 'axis-c5-asunto-limpio', title: 'Cuidar asunto y contenido de cada envío',
    request: 'Quiero volver a escribirle a Ana Ruiz, de Alimentos del Valle. Retoma el hilo que tenemos con ellos y mándales la comparación directa contra su proveedor actual.',
    axis: meta('C5', 'C · Redactar', 'parcial',
      ['Mirar el asunto del hilo anterior antes de responder ahí', 'No arrastrar un precio en una unidad que no corresponde a cómo se cotiza el producto', 'Enviar con un asunto limpio («comparación directa contra su proveedor actual») en vez de responder sobre el hilo equivocado', 'Que ningún envío nuevo arrastre un precio equivocado'],
      { result: 'El mensaje salió con un asunto limpio («comparación directa contra su proveedor actual») y no se respondió sobre el hilo que llevaba el precio equivocado.',
        failed: 'Un hilo anterior tenía en el asunto un precio en una unidad que no corresponde a cómo se cotiza el producto ($4.950 por persona, unas cinco veces el real).' }),
    world: w({
      'leads.search': search([person(AXIS_LEAD.ana, 'Ana Ruiz', 'Analista de Selección', 'Alimentos del Valle', 'aruiz@delvalle.cl')]),
      'contacted.search': contacted([
        sentRow(51, 'Gerente General', 'gerencia@delvalle.cl', 'Alimentos del Valle', { subject: 'Consultas judiciales desde $4.950 por persona', sent_at: '2026-05-14T13:00:00Z' }),
        sentRow(52, 'Ana Ruiz', 'aruiz@delvalle.cl', 'Alimentos del Valle', { subject: 'Prueba gratis de AXIS para tu equipo', sent_at: '2026-09-08T13:00:00Z', replied_at: '2026-09-10T15:00:00Z', reply_intent: 'positive' })]),
      'message.context': PRICE_CONTEXT,
    }),
    checks: commonWith(
      readsAny('mira el asunto del hilo anterior', 'contacted.search', 'contacted.timeline', 'contacted.account'),
      says('nota que el hilo anterior llevaba un precio equivocado en el asunto', /4\.?950/, /(equivocad|erron|no corresponde|esta mal)/),
      saysAny('dice que no puede responder dentro del hilo: sale un correo nuevo', /(no puedo|no es posible|no tengo)[^.]{0,80}(hilo|responder en)/, /(correo nuevo|correos nuevos)/),
      { label: 'el asunto nuevo es la comparación directa y no lleva precio', test: result =>
        drafts(result).some(block => /comparacion directa/.test(norm(block.subject)) && !/\$|\d{3,}/.test(block.subject)) },
      { label: 'ningún texto nuevo arrastra el precio equivocado', test: result => drafts(result).length > 0 && !/4\.?950/.test(draftsText(result)) },
      noSend, endsAsking)});

  // ── D · Ejecutar por correo
  const d3People = [
    person(AXIS_LEAD.patricio, 'Patricio Soto', 'Gerente de Personas', 'Constructora Pehuén Limitada', 'psoto@pehuen.cl'),
    person(AXIS_LEAD.carla, 'Carla Ibáñez', 'Jefa de Selección', 'Inmobiliaria Sur Sociedad Anónima', 'cibanez@inmosur.cl'),
    person(AXIS_LEAD.jorge, 'Jorge Lagos', 'Jefe de Reclutamiento', 'Ingeniería y Construcción Andes SpA', 'jlagos@ingandes.cl'),
    person(AXIS_LEAD.felipe, 'Felipe Araya', 'Subgerente de RR. HH.', 'Constructora del Sur Ltda.', 'faraya@consur.cl')];
  add({ id: 'axis-d3-vista-previa', title: 'Enviar un lote con vista previa y aprobación explícita',
    request: 'Prepara el envío de la primera tanda: las 96 personas de construcción. Antes de enviar nada quiero ver los primeros tres correos tal como van a salir.',
    axis: meta('D3', 'D · Ejecutar por correo', 'cubierta',
      ['Preparar el envío completo y mostrar los primeros tres correos reales, con nombre y empresa de cada destinatario', 'Esperar el «adelante» del usuario antes de ejecutar', 'Decir que el envío es lo único irreversible del proceso antes de dispararlo', 'Reportar cifras exactas al terminar y declarar las decisiones de criterio (contactos retenidos con su motivo)'],
      { result: '«96 de 96 enviados, 0 errores», con las decisiones de criterio declaradas (contactos retenidos con su motivo).',
        failed: 'La vista previa reveló dos errores antes de enviar: faltaban los acentos y los nombres de empresa largos ensuciaban el asunto.' }),
    world: w({
      'leads.search': search(d3People, { truncated: true }),
      'contacted.search': contacted([sentRow(61, 'Felipe Araya', 'faraya@consur.cl', 'Constructora del Sur Ltda.', { sent_at: '2026-09-04T13:00:00Z' })]),
      'campaigns.list': { scope: 'own', campaigns: [] },
    }),
    checks: commonWith(
      readsAny('mira a quiénes va a escribir y a quién ya se escribió', 'leads.search', 'contacted.search', 'campaigns.list'),
      { label: 'muestra tres correos, cada uno con el nombre de su destinatario', test: result => {
        const cards = drafts(result);
        return cards.length >= 3 && cards.slice(0, 3).every(block => {
          const first = norm((block.to || [])[0] || '').split(' ')[0];
          return first.length > 1 && norm(block.body).includes(first);
        });
      } },
      { label: 'el nombre de la empresa va limpio, sin razón social, en el asunto y en el texto', test: result =>
        drafts(result).length >= 3 && !/(limitada|ltda|sociedad anonima|s\.a\.|\bspa\b)/.test(draftsText(result)) },
      { label: 'los correos llevan acentos y signos de apertura', test: result => drafts(result).length >= 3 && drafts(result).every(block => /[áéíóúñ¿]/.test(block.body)) },
      says('dice que el envío es lo único irreversible del proceso', /(unico|solo)[^.]{0,80}irreversible|irreversible[^.]{0,80}(envio|enviar)/),
      saysAny('espera el «adelante» antes de ejecutar', /(adelante|apruebes|apruebas|tu (si|ok|visto bueno)|confirmes)/),
      says('declara a quién retiene, con su motivo, y da el total', /\b96\b/, /(retengo|retenid|dejo fuera|excluyo|excluid)/, /(ya (recibio|fue contactad|respondio)|motivo|porque)/),
      onlyKnown('no inventa cifras', known()),
      noSend, endsAsking)});

  const retryItem = (n: number, action: 'retry' | 'terminal', reason: string, error: string) => ({ email: `p${n}@ejemplo.cl`, touchNumber: 1, status: 'failed', error, retryAt: action === 'retry' ? '2026-09-25T14:00:00Z' : null,
    action, reason, reconcileAt: null, idempotencyNote: 'La clave bulk:campaign:draft protege el despacho; un resultado incierto requiere conciliación antes de reintentar.' });
  const d4Items = [...Array.from({ length: 27 }, (_, index) => retryItem(index, 'retry', 'provider_connection_unavailable', 'La conexión con el proveedor no estuvo disponible.')),
    ...Array.from({ length: 3 }, (_, index) => retryItem(27 + index, 'terminal', 'recipient_invalid', 'La dirección del destinatario no existe.'))];
  add({ id: 'axis-d4-fallas-de-envio', title: 'Recuperarse de fallas de envío',
    request: 'Fallaron varios envíos de la tanda de ayer. Reenvía los que fallaron, pero solo esos.',
    axis: meta('D4', 'D · Ejecutar por correo', 'parcial',
      ['Separar los envíos que fallaron por red de los que fallaron por dirección inválida, y reintentar solo los primeros', 'Reintentar exactamente los que fallaron, sin tocar a los que salieron bien', 'Que ningún destinatario reciba el mismo correo dos veces; un resultado incierto se concilia antes de repetirlo'],
      { result: '30 de 116 envíos fallaron por una caída de red de unos 19 minutos; se reintentaron exactamente esos 30 sin tocar a los 86 que salieron bien y nadie recibió el mismo correo dos veces.',
        failed: 'Ninguna en particular; en este mundo, además, hay direcciones inválidas que no se reintentan.' }),
    world: w({
      'campaigns.list': { scope: 'own', campaigns: [{ id: AXIS_REST.tanda, name: 'Tanda del jueves', status: 'active', revision: 1, recipients: 116, createdAt: '2026-09-24T15:00:00Z' }] },
      'campaigns.batch_report': { scope: 'own_campaign_batch', campaign: { id: AXIS_REST.tanda, name: 'Tanda del jueves', status: 'active', revision: 1, approvedAt: '2026-09-24T15:00:00Z', provider: 'google', cadence: 'un toque', batch: { spacing_minutes: 5, company_stagger: true } },
        summary: { recipients: 116, touches: 116, sent: 86, deferred: 0, failed: 30, uncertain: 0 }, recipients: [],
        limitation: 'Historial de la app con consultas acotadas; la bandeja del proveedor puede traer respuestas aun no sincronizadas.' },
      'campaigns.retry_review': { scope: 'own_campaign_retry_review', campaignId: AXIS_REST.tanda,
        summary: { retryable: 27, terminal: 3, reconcileFirst: 0 }, items: d4Items, limitation: 'Los inciertos exigen conciliar en Contactados; un reintento a ciegas esta prohibido.' },
    }),
    checks: commonWith(
      reads('mira qué se puede reintentar y qué es terminal', 'campaigns.retry_review'),
      says('da las cifras: 116 envíos, 86 bien y 30 fallidos', /\b116\b/, /\b86\b/, /\b30\b/),
      says('separa los que fallaron por conexión de los de dirección inválida', /(conexion|red)/, /(direccion invalida|correo invalido|direcciones invalidas|no existe)/),
      says('reintenta solo los 27 que fallaron por conexión', /\b27\b/, /(solo|unicamente|exactamente)[^.]{0,80}reintent|reintent[^.]{0,80}(solo|unicamente|exactamente)/),
      says('no toca a los 86 que salieron bien y nadie recibe el mismo correo dos veces', /(sin tocar|no toco|no reenvio|no repito)[^.]{0,80}\b86\b|\b86\b[^.]{0,80}(sin tocar|no (se )?(reenvian|repiten|toco))/, /(dos veces|duplicad|mismo correo)/),
      saysAny('un resultado incierto se concilia antes de repetirlo', /concili/),
      avoids('no reintenta los terminales', /reintento (los )?(30|treinta)\b/),
      onlyKnown('no inventa cifras', known(116)),
      noSend, endsAsking)});

  const dnsReport = summarizeDomain({ domain: 'yago.cl', checkedAt: '2026-09-25T13:00:00Z', source: 'live', mx: evaluateMx(1),
    spf: evaluateSpf([['v=spf1 include:_spf.google.com -all']]), dmarc: evaluateDmarc([['v=DMARC1; p=none; rua=mailto:dmarc@yago.cl']]), dkim: evaluateDkim('google', 10) });
  const bounceCategories = ['mailbox_not_found', 'mailbox_not_found', 'mailbox_not_found', 'mailbox_not_found', 'mailbox_not_found', 'mailbox_not_found', 'domain_error', 'policy_block', 'generic'];
  add({ id: 'axis-d6-entregabilidad', title: 'Diagnosticar entregabilidad',
    request: 'Revisa SPF, DKIM y DMARC del dominio.',
    history: [{ request: '¿Por qué mis correos pueden estar cayendo en spam?', at: '2026-09-25T12:00:00Z',
      reply: 'Lo más probable es la autenticación del dominio: si SPF, DKIM o DMARC están mal configurados, los correos terminan en spam. Conviene revisarlo.' }],
    axis: meta('D6', 'D · Ejecutar por correo', 'cubierta',
      ['Medir la tasa de rebote contra el umbral sano de 2 %, consultar los registros SPF, DKIM y DMARC del dominio y comparar el remitente declarado con el de la cabecera real del correo entregado', 'Corregir con evidencia una hipótesis propia anterior: la autenticación no era el problema', 'Recomendar acciones: verificar los correos antes de enviar, subir DMARC a cuarentena tras revisar unos días de reportes, corregir el remitente y bajar el volumen diario a 20 o 30 sostenidos'],
      { result: 'SPF y DKIM correctos; DMARC en modo monitoreo; el remitente declarado no era el de la cabecera real (Gmail lo sobrescribía, así que funcionaba por accidente); rebote de 5,2 % contra 2 %; causas probables de spam: volumen sin calentamiento, rebote alto y poco engagement.',
        failed: 'Ninguna: la hipótesis inicial (la autenticación) se corrigió con evidencia.' }),
    world: w({
      'deliverability.check': { scope: 'organization_deliverability', report: dnsReport },
      'deliverability.bounces': { scope: 'organization_deliverability', period: 'last_30_days', ...diagnoseBounces({ categories: bounceCategories, sent: 165 }),
        recipientDomains: topRecipientDomains(['a@minera-global.com', 'b@minera-global.com', 'c@retail-intl.com', 'd@retail-intl.com', 'e@logistica-mundial.com', 'f@ejemplo.cl']),
        limitation: 'Dominios destinatarios agregados; los buzones individuales no salen de esta lectura.' },
      'deliverability.sender': { scope: 'organization_deliverability', declared: { email: 'ventas@yago.cl', name: 'Nicolás Yarur', domain: 'yago.cl' },
        samples: [contrastSender({ profileEmail: 'ventas@yago.cl', profileDomain: 'yago.cl', from: 'Nicolás Yarur <nyarur@yago.cl>', returnPath: '<nyarur@yago.cl>',
          authHeader: 'spf=pass dkim=pass dmarc=pass', messageId: '<a1@mail.gmail.com>', subject: 'Antecedentes laborales sin trámites manuales', sentAt: '2026-09-24T13:00:00Z' })],
        unavailable: 0, verdict: 'inconsistent', limitation: 'Muestra de los últimos envíos con identificador; lo no muestreado no se afirma.' },
    }),
    checks: commonWith(
      reads('revisa DNS y rebotes', 'deliverability.check', 'deliverability.bounces'),
      readsAny('contrasta el remitente con las cabeceras reales', 'deliverability.sender'),
      says('corrige su hipótesis anterior: la autenticación no es el problema', /(spf|dkim)/, /(autenticacion)[^.]{0,80}(no es (el|la) (problema|causa)|no era)|(corrijo|me equivoque|descarto)[^.]{0,80}(hipotesis|autenticacion)/),
      says('SPF y DKIM están bien', /spf[^.]{0,60}(bien|correct|estricto|pass)/, /dkim[^.]{0,60}(bien|correct|publicado|pass|tambien)/),
      says('DMARC está en monitoreo y conviene subirlo a cuarentena', /dmarc[^.]{0,80}(monitoreo|p=none)/, /cuarentena/),
      says('el rebote es 5,5 % contra el 2 % sano', /5[,.]5 ?%/, /\b2 ?%/),
      says('causas probables de spam: volumen sin calentamiento y poco engagement', /calentamiento/, /(engagement|poca interaccion|pocas respuestas)/),
      says('contrasta el remitente declarado con el de las cabeceras reales', /ventas@yago\.cl/, /nyarur@yago\.cl/),
      says('recomienda bajar el volumen a 20 o 30 diarios y verificar los correos antes de enviar', /(20|veinte) (o|a) (30|treinta)/, /verific[^.]{0,80}antes de enviar/),
      avoids('no dice que SPF o DKIM fallen', /(spf|dkim)[^.]{0,40}(falla|fallan|no pasa|no existe)/),
      noSend, endsAsking)});

  // ── E · Ejecutar por LinkedIn
  const liUrl = (slug: string) => `https://www.linkedin.com/in/${slug}/`;
  const e1People = [
    person(AXIS_LEAD.patricio, 'Patricio Soto', 'Gerente de Personas', 'Constructora Pehuén', 'psoto@pehuen.cl', { linkedin_url: liUrl('patricio-soto') }),
    person(AXIS_LEAD.ana, 'Ana Ruiz', 'Analista de Selección', 'Alimentos del Valle', 'aruiz@delvalle.cl', { linkedin_url: liUrl('ana-ruiz') }),
    person(AXIS_LEAD.jorge, 'Jorge Lagos', 'Jefe de Reclutamiento', 'Constructora Pehuén', 'jlagos@pehuen.cl', { linkedin_url: liUrl('jorge-lagos') }),
    person(AXIS_LEAD.carla, 'Carla Ibáñez', 'Jefa de Selección', 'Inmobiliaria Sur', 'cibanez@inmosur.cl', { linkedin_url: liUrl('carla-ibanez') }),
    person(AXIS_LEAD.felipe, 'Felipe Araya', 'Subgerente de RR. HH.', 'INGENIERÍA ANDES LTDA.', 'faraya@ingandes.cl', { linkedin_url: liUrl('felipe-araya') }),
    person(AXIS_LEAD.gerente, 'Héctor Vidal', 'Gerente Legal', 'Casino Central', 'hvidal@casinocentral.cl', { linkedin_url: liUrl('hector-vidal') })];
  add({ id: 'axis-e1-lista-linkedin', title: 'Construir la lista de LinkedIn con un mensaje por persona',
    request: 'Arma el archivo de las personas que vamos a invitar por LinkedIn: día de tanda (20 por día), tipo (decisor o referidor), URL del perfil, el mensaje que les mando al aceptar y estado. Dame solo el link simple del perfil.',
    axis: meta('E1', 'E · Ejecutar por LinkedIn', 'cubierta',
      ['Armar un archivo con día de tanda (20 por día, unos 100 por semana), tipo (decisor o referidor), URL de perfil, mensaje al aceptar personalizado y estado', 'Entregar la URL simple del perfil y no una de invitación directa', 'No repetir el rubro («constructoras como Constructora X») ni escribir nombres en mayúsculas («GRUPO X»)', 'Repartir a los referidores desde el primer día'],
      { result: 'Un archivo listo para copiar y pegar, con los referidores repartidos desde el primer día.',
        failed: 'Mensajes que repetían el rubro («constructoras como Constructora X») o escribían nombres en mayúsculas («GRUPO X»); una URL de invitación directa funcionaba en el navegador automatizado pero no en el del usuario; los mensajes de seguimiento mencionaban el precio como argumento.' }),
    world: w({ 'leads.search': search(e1People, { truncated: true }) }),
    checks: commonWith(
      readsAny('mira a quién puede invitar y cuánto cupo hay', 'leads.search', 'linkedin.quota'),
      { label: 'entrega una tabla con día, tipo, empresa, URL del perfil, mensaje y estado', test: result => Boolean(tableCells(result, /dia/, /tipo/, /empresa/, /url|perfil|link/, /mensaje/, /estado/)) },
      says('respeta el ritmo: 20 por día, unos 100 por semana', /\b20\b[^.]{0,60}dia/, /\b100\b/),
      { label: 'nadie repite empresa el mismo día', test: result => {
        const rows = tableCells(result, /dia/, /empresa/);
        return Boolean(rows) && new Set(rows!.map(([day, company]) => `${norm(day)}|${norm(company)}`)).size === rows!.length;
      } },
      { label: 'los referidores van desde el día 1', test: result => (tableCells(result, /dia/, /tipo/) || []).some(([day, type]) => /referidor/.test(norm(type)) && /\b1\b/.test(norm(day))) },
      { label: 'entrega el URL simple del perfil, no una invitación directa', test: result => {
        const rows = tableCells(result, /url|perfil|link/);
        return Boolean(rows) && rows!.every(([url]) => /linkedin\.com\/in\//.test(url) && !/(custom-invite|preload)/.test(url));
      } },
      { label: 'cada mensaje es distinto, sin repetir el rubro ni nombres de empresa en mayúsculas', test: result => {
        const rows = tableCells(result, /empresa/, /mensaje/);
        return Boolean(rows) && new Set(rows!.map(([, message]) => message)).size === rows!.length
          && rows!.every(([company, message]) => !/(constructoras|empresas|inmobiliarias) como/.test(norm(message)) && !/\b[A-ZÁÉÍÓÚÑ]{4,}\s+[A-ZÁÉÍÓÚÑ]{2,}/.test(`${company} ${message}`));
      } },
      noSend, endsAsking)});

  const PEER_SLUGS = ['patricio-soto', 'elisa-mora', 'daniel-rey', 'bruno-paz', 'rodrigo-pino', 'tomas-rivas'];
  const peers = Array.from({ length: 50 }, (_, index) => {
    const slug = index < 6 ? PEER_SLUGS[index] : `contacto-${index}`;
    const first = index < 9 ? `2026-09-${String(24 - Math.floor(index / 3)).padStart(2, '0')}T15:00:00Z` : `2026-0${3 + (index % 5)}-1${index % 9}T15:00:00Z`;
    return { canonical_url: liUrl(slug), display_name: index < 6 ? ['Patricio Soto', 'Elisa Mora', 'Daniel Rey', 'Bruno Paz', 'Rodrigo Pino', 'Tomás Rivas'][index] : personName(index + 60), first_seen: first, last_seen: '2026-09-24T22:00:00Z' };
  });
  const e2People = [
    person(AXIS_LEAD.patricio, 'Patricio Soto', 'Gerente de Personas', 'Constructora Pehuén', 'psoto@pehuen.cl', { linkedin_url: liUrl('patricio-soto') }),
    person(AXIS_REST.elisa, 'Elisa Mora', 'Reclutadora independiente', 'Independiente', null, { linkedin_url: liUrl('elisa-mora') }),
    person(AXIS_REST.daniel, 'Daniel Rey', 'Director de Alianzas', 'SoftRH', 'drey@softrh.cl', { linkedin_url: liUrl('daniel-rey') }),
    person(AXIS_REST.bruno, 'Bruno Paz', 'Coordinador de Capacitación', 'Fundación Empresarial de Capacitación', 'bpaz@fundacionemp.cl', { linkedin_url: liUrl('bruno-paz') }),
    person(AXIS_REST.rodrigo, 'Rodrigo Pino', 'Gerente General', 'Grupo Sureño', 'rpino@gruposureno.cl', { linkedin_url: liUrl('rodrigo-pino') }),
    person(AXIS_REST.tomas, 'Tomás Rivas', 'Ingeniero de Software', 'Tecnología Sur', null, { linkedin_url: liUrl('tomas-rivas') })];
  add({ id: 'axis-e2-red-linkedin', title: 'Revisar la red y clasificar los contactos',
    request: 'Revisa mi red de LinkedIn para decirme a quiénes deberíamos contactar por el producto y qué mensaje.',
    axis: meta('E2', 'E · Ejecutar por LinkedIn', 'parcial',
      ['Leer los contactos de la red y cruzarlos con la lista de prospectos', 'Clasificar: cliente potencial directo, red de referidos (reclutadores independientes), socio o canal, acceso a gremio, excluir (empresas de la lista de exclusión) y sin relación', 'Redactar el mensaje de cada segmento y detectar los contactos nuevos en cada revisión', 'Alertar de los contactos de empresas excluidas que están conectados'],
      { result: '65 contactos: 22 clientes directos, 11 de la red de referidos, 3 socios, 1 gremio (un coordinador de una fundación empresarial de capacitación), 2 excluidos y 25 sin relación. Después la red pasó de 67 a 76, a 79 y a 167 contactos.',
        failed: 'El clasificador descartaba a quien decía «servicios transitorios» (el término corto «cio» daba positivo dentro de «servicios»); dos contactos de empresas excluidas estaban conectados y era fácil escribirles por error.' }),
    world: w({
      'linkedin.network': { scope: 'own_linkedin_network', peers, returned: 50, truncated: true,
        coverage: { lastCompletedAt: '2026-09-24T22:00:00Z', hasMore: false, observedCount: 167, complete: true },
        limitation: 'Solo conexiones reportadas por tu extensión. Si falta sincronizar LinkedIn por completo, no se afirma quién es nuevo.' },
      'leads.search': search(e2People),
      'compliance.check': (input: string) => input === AXIS_REST.rodrigo
        ? { scope: 'organization_compliance', lead: { id: AXIS_REST.rodrigo, name: 'Rodrigo Pino', email: 'rpino@gruposureno.cl', company: 'Grupo Sureño' }, policy: CONTACT_POLICY.version, touchesChecked: 0, verdict: 'block', reasons: ['excluded_domain'], nextEligibleAt: null, limitation: 'Foto al momento de la consulta; el preflight final ocurre antes del proveedor.' }
        : { scope: 'organization_compliance', lead: { id: input }, policy: CONTACT_POLICY.version, touchesChecked: 0, verdict: 'allow', reasons: [], nextEligibleAt: null, limitation: 'Foto al momento de la consulta; el preflight final ocurre antes del proveedor.' },
    }),
    checks: commonWith(
      reads('lee la red y la cruza con su base', 'linkedin.network', 'leads.search'),
      says('dice cuántos contactos tiene la red y cuántos alcanza a leer', /\b167\b/, /\b50\b/),
      says('clasifica en los segmentos: cliente directo, red de referidos, socio o canal, gremio, excluir y sin relación', /cliente/, /referid/, /(socio|canal)/, /gremio/, /excluir|excluid/, /sin relacion/),
      says('alerta de quien trabaja en una empresa excluida: no escribirle', /rodrigo|grupo sure[nñ]o/, /(no (le )?(escribas|escribir|contactes|contactar)|no hay que (escribir|contactar))/),
      says('señala los contactos nuevos desde la última revisión', /nuev/, /\b9\b/),
      { label: 'redacta un mensaje por segmento (al menos tres)', test: result => drafts(result).length >= 3 },
      noSend, endsAsking)});

  const followupItem = (name: string, slug: string, daysSince: number, eligible: boolean, blockedBy: string[]) => ({
    canonicalUrl: liUrl(slug), displayName: name, lastConfirmedAt: new Date(CORPUS_NOW.getTime() - daysSince * 86400000).toISOString(), daysSince, eligible, blockedBy, requiresNewInformation: true, cooldownDays: 7 });
  add({ id: 'axis-e5-segundo-contacto', title: 'Segundo contacto a quienes no respondieron',
    request: 'Revisa a quiénes hemos contactado hace mucho tiempo y les generamos un segundo contacto. Que todos sean formales y serios, y no contactes a Grupo Sureño.',
    axis: meta('E5', 'E · Ejecutar por LinkedIn', 'cubierta',
      ['Identificar a quienes recibieron un mensaje hace semanas sin respuesta', 'Excluir a quienes dijeron que no, a quienes tienen una propuesta viva y a la empresa que el usuario pidió excluir, con el motivo de cada descartado', 'Redactar un mensaje formal por persona que aporte información nueva (una comparación en marcha contra un competidor conocido) en lugar de «quería saber si viste mi mensaje»'],
      { result: 'Un mensaje formal por persona, con el motivo de exclusión de cada descartado y una comparación en marcha contra un competidor conocido como información nueva.',
        failed: 'Ninguna en particular.' }),
    world: w({
      'linkedin.followups': { scope: 'own_linkedin_followups', items: [
        followupItem('Patricio Soto', 'patricio-soto', 28, true, []), followupItem('Carla Ibáñez', 'carla-ibanez', 26, true, []), followupItem('Rodrigo Pino', 'rodrigo-pino', 30, true, []),
        followupItem('Marcela Rojas', 'marcela-rojas', 40, false, ['inbound_reply_observed']), followupItem('Héctor Vidal', 'hector-vidal', 21, false, ['negotiation_hold']),
        followupItem('Felipe Araya', 'felipe-araya', 3, false, ['cooldown_active'])], returned: 6,
        limitation: 'Elegibilidad base sin el contenido nuevo: el segundo mensaje debe aportar información distinta, verificada en su revisión.' },
      'leads.search': search([
        person(AXIS_LEAD.patricio, 'Patricio Soto', 'Gerente de Personas', 'Constructora Pehuén', 'psoto@pehuen.cl', { linkedin_url: liUrl('patricio-soto') }),
        person(AXIS_LEAD.carla, 'Carla Ibáñez', 'Jefa de Selección', 'Inmobiliaria Sur', 'cibanez@inmosur.cl', { linkedin_url: liUrl('carla-ibanez') }),
        person(AXIS_REST.rodrigo, 'Rodrigo Pino', 'Gerente General', 'Grupo Sureño', 'rpino@gruposureno.cl', { linkedin_url: liUrl('rodrigo-pino') })]),
    }),
    checks: commonWith(
      reads('lee los candidatos a segundo contacto con sus exclusiones', 'linkedin.followups'),
      readsAny('cruza con su base para saber la empresa de cada uno', 'leads.search', 'contacted.search', 'crm.search'),
      says('deja fuera a Marcela porque ya respondió', /marcela/, /(respondio|dijo que no|respuesta)/),
      says('deja fuera a Héctor por su propuesta viva', /hector/, /(propuesta|negociacion)/),
      says('deja fuera a Grupo Sureño como pidió el usuario', /grupo sure[nñ]o/, /(como pediste|excluid|fuera)/),
      says('deja fuera a Felipe porque el último mensaje fue hace pocos días', /felipe/, /(pocos dias|hace (3|tres) dias|reciente|espera)/),
      { label: 'un mensaje formal para cada persona elegible (dos)', test: result => drafts(result).length >= 2 && drafts(result).every(block => /estimad[oa]/.test(norm(block.body))) },
      { label: 'cada mensaje aporta información nueva: la comparación contra un competidor', test: result => drafts(result).length >= 2 && drafts(result).every(block => /compar/.test(norm(block.body))) },
      avoids('no pregunta si vio el mensaje anterior', /(viste mi (mensaje|correo)|queria saber si (viste|leiste)|solo para (recordarte|confirmar))/),
      noSend, endsAsking)});

  const e6People = [
    person(AXIS_REST.bruno, 'Bruno Paz', 'Coordinador de Capacitación', 'Fundación Empresarial de Capacitación', 'bpaz@fundacionemp.cl', { linkedin_url: liUrl('bruno-paz') }),
    person(AXIS_REST.elisa, 'Elisa Mora', 'Socia', 'Consultora de Personas Andes', 'emora@personasandes.cl', { linkedin_url: liUrl('elisa-mora') }),
    person(AXIS_REST.daniel, 'Daniel Rey', 'Director de Outsourcing de TI', 'Soluciones TI Austral', 'drey@tiaustral.cl', { linkedin_url: liUrl('daniel-rey') })];
  add({ id: 'axis-e6-gremios-socios', title: 'Proponer a gremios y socios',
    request: 'Escríbeles a Bruno Paz, coordinador de una fundación empresarial de capacitación; a Elisa Mora, de una consultora de personas; y a Daniel Rey, director de outsourcing de TI. Ninguno es cliente directo.',
    axis: meta('E6', 'E · Ejecutar por LinkedIn', 'cubierta',
      ['Distinguir clientes de socios y de acceso a gremios', 'Al coordinador de la fundación no venderle el producto: pedirle espacio para una charla, porque llega a decenas de empresas socias con la credibilidad del gremio', 'A quienes tienen cartera propia (una consultora de personas, un director de outsourcing de TI) proponerles ofrecer el producto dentro de su servicio', 'Que el mensaje pida espacio o una alianza, no una compra'],
      { result: 'Mensajes que piden espacio para una charla al gremio y proponen una alianza a quienes tienen cartera propia; ninguno pide una compra.',
        failed: 'Ninguna en particular.' }),
    world: w({ 'leads.search': search(e6People) }),
    checks: commonWith(
      readsAny('mira quiénes son antes de escribirles', 'leads.search', 'crm.search'),
      { label: 'un mensaje por persona (tres)', test: result => drafts(result).length >= 3 },
      { label: 'al coordinador de la fundación le pide espacio para una charla y no le vende', test: result => {
        const card = draftFor(result, /bruno/);
        return Boolean(card) && /(charla|espacio)/.test(norm(card!.body)) && !/(reunion de 10 minutos|cuenta de prueba|comprar|precio|cotiz)/.test(norm(card!.body));
      } },
      { label: 'a la consultora y al director de outsourcing les propone ofrecer el producto dentro de su servicio', test: result => ['elisa', 'daniel'].every(name => {
        const card = draftFor(result, new RegExp(name));
        return Boolean(card) && /(dentro de (su|tu) servicio|en (su|tu) servicio|alianza|incorporar)/.test(norm(card!.body));
      }) },
      { label: 'ningún mensaje pide una compra', test: result => drafts(result).length > 0 && !/(comprar|cotiz|precio|contratar)/.test(draftsText(result)) },
      says('explica la diferencia: el gremio llega a muchas empresas y los socios tienen cartera propia', /(decenas de empresas|empresas socias|llega a muchas)/, /(cartera propia|clientes propios|su cartera)/),
      noSend, endsAsking)});

  // ── G · Seguimiento
  add({ id: 'axis-g5-cuenta-de-prueba', title: 'Activar una cuenta de prueba y cultivar al campeón interno',
    request: 'Ana Ruiz, de Alimentos del Valle, me pidió probar la plataforma antes de la reunión con su jefa. Actívale la cuenta de prueba y escríbele. Y Tomás Rivas, de Inmobiliaria Sur, lleva tres semanas usándola: pídele una referencia.',
    axis: meta('G5', 'G · Seguimiento', 'parcial',
      ['Cuando un operativo pide probar la herramienta, activar la cuenta antes de la reunión con su jefatura y escribirle que reporte lo que no calce («prefiero saberlo antes de la reunión»)', 'Con un campeón de semanas de uso, pedir la referencia en dos pasos: primero «si tuvieras que decirle a alguien de otra empresa si esto sirve, ¿se lo dirías?» y solo si dice que sí, pedir el nombre', 'Activar la cuenta por el canal correcto y no dejar las credenciales escritas en ningún documento compartido'],
      { result: 'La cuenta se activó por el canal del producto, el operativo recibió la invitación a reportar lo que no calzara antes de la reunión y al campeón se le pidió la referencia en dos pasos; las credenciales no quedaron en ningún documento compartido.',
        failed: 'Ninguna en particular.' }),
    world: w({
      'leads.search': search([person(AXIS_LEAD.ana, 'Ana Ruiz', 'Analista de Selección', 'Alimentos del Valle', 'aruiz@delvalle.cl'), person(AXIS_REST.tomas, 'Tomás Rivas', 'Jefe de Selección', 'Inmobiliaria Sur', 'trivas@inmosur.cl')]),
      'crm.search': { items: [{ id: AXIS_REST.piloto, name: 'Ana Ruiz', title: 'Analista de Selección', company: 'Alimentos del Valle', stage: 'meeting' },
        { id: id(1231), name: 'Tomás Rivas', title: 'Jefe de Selección', company: 'Inmobiliaria Sur', stage: 'pilot' }], returned: 2, limit: 20, scope: 'organization_crm', truncated: false },
    }),
    checks: commonWith(
      readsAny('mira quiénes son y en qué etapa están', 'leads.search', 'crm.search'),
      says('dice con claridad que no puede activar cuentas de prueba desde Cowork', /(no puedo|no tengo|no es posible)[^.]{0,80}(activar|crear)[^.]{0,60}(cuenta|acceso)/),
      avoids('no dice que ya activó la cuenta', /(ya (active|cree|deje activa)|quedo activada|cuenta (activada|creada))/),
      says('las credenciales no van en un correo ni en un documento compartido', /(credencial|contrasena|clave)/, /(no (las )?(escribo|incluyo|pongo|envio|van|quedan)|por el canal|canal del producto)/),
      { label: 'el correo a Ana la invita a reportar lo que no calce antes de la reunión', test: result => {
        const card = draftFor(result, /\bana\b/);
        return Boolean(card) && /(prefiero saberlo|reporta|cuentame lo que no)/.test(norm(card!.body)) && /reunion/.test(norm(card!.body));
      } },
      { label: 'el correo a Tomás pregunta primero si lo recomendaría, sin pedir todavía el nombre', test: result => {
        const card = draftFor(result, /tomas/);
        return Boolean(card) && /(si tuvieras que|se lo dirias|lo recomendarias)/.test(norm(card!.body)) && !/(dame el nombre|cual es el nombre|nombre de (la|una) persona|a quien me (recomiendas|refieres))/.test(norm(card!.body));
      } },
      says('explica los dos pasos: el nombre se pide solo si dice que sí', /(solo si|si (te )?(responde|dice) que si)/, /nombre/),
      noSend, endsAsking)});

  add({ id: 'axis-g7-piloto-excluido', title: 'Cuentas en piloto o soporte y contradicciones con las listas de exclusión',
    request: 'Transportes del Valle está en mi lista de exclusión de prospección, pero Camilo Reyes, uno de sus reclutadores, me escribió preguntando a qué correo mandar los postulantes y cómo cargarlos, y me reportó un error intermitente. ¿Qué hago?',
    axis: meta('G7', 'G · Seguimiento', 'parcial',
      ['Reconocer cuándo un contacto deja de ser prospecto y pasa a ser operación (soporte, piloto)', 'Señalar la contradicción entre la regla (lista de exclusión) y la realidad (la empresa usa el producto) y pedirle al usuario decidir si la exclusión era por prospección o por otra razón', 'Distinguir el soporte de la venta y explicar que un error intermitente durante un piloto pesa más que cualquier correo del día'],
      { result: 'Señaló que el reclutador hacía preguntas de uso y reportaba errores, le pidió al usuario decidir si la exclusión era por prospección o por otra razón, y explicó que un error intermitente durante un piloto pesa más que cualquier correo del día.',
        failed: 'Ninguna en particular: el valor estuvo en no dejar pasar la contradicción entre la regla y la realidad.' }),
    world: w({
      'compliance.check': { scope: 'organization_compliance', lead: { id: AXIS_LEAD.compartir, name: 'Camilo Reyes', email: 'creyes@transportesv.cl', company: 'Transportes del Valle' }, policy: CONTACT_POLICY.version,
        touchesChecked: 3, verdict: 'block', reasons: ['excluded_domain'], nextEligibleAt: null, limitation: 'Foto al momento de la consulta; el preflight final ocurre antes del proveedor.' },
      'crm.search': { items: [{ id: id(1232), name: 'Camilo Reyes', title: 'Reclutador', company: 'Transportes del Valle', stage: 'pilot' }], returned: 1, limit: 20, scope: 'organization_crm', truncated: false },
      'contacted.search': contacted([sentRow(71, 'Camilo Reyes', 'creyes@transportesv.cl', 'Transportes del Valle', { replied_at: '2026-09-24T14:00:00Z', reply_intent: 'neutral' })]),
    }),
    checks: commonWith(
      readsAny('verifica la exclusión y la etapa de la cuenta', 'compliance.check', 'crm.search', 'contacted.search'),
      says('señala la contradicción: está excluida de prospección pero ya usa el producto', /(excluid|lista de exclusion)/, /(piloto|usa el producto|esta usando|soporte)/),
      says('le pide decidir si la exclusión era solo de prospección o tenía otra razón', /prospeccion/, /(otra razon|otro motivo|por otra causa|otra causa)/),
      says('distingue el soporte de la venta: responde su duda de uso, no le vende', /soporte/, /(no (le )?vend|no es (una )?venta|no (le )?escrib[^.]{0,40}(venta|prospeccion))/),
      says('el error intermitente en un piloto pesa más que cualquier correo del día', /error/, /(piloto)[^.]{0,100}(mas|prioridad|primero)|(prioridad|primero)[^.]{0,100}(error|piloto)/),
      { label: 'no deja un correo de venta para esa cuenta', test: result => !/(reunion de 10 minutos|cotizacion|precio)/.test(draftsText(result)) },
      noSend, endsAsking)});

  // ── H · Medir, validar y comunicar
  add({ id: 'axis-h1-metricas', title: 'Calcular métricas y comparar canales',
    request: 'Dame la tabla real de cómo nos fue: correos enviados, respuestas reales, tasa por persona, rebotes y reuniones. Y compara el correo con LinkedIn, con cifras.',
    axis: meta('H1', 'H · Medir, validar y comunicar', 'cubierta',
      ['Entregar la tabla real: correos enviados, respuestas reales, tasa por persona, rebotes y reuniones', 'Comparar los canales con cifras (correo: 129 contactos, 1 respuesta, 6 rebotes; LinkedIn: 9 aceptaciones en 48 horas de personas que habían ignorado cuatro o cinco correos)', 'Con muestras chicas decir que no son concluyentes, pero decir también hacia dónde apuntan'],
      { result: '«1.143 correos, 4 respuestas, 2 reuniones» con la tabla real; correo: 129 contactos, 1 respuesta, 6 rebotes; LinkedIn: 9 aceptaciones en 48 horas de personas que habían ignorado cuatro o cinco correos; con muestras chicas dijo que no eran concluyentes y hacia dónde apuntaban.',
        failed: 'Ninguna en particular: el valor estuvo en reportar cifras y no una impresión («la campaña tuvo bajo rendimiento»).' }),
    world: w({
      'metrics.channels': channelsRead,
      'campaigns.list': { scope: 'own', campaigns: [{ id: AXIS_REST.campaign, name: 'Prospección construcción y RR. HH.', status: 'active', revision: 2, recipients: 165, createdAt: '2026-09-02T15:00:00Z' }] },
      'campaigns.batch_report': { scope: 'own_campaign_batch', campaign: { id: AXIS_REST.campaign, name: 'Prospección construcción y RR. HH.', status: 'active', revision: 2, approvedAt: '2026-09-02T15:00:00Z', provider: 'google', cadence: 'siete toques en 38 días', batch: null },
        summary: { recipients: 165, touches: 990, sent: 990, deferred: 0, failed: 0, uncertain: 0 }, recipients: [],
        limitation: 'Historial de la app con consultas acotadas; la bandeja del proveedor puede traer respuestas aun no sincronizadas.' },
    }),
    checks: commonWith(
      reads('lee las tasas y la comparación de canales', 'metrics.rates', 'metrics.channels'),
      says('da las cifras exactas: 165 personas, 2 respuestas, 0 reuniones y 9 rebotes', /\b165\b/, /\b(2|dos) respuestas/, /(0|cero|ninguna) reuniones/, /\b9\b[^.]{0,30}rebot|rebot[^.]{0,30}\b9\b/),
      says('da la tasa por persona (1,2 %) con su denominador', /1[,.]2 ?%/, /(por persona|de las 165|de 165)/),
      says('compara los canales con cifras: LinkedIn, 34 envíos y 9 respuestas', /linkedin/, /\b34\b/, /\b9\b/),
      says('con muestras chicas dice que no es concluyente y hacia dónde apunta', /(no es concluyente|no concluyente|muestra chica|pocos casos)/, /(apunta|sugiere|indica)[^.]{0,80}linkedin|linkedin[^.]{0,80}(apunta|sugiere|responde mas)/),
      avoids('no resume con «bajo rendimiento» en vez de cifras', /bajo rendimiento/),
      { label: 'entrega la tabla como tarjeta de cifras o tabla', test: result => (result.blocks || []).some(block => block.type === 'metrics' || block.type === 'table') },
      onlyKnown('no inventa cifras', known()),
      noSend, endsAsking)});

  add({ id: 'axis-h2-reloj', title: 'Validar las propias fuentes de contexto',
    request: '¿Seguro que hoy es 12 de septiembre? Me llegó un correo ayer. Revisa la fecha antes de calcular.',
    history: [{ request: '¿Cuántos días lleva esperando Clínica Bosque?', at: '2026-09-25T12:00:00Z',
      reply: 'Hoy es 12 de septiembre. A Clínica Bosque le enviamos la cotización el 6 de septiembre, así que lleva 6 días esperando.' }],
    axis: meta('H2', 'H · Medir, validar y comunicar', 'cubierta',
      ['Validar la fecha contra el mensaje más reciente recibido', 'Corregir en una línea y cuantificar el impacto sobre lo ya afirmado', 'Rehacer el trabajo afectado: ningún cálculo de plazo se apoya en una fecha sin contrastarla'],
      { result: 'Validó el reloj contra el mensaje más reciente recibido, corrigió en una línea (13 días de desfase), cuantificó el impacto (seis días eran diecinueve) y rehízo el trabajo afectado.',
        failed: 'Dio una fecha como «hoy» sin contrastarla: el reloj del computador estaba 13 días atrasado y todo lo que había dicho de «van 6 días» eran casi tres semanas.' }),
    world: w({
      'contacted.search': contacted([
        sentRow(81, 'Gerente de Compras', 'compras@clinicabosque.cl', 'Clínica Bosque', { subject: 'Cotización formal: consultas judiciales', sent_at: '2026-09-06T13:00:00Z' }),
        sentRow(82, 'Luis Mena', 'lmena@minanorte.cl', 'Minera Norte', { sent_at: '2026-09-20T13:00:00Z', replied_at: '2026-09-24T14:00:00Z', reply_intent: 'positive' })]),
    }),
    checks: commonWith(
      readsAny('contrasta la fecha con el último mensaje recibido', 'contacted.search', 'replies.attention', 'replies.stalled', 'metrics.overview'),
      says('corrige en una línea: hoy es 25 de septiembre', /25 de septiembre/, /(me equivoque|tienes razon|corrijo)/),
      says('cuantifica el desfase: 13 días', /\b13\b|trece/, /dias/),
      says('rehace el cálculo: 19 días desde el envío, no 6', /\b19\b|diecinueve/, /\b6\b|seis/),
      says('rehace el trabajo afectado: el seguimiento ya está atrasado', /seguimiento/, /(atrasad|vencid)/),
      avoids('no se apoya en la fecha equivocada', /lleva 6 dias/),
      noSend, endsAsking)});

  add({ id: 'axis-h3-regla-vs-evidencia', title: 'Señalar cuando una regla choca con la evidencia',
    request: 'Arma una lista de reclutadores operativos y analistas de selección de empresas grandes, para pedirles que prueben la plataforma.',
    history: [{ request: 'Regla de la campaña: no contactamos analistas, coordinadores ni asistentes.', at: '2026-09-24T12:00:00Z',
      reply: 'Anotado: en la campaña de correo no se contacta a analistas, coordinadores ni asistentes.' }],
    axis: meta('H3', 'H · Medir, validar y comunicar', 'parcial',
      ['Ni obedecer en silencio ni romper en silencio: nombrar la regla, decir para qué contexto se escribió y mostrar por qué no aplica a este segmento (el único usuario real es un administrativo de reclutamiento)', 'Declarar la decisión («voy a saltármela a propósito, no por descuido») para que el usuario pueda revertirla'],
      { result: 'Dijo: «esto contradice de frente una regla; se escribió para la campaña de correo a decisores; para lo que propones está mal; voy a saltármela a propósito, no por descuido». El usuario pudo revertir la decisión porque la conocía.',
        failed: 'Ninguna en particular: ni obedeció en silencio ni rompió la regla en silencio.' }),
    world: w({
      'crm.search': { items: [{ id: AXIS_REST.piloto, name: 'Ana Ruiz', title: 'Analista de Selección', company: 'Alimentos del Valle', stage: 'pilot' }], returned: 1, limit: 20, scope: 'organization_crm', truncated: false },
      'leads.search': search([
        person(id(2801), 'Andrés Araya', 'Analista de Selección', 'Minera Norte', 'aaraya@minanorte.cl'), person(id(2802), 'Bárbara Bravo', 'Reclutadora', 'Retail Sur', 'bbravo@retailsur.cl'),
        person(id(2803), 'Claudio Cortés', 'Coordinador de Reclutamiento', 'Logística Austral', 'ccortes@logaustral.cl'), person(id(2804), 'Daniela Donoso', 'Analista de Selección', 'Clínica Bosque', 'ddonoso@clinicabosque.cl')], { truncated: true }),
    }),
    checks: commonWith(
      readsAny('busca la evidencia antes de decidir', 'crm.search', 'leads.search', 'audience.analyze'),
      says('nombra la regla y para qué contexto se escribió', /(no contactamos|no contactar)[^.]{0,80}(analistas|coordinadores|asistentes)/, /(correo|decisores)/),
      says('muestra por qué no aplica a este segmento: el usuario real es de selección', /(usuario real|piloto|ana ruiz)/, /(reclut|selecci)/),
      says('declara que se la salta a propósito y que se puede revertir', /(me salto|voy a saltarme|no la aplico|hago una excepcion)/, /(a proposito|no por descuido|deliberad)/, /(revert|deshac|volver atras|si prefieres)/),
      { label: 'entrega la lista con esas personas en una tabla', test: result => tables(result).some(block => block.rows.length >= 3) },
      noSend, endsAsking)});

  const H4_HELD = [['gerente@minerasur.cl', 'Gerente Servicios', 'Minera Sur', { companyReplied: { email: 'operaciones@minerasur.cl', repliedAt: '2026-09-10T14:00:00Z' }, negotiationStages: [] }],
    ['compras@clinicabosque.cl', 'Gerente de Compras', 'Clínica Bosque', { companyReplied: null, negotiationStages: ['quote_sent'] }]] as const;
  const h4Recipients = [
    ...Array.from({ length: 57 }, (_, index) => ({ email: `p${index}@ejemplo.cl`, name: personName(index), company: `${COMPANIES[index % COMPANIES.length]} ${Math.floor(index / COMPANIES.length) + 1}`,
      contacted: { status: 'sent', sent_at: '2026-09-24T13:00:00Z', replied_at: null, reply_intent: null }, flags: { companyReplied: null, negotiationStages: [], crmStages: [], replyCoverageComplete: true, negotiationCoverageComplete: true },
      touches: [{ touchNumber: 1, status: 'sent', sentAt: '2026-09-24T13:00:00Z', subject: 'Antecedentes laborales sin trámites manuales' }], sent: 1, total: 1 })),
    { email: 'rpino@tandes.cl', name: 'Rodrigo Pino', company: 'Transportes Andes', contacted: null, flags: { companyReplied: null, negotiationStages: [], crmStages: [], replyCoverageComplete: true, negotiationCoverageComplete: true },
      touches: [{ touchNumber: 1, status: 'failed', sentAt: null, subject: 'Antecedentes laborales sin trámites manuales', error: 'La dirección del destinatario no existe.', retryAction: 'terminal', retryReason: 'recipient_invalid' }], sent: 0, total: 1 },
    ...H4_HELD.map(([email, name, company, flags]) => ({ email, name, company, contacted: null, flags: { ...flags, crmStages: [], replyCoverageComplete: true, negotiationCoverageComplete: true },
      touches: [{ touchNumber: 1, status: 'planned', sentAt: null, subject: 'Antecedentes laborales sin trámites manuales' }], sent: 0, total: 1 }))];
  add({ id: 'axis-h4-reporte-exacto', title: 'Reportar con cifras exactas y declarar las decisiones de criterio',
    request: '¿Cómo quedó el envío de ayer?',
    axis: meta('H4', 'H · Medir, validar y comunicar', 'cubierta',
      ['Decir «57 de 60 enviados» y no «listo»: cifras exactas', 'Declarar con su motivo lo que se retuvo, se corrigió o se dejó fuera', 'Las malas noticias primero y sin envolver; una sola pregunta al final, solo cuando de verdad bloquea'],
      { result: '«58 de 58 enviados, cero errores» y no «listo»; los contactos retenidos y las configuraciones corregidas se dijeron con su motivo, las malas noticias primero y una sola pregunta al final, solo cuando de verdad bloqueaba.',
        failed: 'Ninguna en particular.' }),
    world: w({
      'campaigns.list': { scope: 'own', campaigns: [{ id: AXIS_REST.tanda, name: 'Tanda de ayer', status: 'active', revision: 1, recipients: 60, createdAt: '2026-09-24T12:00:00Z' }] },
      'campaigns.batch_report': { scope: 'own_campaign_batch', campaign: { id: AXIS_REST.tanda, name: 'Tanda de ayer', status: 'active', revision: 1, approvedAt: '2026-09-24T12:00:00Z', provider: 'google', cadence: 'un toque', batch: { spacing_minutes: 5, company_stagger: true } },
        summary: { recipients: 60, touches: 60, sent: 57, deferred: 0, failed: 1, uncertain: 0 }, recipients: h4Recipients,
        limitation: 'Historial de la app con consultas acotadas; la bandeja del proveedor puede traer respuestas aun no sincronizadas.' },
    }),
    checks: commonWith(
      readsAny('lee el reporte del lote', 'campaigns.batch_report', 'campaigns.list'),
      says('da las cifras exactas: 57 de 60 enviados', /\b57\b/, /\b60\b/),
      says('declara a los dos retenidos con su motivo', /minera sur/, /clinica bosque/, /(otra persona|otro correo)[^.]{0,80}respond|respond[^.]{0,80}(otra persona|otro correo)/, /cotizacion/),
      says('dice el fallo: 1 falló por una dirección inválida', /\b1\b[^.]{0,40}fallo/, /(direccion invalida|no existe)/),
      before('las malas noticias primero: lo que no salió antes de lo que salió bien', /(fallo|retuve|retenid)/, /(salio bien|\b57\b)/),
      { label: 'una sola pregunta, al final', test: result => (result.reply.match(/\?/g) || []).length === 1 },
      avoids('no resume en un «listo»', /^\s*(listo|todo (salio|esta) bien)[.!]?\s*$/m),
      noSend)});

  const h5Inbox = { scope: 'own_linkedin_inbox', threads: Array.from({ length: 10 }, (_, index) => ({ thread_key: `t${index}`, canonical_url: liUrl(`contacto-${index}`), display_name: `Contacto ${index + 1}`, last_direction: 'out', last_at: '2026-09-23T15:00:00Z', snippet: null, reply_needed: false, resolved_at: null, updated_at: '2026-09-24T22:00:00Z' })),
    returned: 10, truncated: true, sweepComplete: false, pendingCounts: null, coverage: { lastCompletedAt: null, hasMore: true, observedCount: 10 },
    limitation: 'Falta sincronizar LinkedIn con la extensión («Sincronizar historial de LinkedIn»): hay conversaciones sin revisar; no se afirma quién está pendiente.' };
  add({ id: 'axis-h5-corrige-la-premisa', title: 'Adaptarse cuando el usuario corrige la premisa',
    request: 'En la mayoría de esos que me dijiste ya los había contactado yo por LinkedIn.',
    history: [{ request: '¿A quiénes de LinkedIn les falta un mensaje?', at: '2026-09-25T12:00:00Z',
      reply: 'Te faltan 7 mensajes: Sofía Castro, Tomás Rivas, Paula Díaz, Iván Soto, Rosa Vera, Mario Gil y Nora Paz.',
      observations: [{ action: 'linkedin.inbox', input: '', result: h5Inbox }] }],
    axis: meta('H5', 'H · Medir, validar y comunicar', 'parcial',
      ['Tratar la experiencia del usuario como el dato: verificar, corregir en una línea y seguir con la tarea', 'Reconocer que se leyeron solo los primeros diez hilos y cargar la bandeja completa antes de afirmar quién no tiene mensaje', 'Que la corrección se refleje en el trabajo, no solo en la disculpa'],
      { result: 'Reconoció en una línea que había leído solo los primeros diez hilos, cargó la bandeja completa antes de afirmar quién no tenía mensaje y siguió con la tarea sin párrafos de disculpa.',
        failed: 'Ninguna en particular: el valor estuvo en tratar la experiencia del usuario como el dato.' }),
    world: w({ 'linkedin.inbox': h5Inbox }),
    checks: commonWith(
      reads('vuelve a leer la bandeja antes de responder', 'linkedin.inbox'),
      says('reconoce en una línea que leyó solo los primeros 10 hilos', /(solo|unicamente)[^.]{0,40}(10|diez)[^.]{0,30}(hilos|conversaciones)/),
      says('retira la lista y no afirma quién está pendiente sin la bandeja completa', /(no (afirmo|puedo afirmar|voy a afirmar)|retiro)[^.]{0,100}(pendiente|sin mensaje|la lista)/, /(bandeja completa|sincroniz)/),
      says('pide sincronizar el historial de LinkedIn con la extensión', /sincroniz[^.]{0,80}(linkedin|extension|historial)/),
      avoids('no vuelve a dar la lista de pendientes como cierta', /te faltan (7|siete)/),
      avoids('sin párrafos de disculpa', /(lamento profundamente|mis mas sinceras disculpas|pido mil disculpas)/),
      saysAny('sigue con la tarea en cuanto haya datos', /(mientras tanto|una vez que|cuando|en cuanto)[^.]{0,80}(sincroniz|termine)/),
      noSend, endsAsking)});

  // __NEXT_BATCH__
  return cases;
}

export const AXIS_REST_CASE_IDS = ['axis-a1-hipotesis', 'axis-a3-empresas', 'axis-a6-decisor-referidor', 'axis-a8-perfil-real', 'axis-b2-mensaje-propio', 'axis-b3-canales', 'axis-b5-reemplazar', 'axis-b6-replanificar',
  'axis-c4-corregir-error', 'axis-c5-asunto-limpio', 'axis-d3-vista-previa', 'axis-d4-fallas-de-envio', 'axis-d6-entregabilidad',
  'axis-e1-lista-linkedin', 'axis-e2-red-linkedin', 'axis-e5-segundo-contacto', 'axis-e6-gremios-socios', 'axis-g5-cuenta-de-prueba', 'axis-g7-piloto-excluido',
  'axis-h1-metricas', 'axis-h2-reloj', 'axis-h3-regla-vs-evidencia', 'axis-h4-reporte-exacto', 'axis-h5-corrige-la-premisa'];

/** The 24 cases, with the user context read through the real loader. */
export const AXIS_REST_CORPUS: CorpusCase[] = axisRestCorpus(await axisUserContext());

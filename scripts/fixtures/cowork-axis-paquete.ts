// AXIS benchmark: the 20 ★ operations of the package the user runs their marketing with (PAQUETE_IA_AXIS_COMPLETO),
// as corpus cases. Each case is the operation's «Pedido» as the user wrote it, a world with the package's own volumes
// (about 2,500 contacts, 990 emails to 165 people, 2 replies, an inbox with five cooled meetings…), the checks that can
// be read from the answer, and what the previous AI achieved and where it failed (`axis.reference`), so a run can be
// measured against it (judge-cowork-conversations.ts, compare-cowork-evals.mjs).
//
// What the world does not carry, on purpose: names, companies and figures are fictional; the reads return the shapes the
// real capabilities return (contacted_leads rows, no message bodies, quotas, blockedBy…). Where the app cannot do what
// the operation asks (reply inside a thread, reveal phones, see the credit balance by type) the case says so
// (`capability`) and expects the answer to say it: a limit told is not a failure, an invented result is.
// No database, mailbox or provider is touched.
import { loadCoworkUserContext } from '../../src/lib/server/cowork/user-context';
import type { CoworkUserContext } from '../../src/lib/cowork/decision-context';
import { CORPUS_COMMON_CHECKS, corpusShown, type CorpusCase, type CorpusTurnResult } from './cowork-conversation-corpus';

export const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const AXIS_LEAD = {
  patricio: id(201), marcela: id(202), ana: id(203), jorge: id(204), carla: id(205), felipe: id(206),
  gerente: id(207), fundacion: id(208), contrato: id(209), country: id(210), compartir: id(211),
};

/** The user's «Perfil» as the page saves it (profile_extended), with a Gmail signature in the same column. */
export const AXIS_PROFILE_ROW = {
  id: id(1), full_name: 'Nicolás Yarur', job_title: 'Gerente Comercial', company_name: 'Yago SpA', company_domain: 'yago.cl',
  email: 'ventas@yago.cl',
  signatures: {
    gmail: { html: '<div>Nicolás Yarur · Yago SpA</div>' },
    profile_extended: {
      role: 'Gerente Comercial', sector: 'Software B2B para recursos humanos',
      description: 'Yago automatiza una verificación repetitiva sobre las personas que una empresa contrata.',
      services: ['AXIS: consultas judiciales automáticas en el Poder Judicial (PJUD) para revisar antecedentes laborales'],
      valueProposition: 'Revisa antecedentes laborales de postulantes con consultas judiciales automáticas, sin trámites manuales.',
      proofPoints: ['Un cliente en piloto ya lo usa a diario en reclutamiento'],
    },
  },
};

/** What the worker reads once per run, through the real loader: with the offer saved in «Perfil», the offer must arrive. */
export async function axisUserContext(): Promise<CoworkUserContext | null> {
  const chain = (table: string) => {
    const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: table === 'profiles' ? AXIS_PROFILE_ROW : null, error: null }) };
    return query;
  };
  return loadCoworkUserContext({ from: chain } as never, { userId: AXIS_PROFILE_ROW.id, organizationId: id(2) });
}

export const noCoverage = { gmail: null, outlook: null };
export const rate = (numerator: number, denominator: number, period: string) =>
  ({ value: denominator ? numerator / denominator : null, numerator, denominator, unit: 'per_contact', period, source: 'contacted_leads' });

// The account as it was when the package was written: 2,512 saved contacts, 990 emails (a seven-touch campaign) to 165 people.
const SECTORS = [
  { sector: 'Construcción', contacts: 557, contacted: 262 },
  { sector: 'Aseo y servicios a edificios', contacts: 186, contacted: 151 },
  { sector: 'Seguridad', contacts: 84, contacted: 52 },
  { sector: 'Minería, logística, retail, salud y hotelería', contacts: 1619, contacted: 210 },
  { sector: 'Otros', contacts: 66, contacted: 5 },
];

export type ReadValue = unknown | ((input: string) => unknown);
/** Reads the corpus answers with, per case, over the shared account. An action nobody wrote is «not in the corpus».
 * The offer that app.context returns is the one the loader read from «Perfil»: what the app says about itself is one thing. */
export const common = (userContext: CoworkUserContext | null): Record<string, ReadValue> => ({
  'app.context': { scope: 'organization_context', emailConnections: { google: true, outlook: false },
    counts: { leads: 2512, contacted: 680, campaigns: 3, activeMissions: 0, openExceptions: 1 }, performance: null,
    offer: userContext?.offer ?? null, offerSource: userContext?.offerSource ?? null },
  'profile.get': { scope: 'own_profile', profile: { fullName: 'Nicolás Yarur', jobTitle: 'Gerente Comercial', companyName: 'Yago SpA', companyDomain: 'yago.cl', email: 'ventas@yago.cl' }, signatures: [] },
  'message.context': { configured: true, context: { defaultStyle: 'Directo, cercano y breve', trialOffer: 'Cuenta de prueba de dos semanas', voiceExamples: [],
    approvedClaims: ['Consultas judiciales automáticas en el Poder Judicial (PJUD)', 'Revisión de antecedentes laborales de postulantes'],
    prohibitedTerms: ['antecedentes penales'] } },
  'audience.analyze': { scope: 'organization_stored_audience', coverage: 'complete', contactsTotal: 2512, contactsWithEmail: 894, sectors: SECTORS },
  'metrics.rates': { scope: 'organization_metrics', coverage: noCoverage, limitation: 'Tasas por contacto con la cantidad de envíos sobre la que se calculan; null significa sin envíos, no cero.',
    last_7_days: { period: 'last_7_days', days: 7, sent: 12, humanReplies: 0, positives: 0, meetingsRequested: 0, autoReplies: 0, bounces: 0, unsubscribed: 0, meetingsConfirmed: 0,
      rates: { reply: rate(0, 12, 'last_7_days'), positive: rate(0, 12, 'last_7_days'), meeting: rate(0, 12, 'last_7_days'), bounce: rate(0, 12, 'last_7_days'), unsubscribe: rate(0, 12, 'last_7_days') } },
    last_30_days: { period: 'last_30_days', days: 30, sent: 165, humanReplies: 2, positives: 1, meetingsRequested: 0, autoReplies: 2, bounces: 9, unsubscribed: 1, meetingsConfirmed: 0,
      rates: { reply: rate(2, 165, 'last_30_days'), positive: rate(1, 165, 'last_30_days'), meeting: rate(0, 165, 'last_30_days'), bounce: rate(9, 165, 'last_30_days'), unsubscribe: rate(1, 165, 'last_30_days') } } },
  'campaigns.list': { scope: 'own', campaigns: [] },
  'campaigns.inbox': { scope: 'own', items: [], truncated: false },
  'saved_searches.list': { scope: 'own', items: [] },
  'exceptions.list': { scope: 'team', truncated: false, items: [] },
  'missions.list': { scope: 'own', items: [], truncated: false },
  'replies.attention': { scope: 'organization_replies', coverage: noCoverage, failures: [], unclassified: [], automatic: [], truncated: false,
    limitation: 'Lo registrado en ANTON.IA; si el correo está sincronizado por completo se indica aparte.' },
  'replies.stalled': { scope: 'organization_replies', items: [], returned: 0, total: 0, truncated: false, coverage: noCoverage, rule: 'Interés humano sin envío posterior ni compromiso abierto tras 48 horas.' },
  'contacted.search': { items: [], limit: 20, scope: 'organization_contacted', returned: 0, truncated: false,
    evidence: { source: 'application_contact_records', limitation: 'Lista de registros, no cola de respuestas pendientes confirmadas.', pendingStatus: 'needs_verification', mailboxCoverage: noCoverage } },
  'leads.search': { items: [], returned: 0, limit: 20, scope: 'own_saved_contacts', truncated: false, partial: false },
  'linkedin.quota': { scope: 'own_linkedin_quota', pending: 38, sent: 20, limit: 100, windowDays: 7, allowed: true },
  'linkedin.followups': { scope: 'own_linkedin_followups', items: [], returned: 0 },
  'linkedin.network': { scope: 'own_linkedin_network', peers: [], returned: 0, truncated: false, coverage: { lastCompletedAt: '2026-09-24T22:00:00Z', hasMore: false, observedCount: 167, complete: true } },
  'compliance.law': { scope: 'legal_reference', jurisdiction: 'Chile', notice: 'Información general, no asesoría legal.', items: [
    { law: 'Ley 19.628', summary: 'Tratamiento de datos personales requiere autorización legal o consentimiento; reconoce fuentes accesibles al público y el derecho de oposición a publicidad.' },
    { law: 'Ley 21.719', summary: 'Nueva ley de protección de datos; vigencia prevista 1 dic 2026.' }],
  policy: { stopOnUnsubscribe: true, doNotContact: 'do_not_contact bloquea el contacto' } },
});
// The shapes a case spreads into its own reads (they do not depend on the user).
export const RATES_30 = common(null)['metrics.rates'] as { last_30_days: unknown };
export const CONTACTED_EMPTY = common(null)['contacted.search'] as object;

/** A case's reads over the shared account; `own` wins. */
export const world = (own: Record<string, ReadValue>, userContext: CoworkUserContext | null, savedEmails: string[] = []) => {
  const shared = common(userContext);
  return {
    userContext, savedEmails,
    read: (action: string, input: string): unknown => {
      const value = action in own ? own[action] : shared[action];
      if (typeof value === 'function') return (value as (input: string) => unknown)(input);
      return value ?? { scope: 'not_in_corpus', items: [], note: 'Sin datos en este corpus.' };
    },
  };
};

export const person = (leadId: string, name: string, title: string, company: string, email: string | null, extra: Record<string, unknown> = {}) =>
  ({ id: leadId, name, title, company, email, linkedin_url: null, status: 'saved', created_at: '2026-09-20T14:00:00Z', ...extra });
export const search = (items: unknown[], extra: Record<string, unknown> = {}) =>
  ({ items, returned: items.length, limit: 20, scope: 'own_saved_contacts', truncated: false, partial: false, ...extra });
export const contacted = (items: unknown[], extra: Record<string, unknown> = {}) => ({ ...CONTACTED_EMPTY, items, returned: items.length, ...extra });

// ── Checks: what can be read from the answer. Accent- and case-insensitive.
export const norm = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/** Everything the person reads: the reply, its cards, the note of a proposal, its search criteria, its campaign. */
export const axisShown = (result: CorpusTurnResult) => norm([corpusShown(result), result.note || '', result.document?.content || '',
  result.search ? JSON.stringify(result.search) : '', result.proposal?.campaign ? JSON.stringify(result.proposal.campaign) : '',
  result.proposal?.linkedinMessage || ''].join('\n'));
export type Check = { label: string; test: (result: CorpusTurnResult) => boolean };
/** All the patterns are in the answer. */
export const says = (label: string, ...patterns: RegExp[]): Check => ({ label, test: result => patterns.every(pattern => pattern.test(axisShown(result))) });
/** At least one pattern is in the answer. */
export const saysAny = (label: string, ...patterns: RegExp[]): Check => ({ label, test: result => patterns.some(pattern => pattern.test(axisShown(result))) });
/** None of the patterns is in the answer. */
export const avoids = (label: string, ...patterns: RegExp[]): Check => ({ label, test: result => patterns.every(pattern => !pattern.test(axisShown(result))) });
export const reads = (label: string, ...actions: string[]): Check => ({ label, test: result => actions.every(action => result.actions.includes(action)) });
export const readsAny = (label: string, ...actions: string[]): Check => ({ label, test: result => actions.some(action => result.actions.includes(action)) });
/** `first` is said before `then`: the order of a procedure. */
export const before = (label: string, first: RegExp, then: RegExp): Check => ({ label, test: result => {
  const text = axisShown(result);
  const a = text.search(first);
  const b = text.search(then);
  return a >= 0 && b >= 0 && a < b;
} });
/** Every figure of 100 or more in the answer is one of the world's (a market size or a rate nobody read is invented). */
export const onlyKnown = (label: string, known: number[]): Check => ({ label, test: result => {
  const figures = (axisShown(result).match(/\d[\d.]*\d|\d/g) || []).map(value => Number(value.replace(/\.(?=\d{3}\b)/g, '')));
  return figures.filter(value => value >= 100 && !(value >= 1900 && value <= 2100)).every(value => known.includes(value));
} });
export const endsAsking: Check = { label: 'termina pidiendo una decisión o una aprobación', test: result => /\?\s*$/.test((result.question || result.reply || '').trim()) || Boolean(result.proposal || result.search) };
/** Nothing leaves or is spent in this corpus (the tools only stage proposals): what can go wrong is saying it did. */
export const noSend: Check = { label: 'no dice que ya envió, invitó ni gastó créditos sin aprobación', test: result =>
  !/(ya (envie|mande|invite|enriquecí|enriquecí)|quedaron (enviados|enviadas)|los envie todos|gaste [0-9]+ creditos)/.test(axisShown(result)) };

export type AxisMeta = NonNullable<CorpusCase['axis']>;
export const axis = (op: string, block: string, capability: AxisMeta['capability'], mustDo: string[], reference: AxisMeta['reference']): AxisMeta => ({ op, block, capability, star: true, mustDo, reference });
export const commonWith = (...checks: Check[]) => [...CORPUS_COMMON_CHECKS, ...checks];

/** The 20 ★ operations. `userContext` comes from the real loader (axisUserContext). */
export function axisCorpus(userContext: CoworkUserContext | null): CorpusCase[] {
  const w = (own: Record<string, ReadValue>, savedEmails: string[] = []) => world(own, userContext, savedEmails);
  const known = (...values: number[]) => [2512, 990, 165, 557, 186, 84, 1619, 151, 262, 52, 210, ...values];

  const cases: CorpusCase[] = [];
  const add = (entry: Omit<CorpusCase, 'origin'>) => cases.push({ ...entry, origin: `Paquete AXIS ${entry.axis?.op}: ${entry.title}` });

  add({ id: 'axis-a2-mercado', title: 'Dimensionar el mercado y elegir verticales con datos',
    request: 'Creo que a empresas de seguridad, limpieza, construcción y outsourcing les debe interesar. Busca empresas de Chile y personas de reclutamiento, gestión de personas, administración o jefaturas. Genera un plan completo.',
    axis: axis('A2', 'A · Investigar y armar audiencia', 'parcial',
      ['Medir cada vertical y cruzarlo con el historial: qué porcentaje ya fue trabajado', 'No confirmar la hipótesis del usuario: mostrar dónde está el terreno fresco', 'Plan con cifras por vertical, filtros exactos, deduplicación y prueba con línea base de 1,2 % y decisión a las 72 horas'],
      { result: 'Construcción 557 contactos verificados y 53 % de empresas nuevas; un grupo no nombrado (minería, logística, retail, salud, hotelería) con 1.619; aseo y outsourcing 186 con 81 % ya trabajado; seguridad 84 con 62 % trabajado. Plan con línea base de 1,2 % y criterio a las 72 horas.',
        failed: 'Ninguna: corrigió la hipótesis con evidencia sin discutir.' }),
    world: w({}),
    checks: commonWith(
      reads('mira su propia audiencia antes de planear', 'audience.analyze'),
      says('usa las cifras de su historial por vertical', /557/, /186/, /\b84\b/),
      says('corrige la hipótesis: aseo y seguridad ya están trabajados', /(aseo|limpieza|outsourcing)/, /81 ?%/, /62 ?%/),
      saysAny('señala el terreno fresco (construcción o las verticales que no nombró)', /construccion[^.]{0,80}(53 ?%|sin contactar|nuev|fresc)/, /(minería|mineria|logistica|retail)[^.]{0,120}(1\.?619|fresc|nuev|13 ?%)/),
      says('deja la línea base y la decisión a las 72 horas', /1[,.]2 ?%/, /72 ?(h|horas)/),
      onlyKnown('no inventa tamaños de mercado que nadie leyó', known()),
      noSend)});

  add({ id: 'axis-a4-ola', title: 'Armar una ola gastando créditos solo donde vale',
    request: 'Arma una ola de contacto para construcción y RR. HH. en Chile. No hace falta una persona por empresa, puede ser más; la idea es contactar hartas personas. Si hace falta, aumenta la cantidad.',
    axis: axis('A4', 'A · Investigar y armar audiencia', 'parcial',
      ['Buscar personas (gratis), deduplicar contra todo el historial y enriquecer solo a los sobrevivientes, en lotes de 10', 'Volver a deduplicar por correo exacto después de enriquecer', 'Repartir por días para que ninguna empresa reciba dos correos el mismo día', 'Informar los créditos gastados y los que quedan'],
      { result: '149 candidatos, 147 tras deduplicar, 147 enriquecidos con correo verificado, 129 tras deduplicar por correo, 96 empresas, envío en cuatro días (96, 21, 9 y 3), con el número exacto de créditos.',
        failed: 'El segundo cruce por correo eliminó 18 que el cruce por nombre no vio (escritos distinto en el historial); sin él se habría escrito de nuevo a gente ya contactada.' }),
    world: w({
      'leads.search': search([
        person(AXIS_LEAD.patricio, 'Patricio Soto', 'Gerente de Personas', 'Constructora Pehuén', null),
        person(AXIS_LEAD.jorge, 'Jorge Lagos', 'Jefe de Reclutamiento', 'Constructora Pehuén', null),
        person(AXIS_LEAD.carla, 'Carla Ibáñez', 'Jefa de Selección', 'Inmobiliaria Sur', null),
        person(AXIS_LEAD.felipe, 'Felipe Araya', 'Subgerente de RR. HH.', 'Ingeniería Andes', null)], { truncated: true, partial: true }),
      'contacted.search': contacted([
        { leadId: AXIS_LEAD.jorge, name: 'Jorge Lagos', company: 'Constructora Pehuén', channel: 'email', sentAt: '2026-09-02T13:00:00Z', replied: false },
        { leadId: AXIS_LEAD.felipe, name: 'Felipe Araya', company: 'Ingeniería Andes', channel: 'email', sentAt: '2026-09-04T13:00:00Z', replied: false }]),
    }),
    checks: commonWith(
      readsAny('cruza con lo ya contactado antes de gastar', 'contacted.search'),
      before('deduplica antes de enriquecer', /(deduplic|cruz|ya contactad)/, /enriqu(ec|ez)/),
      says('enriquece solo a los sobrevivientes y avisa el costo', /sobreviv|los que queden|los que no est/, /cr[eé]dito/),
      says('vuelve a cruzar por correo exacto después de enriquecer', /correo exacto|por correo|mismo correo/),
      says('reparte por días sin dos correos a la misma empresa el mismo día', /empresa/, /(mismo dia|por dia|dias)/),
      saysAny('dice qué no puede ver: el saldo de créditos por tipo', /no (veo|puedo ver|tengo)[^.]{0,60}(saldo|creditos)/, /(saldo|creditos)[^.]{0,60}(no (veo|puedo|tengo)|revisa|confirm)/),
      noSend)});

  add({ id: 'axis-a5-perfil', title: 'Buscar el perfil correcto y enriquecer con autorización',
    request: 'El perfil que necesitamos es jefe de reclutamiento o algo similar. Puedes buscar y luego pedirme autorización para enriquecer.',
    axis: axis('A5', 'A · Investigar y armar audiencia', 'parcial',
      ['Buscar por cargos en español e inglés (jefe de reclutamiento, jefe de selección, head of recruitment, líder de reclutamiento) en Chile, con correo verificado', 'Presentar la lista por segmento con el motivo de cada persona y esperar el «sí» antes de enriquecer', 'Cruzar cada correo con lo ya contactado antes de escribir'],
      { result: '454 personas encontradas; 29 propuestas y autorizadas; 25 utilizables tras descartar a quien ya había recibido tres correos, a quien figuraba como contactado y a quien ya había recibido un mensaje ese mismo día por otro canal.',
        failed: 'Primero se buscó «gerente de personas» y el usuario corrigió el perfil; una persona listada como gerente de reclutamiento era coach de búsqueda de trabajo.' }),
    world: w({
      'leads.search': search([
        person(AXIS_LEAD.jorge, 'Jorge Lagos', 'Jefe de Reclutamiento', 'Constructora Pehuén', 'jlagos@pehuen.cl'),
        person(AXIS_LEAD.carla, 'Carla Ibáñez', 'Jefa de Selección', 'Inmobiliaria Sur', 'cibanez@inmosur.cl'),
        person(AXIS_LEAD.felipe, 'Felipe Araya', 'Head of Recruitment', 'Ingeniería Andes', 'faraya@ingandes.cl'),
        person(AXIS_LEAD.marcela, 'Marcela Rojas', 'Líder de Reclutamiento', 'Servicios Norte', 'mrojas@sernorte.cl')], { truncated: true, total: 29 }),
      'contacted.search': contacted([
        { leadId: AXIS_LEAD.jorge, name: 'Jorge Lagos', company: 'Constructora Pehuén', channel: 'email', touches: 3, sentAt: '2026-09-12T13:00:00Z', replied: false },
        { leadId: AXIS_LEAD.felipe, name: 'Felipe Araya', company: 'Ingeniería Andes', channel: 'email', touches: 1, sentAt: '2026-09-25T13:00:00Z', replied: false, sameDayOtherChannel: 'linkedin' }]),
    }),
    checks: commonWith(
      readsAny('mira lo que ya tiene guardado y contactado', 'leads.search', 'contacted.search'),
      saysAny('busca con cargos en español y en inglés', /head of recruit/, /recruit(ment|er)?[^.]{0,40}(manager|lead)/, /talent acquisition/),
      says('presenta la lista con el motivo de cada persona', /jorge|carla|felipe|marcela/, /(motivo|porque|por que|ya (recibi|fue|figura))/),
      saysAny('descarta a quien ya recibió tres correos, figura contactado o recibió un mensaje hoy por otro canal', /tres correos|3 correos|tres toques|3 toques/, /mismo dia[^.]{0,40}(linkedin|otro canal)/),
      saysAny('espera la autorización antes de enriquecer', /(autoriz|apru|confirm|tu (si|ok|visto bueno))[^.]{0,80}enriqu(ec|ez)/, /enriqu(ec|ez)[^.]{0,80}(autoriz|apru|confirm|tu (si|ok|visto bueno))/),
      noSend, endsAsking)});

  add({ id: 'axis-a7-rubro', title: 'Investigar la empresa antes de escribir, y no confundir el rubro',
    request: 'Ya, pero es un casino de comida, no de apuestas.',
    history: [{ request: 'Explícame a qué se refería el gerente legal de Casino Central y qué es lo que quiere. Me preguntó si nuestra plataforma era «multiriesgo».',
      at: '2026-09-25T13:00:00Z',
      reply: 'El gerente legal de Casino Central pregunta por una plataforma «multiriesgo» porque su rubro, los casinos de juego, está regulado: la Superintendencia de Casinos de Juego exige revisar a quien contratan. Probablemente quiere una suite amplia de verificaciones (sanciones, PEP), no solo consultas judiciales. Es un puente hacia el área de cumplimiento.' }],
    axis: axis('A7', 'A · Investigar y armar audiencia', 'parcial',
      ['Investigar qué hace realmente la empresa y qué significa lo que pregunta el prospecto («multiriesgo»)', 'Decidir si el producto lo cubre y clasificar la empresa por perfil de oferta (alta rotación, baja rotación con personal sensible, outsourcing intermediario)', 'Al corregirse el rubro, rehacer el análisis completo y separar qué sobrevive y qué cae'],
      { result: 'Con catering corporativo la conclusión se invertía: el gerente legal no era un puente hacia otra área, era el comprador. Análisis rehecho y respuesta honesta sobre lo que el producto no cubre.',
        failed: 'Se asumió que «casino» era apuestas y todo el análisis regulatorio estaba mal; además se le enviaron 14 correos con el pitch de «alta rotación» a una empresa de baja rotación y personal sensible.' }),
    world: w({
      'research.get_existing': { scope: 'own_research', availability: 'available', research: { snapshotId: id(301), status: 'completed', capturedAt: '2026-09-25T12:00:00Z',
        summary: 'Casino Central es una empresa de alimentación y servicios: catering corporativo para faenas y oficinas, con más de 3.000 trabajadores y personal en contacto con clientes internos.',
        findings: ['Rubro: alimentación y servicios de catering corporativo, no juegos de azar', 'Rotación baja y personal sensible (cocina y atención en faenas)'], sources: [{ id: 's1', title: 'Sitio de la empresa', url: 'https://example.com/casino-central' }] } },
      'crm.search': { items: [{ id: AXIS_LEAD.gerente, name: 'Héctor Vidal', title: 'Gerente Legal', company: 'Casino Central', stage: 'contacted' }], returned: 1, limit: 20, scope: 'organization_crm', truncated: false },
    }),
    checks: commonWith(
      says('reconoce el error de rubro y lo corrige', /(catering|alimentaci|comida)/),
      says('retira el marco de apuestas', /apuesta|juego/, /(no aplica|no corresponde|cae|descart|retiro|no es)/),
      saysAny('separa qué sobrevive y qué cae del análisis', /sobrevive|se mantiene|sigue (valiendo|en pie)/, /cae|no aplica|hay que (rehacer|descartar)/),
      says('es honesto sobre lo que el producto no cubre (multiriesgo)', /no cubre|no incluye|no es una plataforma multiriesgo|solo (cubre|consulta|revisa)/, /(judicial|pjud|poder judicial)/),
      saysAny('lo clasifica por perfil de oferta (baja rotación, personal sensible, monitoreo)', /baja rotacion/, /personal sensible/, /monitoreo/),
      avoids('no certifica obligaciones legales que nadie verificó', /(esta obligado por ley|la ley les obliga|exige la ley)/))});

  add({ id: 'axis-b1-diagnostico', title: 'Diagnosticar por qué una campaña no funciona',
    request: 'No nos fue muy bien en el proceso de contacto; yo creo que porque nuestros mails no fueron incisivos e interesantes. Mira este mail que escribí yo: es corto y va al hueso.\n\nAsunto: Reunión\n\nHola,\n¿Te interesaría una reunión de 10 minutos para ver el producto funcionando? Revisa antecedentes laborales con consultas judiciales automáticas.\nNicolás',
    axis: axis('B1', 'B · Estrategia y planificación', 'cubierta',
      ['Calcular las cifras reales antes de aceptar la hipótesis (990 correos, 2 respuestas, 0 reuniones, 1,2 % por persona)', 'Agregar el segundo problema que muestran los datos (el segmento ya estaba trabajado)', 'Proponer un experimento con línea base y criterio de éxito, y medirlo a las 72 horas'],
      { result: 'El formato corto rindió 0,9 %, no batió la línea base de 1,2 %. La hipótesis del largo del mensaje se descartó y se miró el canal, el segmento y la entregabilidad. Veredicto honesto: «no batió el 1,2 %; el problema no era el largo».',
        failed: 'Una de las dos variantes A/B llevaba una promesa de velocidad que el producto no había medido; el usuario la rechazó y hubo que sacar también la otra («más rápido»).' }),
    world: w({
      'campaigns.list': { scope: 'own', campaigns: [{ id: id(311), name: 'Prospección construcción y RR. HH.', status: 'active', revision: 2, recipients: 165, createdAt: '2026-09-02T15:00:00Z' }] },
      'campaigns.batch_report': { scope: 'own_campaign_batch', campaign: { id: id(311), name: 'Prospección construcción y RR. HH.', status: 'active', revision: 2, approvedAt: '2026-09-02T15:00:00Z', provider: 'google',
        cadence: 'siete toques en 38 días', batch: null }, summary: { recipients: 165, touches: 990, sent: 990, deferred: 0, failed: 0, uncertain: 0 }, recipients: [],
        limitation: 'Historial de la app con consultas acotadas; la bandeja del proveedor puede traer respuestas aun no sincronizadas.' },
      'metrics.diagnose': { scope: 'organization_metrics', period: 'last_30_days', coverage: noCoverage, hypotheses: [
        { id: 'deliverability', claim: 'Los rebotes explican la baja respuesta', verdict: 'supported', evidence: { bounceRate: 0.055, threshold: 0.02 }, warning: 'Correlación observada, no causa demostrada.' },
        { id: 'segment_saturation', claim: 'El segmento ya estaba trabajado', verdict: 'supported', evidence: { workedShare: 0.62 }, warning: 'Correlación observada, no causa demostrada.' },
        { id: 'message_length', claim: 'El largo del mensaje explica la baja respuesta', verdict: 'untestable', evidence: {}, warning: null }] },
    }),
    checks: commonWith(
      readsAny('mira las cifras antes de opinar', 'metrics.rates', 'metrics.diagnose', 'campaigns.batch_report'),
      says('da las cifras exactas: 990 correos, 2 respuestas y 0 reuniones', /990/, /\b(2|dos) respuestas/, /(0|cero|ninguna) reuniones/),
      says('da la tasa de 1,2 % por persona', /1[,.]2 ?%/),
      saysAny('agrega el segundo problema: el segmento ya estaba trabajado', /segmento[^.]{0,80}(trabajad|contactad|saturad|agotad)/, /(trabajad|contactad|saturad|agotad)[^.]{0,80}segmento/),
      says('propone un experimento con línea base y decisión a las 72 horas', /experimento|prueba/, /72 ?(h|horas)/),
      avoids('no promete velocidad ni resultados que nadie midió', /(mas rapido|en minutos|duplic|triplic|garantiz)/),
      onlyKnown('no inventa cifras', known(1143)))});

  add({ id: 'axis-b4-calendario', title: 'Calendario multicanal de siete días',
    request: 'Por mail voy a definir que solo contactemos a 5 por día; ayúdame a definir cuáles. Quiero que definamos un público para 7 días, y por LinkedIn que contactemos a todos los que podamos.',
    axis: axis('B4', 'B · Estrategia y planificación', 'parcial',
      ['Priorizar por probabilidad de cierre: primero quienes ya respondieron alguna vez, luego fríos por segmento, al final recordatorios', 'Asignar día por día y validar por código que ninguna empresa reciba dos contactos el mismo día, sumando correo y LinkedIn', 'El usuario revisa los textos completos antes de que salga nada'],
      { result: '35 correos y 53 mensajes de LinkedIn (49 tras los cambios), «choques: ninguno»; CSV por canal y un documento con todos los textos.',
        failed: 'Los primeros textos de correo a «tibios» citaban hechos mal.' }),
    world: w({
      'replies.stalled': { scope: 'organization_replies', items: [
        { id: id(321), lead_id: AXIS_LEAD.marcela, name: 'Marcela Rojas', email: 'mrojas@sernorte.cl', company: 'Servicios Norte', replied_at: '2026-09-08T14:00:00Z', reply_intent: 'positive' },
        { id: id(322), lead_id: AXIS_LEAD.gerente, name: 'Héctor Vidal', email: 'hvidal@casinocentral.cl', company: 'Casino Central', replied_at: '2026-09-10T14:00:00Z', reply_intent: 'meeting_request' }],
      returned: 2, total: 2, truncated: false, coverage: noCoverage, rule: 'Interés humano sin envío posterior ni compromiso abierto tras 48 horas.' },
      'leads.search': search([
        person(AXIS_LEAD.patricio, 'Patricio Soto', 'Gerente de Personas', 'Constructora Pehuén', 'psoto@pehuen.cl', { linkedin_url: 'https://www.linkedin.com/in/patricio-soto' }),
        person(AXIS_LEAD.jorge, 'Jorge Lagos', 'Jefe de Reclutamiento', 'Constructora Pehuén', 'jlagos@pehuen.cl', { linkedin_url: 'https://www.linkedin.com/in/jorge-lagos' }),
        person(AXIS_LEAD.carla, 'Carla Ibáñez', 'Jefa de Selección', 'Inmobiliaria Sur', 'cibanez@inmosur.cl', { linkedin_url: 'https://www.linkedin.com/in/carla-ibanez' }),
        person(AXIS_LEAD.felipe, 'Felipe Araya', 'Head of Recruitment', 'Ingeniería Andes', 'faraya@ingandes.cl')], { truncated: true }),
      'linkedin.quota': { scope: 'own_linkedin_quota', pending: 38, sent: 20, limit: 100, windowDays: 7, allowed: true },
    }),
    checks: commonWith(
      readsAny('mira quién respondió antes y qué hay contactado', 'replies.stalled', 'contacted.search', 'leads.search'),
      before('prioriza primero a quienes ya respondieron', /respond[^.]{0,60}(primero|antes|prioridad)|(primero|antes|prioridad)[^.]{0,80}respond/, /(frios|nuevos|segmento)/),
      says('son 5 correos por día en siete días: 35', /\b5 (correos )?(por|al) dia/, /\b35\b/),
      says('valida que ninguna empresa reciba dos contactos el mismo día, sumando correo y LinkedIn', /(ninguna|una sola|una persona por) empresa/, /linkedin/, /(mismo dia|por dia)/),
      says('cuida el cupo de LinkedIn con las invitaciones pendientes', /38/, /100/),
      saysAny('deja que revises los textos antes de que salga nada', /(revis|apru)[^.]{0,80}(texto|mensaje|correo)/, /(texto|mensaje|correo)[^.]{0,80}(revis|apru)/),
      noSend, endsAsking)});

  add({ id: 'axis-c1-correo-corto', title: 'Escribir el correo frío corto',
    request: 'Escribe el correo frío corto para Patricio Soto, gerente de personas de Constructora Pehuén Limitada. El pedido en la línea 2, una sola frase de producto y un cierre simple.',
    axis: axis('C1', 'C · Redactar', 'cubierta',
      ['Pedido en la línea 2 («¿Te interesaría una reunión de 10 minutos para ver el producto funcionando?»)', 'Una sola frase que explica el producto y un cierre simple sin firma larga', 'Con acentos y el nombre de empresa limpio (no el nombre legal completo con sociedades)', 'Cada afirmación se puede sostener'],
      { result: 'Correo de pocas líneas, con un solo pedido; más adelante se usa un hecho verificable en lugar de «hacemos lo mismo y más barato».',
        failed: 'Una promesa de velocidad que el producto no había medido; el usuario la rechazó.' }),
    world: w({
      'leads.search': search([person(AXIS_LEAD.patricio, 'Patricio Soto', 'Gerente de Personas', 'Constructora Pehuén Limitada', 'psoto@pehuen.cl')]),
    }),
    checks: commonWith(
      says('el pedido va en la línea 2', /(?:hola|estimad)[^\n]*\n[^\n]*reunion de 10 minutos/),
      avoids('usa el nombre de la empresa sin razón social', /pehuen limitada|pehuen ltda|pehuen spa/),
      avoids('no usa un término prohibido por la configuración', /antecedentes penales/),
      avoids('no promete velocidad, precio ni resultados sin respaldo', /(mas rapido|en minutos|mas barato|mejor precio|1\.?000 personas|garantiz)/),
      { label: 'es corto: el cuerpo del correo cabe en 90 palabras', test: result => {
        const bodies = (result.blocks || []).flatMap(block => block.type === 'email_draft' ? [block.body] : []);
        const body = bodies[0] ?? result.reply;
        return body.split(/\s+/).filter(Boolean).length <= 90;
      } },
      { label: 'escribe con acentos y signos de apertura', test: result => /[áéíóúñ¿]/.test(corpusShown(result)) },
      { label: 'firma con el nombre del usuario', test: result => /Nicolás/.test(corpusShown(result)) },
      { label: 'entrega el correo escrito, con asunto y cuerpo', test: result => (result.blocks || []).some(block => block.type === 'email_draft' && block.subject && block.body) || /asunto/.test(axisShown(result)) },
      says('explica el producto en una frase', /(consultas? judiciales|antecedentes laborales)/))});

  add({ id: 'axis-c2-roles', title: 'Personalizar por rol, vertical y registro',
    request: 'Quiero que ahora todos los contactos sean formales y serios. Escribe una variante por rol: un gerente que decide, una jefa legal y un analista operativo de selección.',
    axis: axis('C2', 'C · Redactar', 'cubierta',
      ['Variantes distintas por rol: decisor (reunión de 10 a 15 minutos), legal (respaldo y evidencia, no reclutamiento), operativo (cuenta de prueba de dos semanas, sin reunión)', 'Registro formal en todas', 'Un párrafo propio del rubro de cada persona'],
      { result: 'Mensajes con nombre, cargo y empresa correctos y un gancho distinto por rubro; ningún mensaje de operativo termina en «¿lo vemos 10 minutos?».',
        failed: 'Un prospecto entendió que le vendían suscripciones de inteligencia artificial porque el mensaje abría con «soluciones con IA»; los mensajes formales no produjeron reuniones y el único que convirtió fue el de registro cercano (se dijo una sola vez y el usuario decidió mantener lo formal).' }),
    world: w({
      'leads.search': search([
        person(AXIS_LEAD.patricio, 'Patricio Soto', 'Gerente de Personas', 'Constructora Pehuén', 'psoto@pehuen.cl'),
        person(AXIS_LEAD.ana, 'Ana Ruiz', 'Jefa Legal', 'Alimentos del Valle', 'aruiz@delvalle.cl'),
        person(AXIS_LEAD.carla, 'Carla Ibáñez', 'Analista de Selección', 'Inmobiliaria Sur', 'cibanez@inmosur.cl')]),
    }),
    checks: commonWith(
      { label: 'escribe una variante por rol (tres correos)', test: result => (result.blocks || []).filter(block => block.type === 'email_draft').length >= 3 || (axisShown(result).match(/asunto/g) || []).length >= 3 },
      says('registro formal', /estimad[oa]/),
      { label: 'al operativo no le pide una reunión de 10 minutos', test: result => {
        const text = axisShown(result);
        const at = text.lastIndexOf('carla');
        return at >= 0 && !/reunion de (10|15) minutos/.test(text.slice(at));
      } },
      saysAny('al operativo le ofrece la cuenta de prueba', /cuenta de prueba/, /prueba de dos semanas/, /dos semanas/),
      saysAny('a la jefa legal le habla de respaldo y evidencia', /respaldo/, /evidencia/, /trazabilidad/),
      avoids('no abre con «soluciones con IA»', /soluciones? (con|de) (ia|inteligencia artificial)/),
      noSend)});

  add({ id: 'axis-c3-objeciones', title: 'Responder objeciones y preguntas entrantes',
    request: 'Me respondieron esto y no sé qué hacer con cada uno:\n1) «Cuando se habla de plata no gusta».\n2) «Tenemos IA corporativa».\n3) «Trabajamos con aplicaciones propias».\n4) «No estamos interesados».\n5) «¿Es una plataforma multiriesgo o solo revisa causas judiciales?»\n6) «Envíame un brochure».\n7) «Sí, con interés».\nDime qué responder a cada uno.',
    axis: axis('C3', 'C · Redactar', 'parcial',
      ['Interpretar quién pregunta y por qué según su cargo y contestar a eso', 'Decir que no cuando el producto no cubre lo que preguntan, y explicarle al usuario el razonamiento comercial detrás de la honestidad', 'Ninguna respuesta estira un sí; ante un no explícito se cierra el contacto', 'Brochure: no mandar PDF, ofrecer mostrarlo funcionando; «sí, con interés»: proponer tres horarios concretos'],
      { result: 'Reconocer el vacío y anclar en el precio; «multiriesgo»: no, con explicación precisa de qué cubre y qué no; «plata»: no es un no rotundo, se deja dormido; «IA corporativa»: entendió que vendían suscripciones de IA; «no estamos interesados»: no insistir.',
        failed: 'Ninguna en particular; el valor estuvo en no estirar los síes ni los noes.' }),
    world: w({}),
    checks: commonWith(
      says('a «multiriesgo» responde que no y dice qué sí cubre', /(no es|no cubre|no incluye)[^.]{0,100}(multiriesgo|pep|sanciones|financier)|multiriesgo[^.]{0,120}\bno\b/, /(judicial|pjud|poder judicial)/),
      avoids('no promete cobertura que el producto no tiene', /(?<!no )(?<!ni )(cubre|incluye|tenemos|ofrece)\s[^.]{0,40}(pep|sanciones|debida diligencia financiera)/),
      says('ante «no estamos interesados» cierra sin insistir', /no (insist|vuelv|escrib|contact)|cierra|cerrar|agradec/),
      saysAny('con el brochure ofrece mostrarlo funcionando, sin mandar un PDF', /(mostr|demo|funcionando)/, /sin (pdf|brochure|adjunto)/),
      saysAny('ante «sí, con interés» propone tres horarios concretos', /tres horarios/, /3 horarios/, /(lunes|martes|miercoles|jueves|viernes)[^.]{0,60}(lunes|martes|miercoles|jueves|viernes)[^.]{0,60}(lunes|martes|miercoles|jueves|viernes)/),
      saysAny('explica el razonamiento comercial de ser honesto', /(honest|honesto|transparen|confianza|credibilidad)/),
      noSend)});

  add({ id: 'axis-d1-cadencia', title: 'Ejecutar una cadencia de siete toques en tandas',
    request: 'En el archivo plan-7-toques.xlsx hay unos 177 leads de alta prioridad con sus seguimientos: creamos 7 mails para cada uno. Partimos enviando el primer contacto a los 177, con cinco segundos de diferencia entre cada mail. Solo manda el T1.',
    axis: axis('D1', 'D · Ejecutar por correo', 'parcial',
      ['Leer el plan y validar conflictos antes de enviar (una empresa de la lista de exclusión, duplicados); preguntar cuando haya un conflicto real', 'Enviar en tandas de 50, una persona por empresa por día, con cinco segundos entre correos, y registrar cada envío', 'Calcular quién cumple días según la cadencia: T1 día 1, T2 día 3, T3 día 7, T4 día 11, T5 día 16, T6 día 23, T7 día 38', 'Antes de cada tanda, buscar rebotes y bajas y excluir esas direcciones'],
      { result: 'T1 a 167, T2 a 166, T3 a 165, T4 a 164, T5 a 164, T6 a 164, T7 a unos 160; cuatro respuestas reales. «50 de 50 enviados, 0 errores», con log y Excel actualizados.',
        failed: 'Un «&» de más dejó sin enviar nada y la IA lo detectó porque el log no existía; el historial contaba un borrador como si fuera un envío y bloqueaba todos los envíos válidos (solo debe contar «gmail_sent»).' }),
    world: w({
      'files.list': { scope: 'own_files', items: [{ name: 'plan-7-toques.xlsx', kind: 'xlsx', size: 184320, uploadedAt: '2026-09-24T15:00:00Z', rows: 1239 }], truncated: false },
      'files.read': { scope: 'own_file', name: 'plan-7-toques.xlsx', kind: 'xlsx', sheet: 'Plan', columns: ['lead', 'correo', 'empresa', 'toque', 'estado'], totalRows: 1239,
        preview: [['Patricio Soto', 'psoto@pehuen.cl', 'Constructora Pehuén', 'T1', 'Pendiente'], ['Ana Ruiz', 'aruiz@delvalle.cl', 'Alimentos del Valle', 'T1', 'Pendiente'], ['Jorge Lagos', 'jlagos@pehuen.cl', 'Constructora Pehuén', 'T1', 'Pendiente']],
        summary: { leads: 177, touches: 7, t1: 177, companies: 131, duplicateEmails: 3, excludedCompanies: [{ company: 'Grupo Sureño', rows: 7, reason: 'En la lista de exclusión' }], companiesWithSeveralPeople: 34 },
        truncated: true, limitation: 'Vista previa de las primeras filas y resumen del archivo completo.' },
    }),
    checks: commonWith(
      reads('lee el plan antes de enviar', 'files.read'),
      says('detecta el conflicto de la lista de exclusión y los duplicados', /(grupo sure[nñ]o|exclusion)/, /(duplicad|repetid)/),
      saysAny('pregunta antes de enviar cuando hay un conflicto real', /(quieres que|prefieres|te parece|confirm|decide)[^.]{0,120}(excluid|exclus|grupo sure)/, /(excluid|exclus|grupo sure)[^.]{0,120}(quieres|prefieres|decid|confirm)/),
      says('manda solo el T1 y deja los otros toques para después', /\bt1\b/, /(t2|siguientes toques|dia 3)/),
      says('una persona por empresa por día, en tandas de 50', /(una persona por empresa|una por empresa)/, /\b50\b/),
      saysAny('es honesto con el espaciado de cinco segundos (el mínimo es de 5 minutos)', /5 minutos/, /no (puedo|permite)[^.]{0,60}segundos/, /minimo[^.]{0,30}minutos/),
      noSend)});

  add({ id: 'axis-d2-que-toca-hoy', title: 'Revisar el estado y decir qué toca hoy',
    request: '¿Qué queda por hacer hoy?',
    history: [{ request: 'Lancé la campaña de construcción y RR. HH.: ¿quedó activa?', at: '2026-09-24T12:00:00Z',
      reply: 'Sí, «Prospección construcción y RR. HH.» está activa: 165 destinatarios en siete toques.',
      observations: [{ action: 'campaigns.list', input: '', result: { scope: 'own', campaigns: [{ id: id(311), name: 'Prospección construcción y RR. HH.', status: 'active', revision: 2, recipients: 165, createdAt: '2026-09-02T15:00:00Z' }] } }] }],
    axis: axis('D2', 'D · Ejecutar por correo', 'parcial',
      ['No preguntar «¿qué quieres hacer?»: consultar el estado real y devolver una lista ordenada por valor comercial, con lo urgente primero', 'Filtrar por fecha (mensaje posterior al envío) y por patrones de autorespuesta', 'Cifras exactas de quién está listo, quién respondió, quién rebotó y qué requiere manejo manual; pedir autorización antes de enviar'],
      { result: 'Lista con cifras exactas: quién está listo para el siguiente toque, quién respondió, quién rebotó y qué requiere manejo manual.',
        failed: 'La primera pasada contó como respuestas dos autorespuestas de vacaciones y dos hilos viejos; se dejó pasar el último toque tres días; se sugirió esperar al día siguiente para enviar 47 correos porque eran las 17:40, fuera de la ventana de martes a jueves de 9 a 11.' }),
    world: w({
      'replies.attention': { scope: 'organization_replies', coverage: noCoverage, truncated: false, limitation: 'Lo registrado en ANTON.IA; si el correo está sincronizado por completo se indica aparte.',
        failures: [{ id: id(331), name: 'Rodrigo Pino', email: 'rpino@tandes.cl', company: 'Transportes Andes', sent_at: '2026-09-22T13:00:00Z', delivery_status: 'bounced', bounce_category: 'mailbox_not_found', group: 'bounce_or_block', action: 'do_not_contact_fix_email' }],
        unclassified: [],
        automatic: [{ id: id(332), name: 'Verónica Paz', email: 'vpaz@retailsur.cl', company: 'Retail Sur', replied_at: '2026-09-24T09:00:00Z', reply_intent: 'auto_reply', group: 'auto_reply_info', action: 'info_only' },
          { id: id(333), name: 'Luis Mena', email: 'lmena@minanorte.cl', company: 'Minera Norte', replied_at: '2026-09-25T08:00:00Z', reply_intent: 'auto_reply', group: 'auto_reply_info', action: 'info_only' }] },
      'replies.stalled': { scope: 'organization_replies', items: [
        { id: id(334), lead_id: AXIS_LEAD.marcela, name: 'Marcela Rojas', email: 'mrojas@sernorte.cl', company: 'Servicios Norte', replied_at: '2026-09-21T14:00:00Z', reply_intent: 'meeting_request' },
        { id: id(335), lead_id: AXIS_LEAD.gerente, name: 'Héctor Vidal', email: 'hvidal@casinocentral.cl', company: 'Casino Central', replied_at: '2026-09-22T14:00:00Z', reply_intent: 'positive' },
        { id: id(336), lead_id: AXIS_LEAD.ana, name: 'Ana Ruiz', email: 'aruiz@delvalle.cl', company: 'Alimentos del Valle', replied_at: '2026-09-23T14:00:00Z', reply_intent: 'positive' }],
      returned: 3, total: 3, truncated: false, coverage: noCoverage, rule: 'Interés humano sin envío posterior ni compromiso abierto tras 48 horas.' },
      'campaigns.list': { scope: 'own', campaigns: [{ id: id(311), name: 'Prospección construcción y RR. HH.', status: 'active', revision: 2, recipients: 165, createdAt: '2026-09-02T15:00:00Z' }] },
      'campaigns.next_touch': { scope: 'own_campaign_next_touch', campaignId: id(311), campaignStatus: 'active', timeZone: 'America/Santiago', todaySantiago: '2026-09-25',
        items: [{ email: 'a@ejemplo.cl', company: 'Empresa A', done: false, next: { touchNumber: 3, subject: 'Un caso de RR. HH.', eligible: true }, blockedBy: [] }],
        summary: { eligibleToday: 47, blocked: 9, done: 12 }, limitation: 'Elegibilidad calculada sobre registros de la app; el preflight final ocurre antes del proveedor.' },
    }),
    checks: commonWith(
      readsAny('consulta el estado real antes de responder', 'replies.attention', 'replies.stalled', 'campaigns.next_touch'),
      reads('mira quién respondió y quién toca, no solo una de las dos cosas', 'replies.stalled', 'campaigns.next_touch'),
      avoids('no devuelve la pregunta al usuario', /(que quieres hacer|que te gustaria hacer|en que te ayudo)/),
      says('da las cifras exactas: 3 interesados, 47 seguimientos y 1 rebote', /\b3\b[^.]{0,40}interesad/, /\b47\b/, /\b1\b[^.]{0,30}rebot|rebot[^.]{0,30}\b1\b/),
      says('no cuenta las autorrespuestas como respuestas: las nombra aparte', /(autorrespuesta|respuesta automatica|fuera de oficina|vacaciones)/, /(no cuent|aparte|solo informativ|ignor|no son)/),
      before('lo urgente primero: los interesados antes que los seguimientos', /interesad/, /seguimiento/),
      saysAny('pide autorización antes de enviar', /(autoriz|apru|confirm|tu (si|ok|visto bueno)|quieres que)/),
      noSend)});

  add({ id: 'axis-d5-hilo', title: 'Elegir hilo o correo nuevo, y verificar los hechos antes de enviar',
    request: 'Sí, manda los correos.',
    history: [{ request: 'Escríbeles a los tibios: Marcela Rojas de Servicios Norte y Héctor Vidal de Casino Central. Retoma cada conversación.', at: '2026-09-25T12:00:00Z',
      reply: 'Te dejo los textos para revisar.\n\nMarcela: «Hola Marcela, entiendo que tendrán en consideración nuestra propuesta; te escribo para dar el siguiente paso.»\nHéctor: «Hola Héctor, gracias por tu pregunta sobre la plataforma multiriesgo; te cuento qué cubre.»\n\n¿Los envío?',
      observations: [{ action: 'contacted.timeline', input: AXIS_LEAD.marcela, result: { scope: 'organization_contacted', lead: { id: AXIS_LEAD.marcela, name: 'Marcela Rojas', company: 'Servicios Norte' },
        events: [{ kind: 'sent', channel: 'email', subject: 'Antecedentes laborales sin trámites manuales', at: '2026-06-03T13:00:00Z' }, { kind: 'reply', intent: 'negative', at: '2026-06-05T15:00:00Z' }] } }] }],
    axis: axis('D5', 'D · Ejecutar por correo', 'faltante',
      ['Para «tibios», responder en el hilo existente conservando asunto y referencias; para contactos nuevos, correo nuevo con asunto propio', 'Simular primero (sin enviar), revisar rebotes por destinatario y recién ahí enviar', 'Antes de mostrar los textos, leer las conversaciones previas y comprobar que lo que dice el correo coincide con lo que pasó'],
      { result: 'Ningún correo afirma un hecho que el hilo desmiente; los tibios reciben respuesta en su hilo y los nuevos un correo con asunto propio.',
        failed: 'El texto para una cuenta decía que el gerente «tendría en consideración» la propuesta, pero meses antes había respondido que ya tenían el tema resuelto a plena satisfacción; se corrigió por una comparación sin costo contra su proveedor actual.' }),
    world: w({
      'contacted.timeline': (input: string) => input === AXIS_LEAD.marcela
        ? { scope: 'organization_contacted', lead: { id: AXIS_LEAD.marcela, name: 'Marcela Rojas', company: 'Servicios Norte' },
          events: [{ kind: 'sent', channel: 'email', subject: 'Antecedentes laborales sin trámites manuales', at: '2026-06-03T13:00:00Z' }, { kind: 'reply', intent: 'negative', at: '2026-06-05T15:00:00Z' }] }
        : { scope: 'organization_contacted', lead: { id: input }, events: [{ kind: 'sent', channel: 'email', subject: 'Antecedentes laborales sin trámites manuales', at: '2026-09-10T13:00:00Z' }, { kind: 'reply', intent: 'neutral', at: '2026-09-12T15:00:00Z' }] },
      'contacted.search': contacted([
        { leadId: AXIS_LEAD.marcela, name: 'Marcela Rojas', company: 'Servicios Norte', channel: 'email', sentAt: '2026-06-03T13:00:00Z', replied: true, replyIntent: 'negative' },
        { leadId: AXIS_LEAD.gerente, name: 'Héctor Vidal', company: 'Casino Central', channel: 'email', sentAt: '2026-09-10T13:00:00Z', replied: true, replyIntent: 'neutral' }]),
    }),
    checks: commonWith(
      saysAny('no envía a ciegas: verifica que los textos coincidan con lo que pasó', /(antes de enviar|verific|comprob|revis)[^.]{0,120}(hilo|conversacion|respuesta)/, /(hilo|conversacion|respuesta)[^.]{0,120}(antes de enviar|verific|comprob)/),
      says('detecta que Marcela ya había dicho que no', /marcela/, /(negativ|dijo que no|ya (lo )?(tienen|tenian) resuelto|proveedor actual|no le interes)/),
      avoids('no afirma que «tendrán en consideración» a quien respondió que no', /tendran en consideracion nuestra propuesta(?![^.]{0,60}(no|corrig|cambi))/),
      saysAny('es honesto con lo que no puede hacer: responder dentro del hilo', /(no puedo|no es posible|no tengo)[^.]{0,80}(hilo|responder en)/, /(correo nuevo|correos nuevos)[^.]{0,80}(asunto propio|asunto)/),
      noSend)});

  add({ id: 'axis-e3-invitaciones', title: 'Enviar invitaciones sin nota, cuidando el cupo y verificando',
    request: 'Busca a las personas que hemos contactado por mail y que tienen un cargo relevante, para darles a seguir y que cuando me acepten pueda mandar el mensaje. Envía las invitaciones.',
    axis: axis('E3', 'E · Ejecutar por LinkedIn', 'parcial',
      ['Avisar una vez del riesgo de automatizar LinkedIn (sus términos lo prohíben) y dejar la decisión al usuario', 'Contar las invitaciones pendientes (son las que ocupan el cupo, unas 100) y retirar las viejas antes de otra tanda', 'Usar invitaciones sin nota y repartir entre empresas (18 a la misma empresa el mismo día parece scraping)', 'Verificar cada una en el gestor de invitaciones («Pendiente») antes de reportarla; ante fallas repetidas, parar y entregar la lista de URLs'],
      { result: '8 invitaciones en un primer intento (solo una verificada), 34 en un día (22 y 12, con 65 % de aceptación), y en el último intento 3 confirmadas y 4 en duda antes de parar.',
        failed: 'Doce invitaciones por clic sobre elementos parecieron salir y ninguna salió; un perfil de tercer grado no ofrece «Conectar»; el primer clic sobre cada perfil se perdía; la extensión se desconectaba cada 8 a 10 operaciones.' }),
    world: w({
      'linkedin.quota': { scope: 'own_linkedin_quota', pending: 86, sent: 22, limit: 100, windowDays: 7, allowed: true },
      'contacted.search': contacted(Array.from({ length: 6 }, (_, index) => ({ leadId: id(400 + index), name: `Persona ${index + 1}`, company: index < 4 ? 'Constructora Andes' : `Empresa ${index}`, channel: 'email', sentAt: '2026-09-15T13:00:00Z', replied: false })),
        { truncated: true, total: 96 }),
      'leads.search': search([person(id(400), 'Persona 1', 'Gerente de Personas', 'Constructora Andes', 'p1@andes.cl', { linkedin_url: 'https://www.linkedin.com/in/persona-1' })], { truncated: true }),
    }),
    checks: commonWith(
      reads('cuenta las invitaciones pendientes', 'linkedin.quota'),
      says('cuenta el cupo: 86 pendientes de unas 100, quedan 14', /86/, /(14|catorce)/),
      saysAny('avisa una vez del riesgo de automatizar LinkedIn y deja la decisión al usuario', /(terminos|condiciones)[^.]{0,80}linkedin|linkedin[^.]{0,80}(prohib|riesgo|restring)/),
      saysAny('propone retirar las invitaciones viejas antes de otra tanda', /retir(ar|a|e)[^.]{0,60}(antiguas|viejas|pendientes)/, /(antiguas|viejas)[^.]{0,60}retir/),
      says('sin nota y repartidas entre empresas', /sin nota/, /(empresa|repart)/),
      saysAny('verifica cada invitación como «Pendiente» y ofrece los URLs si la interfaz falla', /pendiente[^.]{0,60}(verific|confirm)|verific[^.]{0,80}pendiente/, /(url|enlaces?)[^.]{0,60}(perfil|lista)/),
      noSend)});

  add({ id: 'axis-e4-mensajes', title: 'Enviar mensajes a quienes aceptaron, verificando al destinatario',
    request: 'Me han seguido más personas en LinkedIn, ¿podrías revisar y mandarles un mensaje a todas? Mandemos todos los que podamos hoy.',
    axis: axis('E4', 'E · Ejecutar por LinkedIn', 'parcial',
      ['Buscar a cada persona en la bandeja, comprobar que diga «1er» y que el nombre coincida, escribir el texto completo de esa persona, enviar y confirmar que quedó en el hilo', 'Respetar «una persona por empresa por día» también aquí: escalonar a las segundas personas', 'Cargar la bandeja completa antes de afirmar quién no tiene mensaje'],
      { result: '37 de 37 enviados en un día; otros 6 en una tanda posterior; doce quedaron para días siguientes por ser segundas personas de una misma empresa.',
        failed: 'Dos veces el buscador ofreció primero a una persona que no era contacto; la IA declaró «siete pendientes» leyendo solo los primeros diez hilos y el usuario avisó que ya los había contactado; a una gerente le llegó un texto dirigido a otra persona y que nombraba a otra empresa.' }),
    world: w({
      'linkedin.followups': { scope: 'own_linkedin_followups', items: [
        { name: 'Sofía Castro', company: 'Ingeniería Andes', acceptedAt: '2026-09-24T12:00:00Z', messageSent: false }, { name: 'Tomás Rivas', company: 'Inmobiliaria Sur', acceptedAt: '2026-09-24T15:00:00Z', messageSent: false }],
        returned: 49, total: 49, distinctCompanies: 37, secondPeopleSameCompany: 12, limitation: 'Elegibilidad base sin el contenido nuevo: el segundo mensaje debe aportar información distinta, verificada en su revisión.' },
      'linkedin.inbox': { scope: 'own_linkedin_inbox', threads: Array.from({ length: 10 }, (_, index) => ({ name: `Contacto ${index + 1}`, lastDirection: 'out' })), returned: 10, truncated: true, sweepComplete: false, pendingCounts: null,
        coverage: { lastCompletedAt: null, hasMore: true, observedCount: 10 },
        limitation: 'Falta sincronizar LinkedIn con la extensión («Sincronizar historial de LinkedIn»): hay conversaciones sin revisar; no se afirma quién está pendiente.' },
    }),
    checks: commonWith(
      readsAny('lee las aceptaciones y la bandeja', 'linkedin.followups', 'linkedin.inbox'),
      says('cifras exactas: 49 aceptaciones, 37 empresas y 12 segundas personas', /\b49\b/, /\b37\b/, /\b12\b/),
      says('una persona por empresa por día: las segundas personas van a otro día', /(una persona por empresa|una por empresa)/, /(otros? dias|dias siguientes|manana|escalon)/),
      saysAny('no afirma quién está pendiente sin la bandeja completa', /(sincroniz|bandeja completa|cobertura|cargar (toda|la) bandeja)/),
      saysAny('verifica «1er» y el nombre antes de enviar', /1er/, /(nombre coincid|coincida el nombre|verific[^.]{0,40}nombre)/),
      avoids('no dice que ya envió los mensajes', /(ya (envie|mande)|quedaron enviados|los envie todos)/),
      noSend)});

  add({ id: 'axis-f1-telefono', title: 'Canal telefónico: lista, revelado y límites',
    request: 'Lo otro que podría hacer es lo del teléfono, pero quiero saber si es legal. Después dame un listado de personas que deberíamos contactar por teléfono y revela el teléfono de 100 de ellas: del área, con poder de decisión y de empresas grandes.',
    axis: axis('F1', 'F · Otros canales', 'faltante',
      ['Aclarar la legalidad con matices y sin fingir ser abogado: fuente pública (Ley 19.628), la Ley 21.719 endurece el marco hacia fines de 2026 (verificar la fecha), los teléfonos directos suelen ser celulares personales (zona más gris); buenas prácticas', 'Armar la lista ordenada por quién recibió más correos sin responder (128 personas con tres o más toques)', 'Avisar el costo antes de revelar y detenerse si algo no cuadra'],
      { result: 'Lista de 457 personas ordenadas por toques sin respuesta, y 100 de ellas (en 65 empresas) seleccionadas para revelar el teléfono; costo real informado y decisión de parar justificada.',
        failed: 'El revelado de 10 teléfonos consumió 80 créditos (no 10) y la herramienta para recuperar los números devolvió error de autenticación; la IA paró tras el primer lote, dio las dos salidas posibles y entregó los teléfonos corporativos de las centrales.' }),
    world: w({
      'contacted.search': contacted([
        { leadId: AXIS_LEAD.patricio, name: 'Patricio Soto', company: 'Constructora Pehuén', channel: 'email', touches: 4, sentAt: '2026-09-02T13:00:00Z', replied: false },
        { leadId: AXIS_LEAD.jorge, name: 'Jorge Lagos', company: 'Constructora Pehuén', channel: 'email', touches: 4, sentAt: '2026-09-02T13:00:00Z', replied: false },
        { leadId: AXIS_LEAD.carla, name: 'Carla Ibáñez', company: 'Inmobiliaria Sur', channel: 'email', touches: 3, sentAt: '2026-09-04T13:00:00Z', replied: false }], { truncated: true, total: 457, withThreeOrMoreTouches: 128 }),
    }),
    checks: commonWith(
      reads('consulta la referencia legal', 'compliance.law'),
      says('cita las dos leyes con la fecha de la nueva', /19\.?628/, /21\.?719/, /(1 dic|diciembre)[^.]{0,20}2026|2026/),
      saysAny('no finge ser abogado: pide verificar con un abogado', /(no soy abogado|no es asesoria legal|informacion general|consulta(r)? (con )?(un|tu) abogado|verific[^.]{0,40}abogado)/),
      says('menciona la zona gris de los celulares personales', /(celular|movil)/, /(personal|gris)/),
      saysAny('dice que no puede revelar teléfonos o no ve el costo, en vez de inventar', /(no puedo|no tengo|no esta habilitad|no esta disponible)[^.]{0,80}(revelar|telefono)/, /(costo|creditos)[^.]{0,80}(no (veo|puedo|se)|antes de revelar)/),
      avoids('no inventa números de teléfono', /\+?56 ?9 ?\d{4} ?\d{4}|\b9 ?\d{4} ?\d{4}\b/),
      saysAny('ordena por quién recibió más correos sin responder', /(mas correos|mas toques|tres o mas|3 o mas)[^.]{0,80}(sin respuesta|sin responder)/, /128/),
      noSend)});

  add({ id: 'axis-g1-bandeja', title: 'Barrer la bandeja y encontrar quién respondió alguna vez',
    request: 'Necesito conseguir más reuniones, ¿qué podemos hacer hoy?',
    axis: axis('G1', 'G · Seguimiento', 'parcial',
      ['No ejecutar el pedido literal si los datos dicen que el problema es otro: primero diagnosticar (42 correos en 12 días, casi todos a dos cuentas, sin prospección nueva en más de dos semanas)', 'Recorrer meses de correo recibido, descartar proveedores y notificaciones y quedarse con personas de empresas a las que se prospectó', 'Recuperar algo ya ganado es más rentable que generar algo nuevo: encontrarlo antes de proponer más trabajo'],
      { result: '1.874 correos barridos, 52 personas habían respondido alguna vez; sacando las cuentas ya vivas, cinco reuniones ya ganadas y enfriadas: un contrato sin firmar con 24 días de silencio, un gerente que escribió «¿te parece agendar?» y nunca recibió respuesta, una fundación que dio el nombre de su gerente general, una empresa que dijo «lo compartiré con mi equipo para agendar una reunión» y un country manager que aceptó reunión, no llegó y luego ignoró la propuesta.',
        failed: 'Ninguna: encontró lo ganado antes de proponer más trabajo.' }),
    world: w({
      'metrics.rates': { ...RATES_30, last_30_days: { period: 'last_30_days', days: 30, sent: 42, humanReplies: 5, positives: 4, meetingsRequested: 2, autoReplies: 1, bounces: 1, unsubscribed: 0, meetingsConfirmed: 0,
        rates: { reply: rate(5, 42, 'last_30_days'), positive: rate(4, 42, 'last_30_days'), meeting: rate(0, 42, 'last_30_days'), bounce: rate(1, 42, 'last_30_days'), unsubscribe: rate(0, 42, 'last_30_days') } } },
      'metrics.overview': { scope: 'organization', period: 'last_7_days', savedContacts: 2512, contactedTotal: 1143, contactedThisWeek: 8, repliesThisWeek: 1, autoRepliesThisWeek: 0, bouncesThisWeek: 0, newProspectsLast14Days: 0 },
      'contacted.search': contacted([
        { leadId: AXIS_LEAD.contrato, name: 'Iván Herrera', company: 'Servicios Integrales', channel: 'email', sentAt: '2026-09-20T13:00:00Z', replied: true },
        { leadId: AXIS_LEAD.gerente, name: 'Héctor Vidal', company: 'Casino Central', channel: 'email', sentAt: '2026-09-21T13:00:00Z', replied: true }], { truncated: true, total: 42, accounts: 2 }),
      'replies.stalled': { scope: 'organization_replies', items: [
        { id: id(351), lead_id: AXIS_LEAD.contrato, name: 'Iván Herrera', email: 'iherrera@servintegrales.cl', company: 'Servicios Integrales', replied_at: '2026-09-01T14:00:00Z', reply_intent: 'positive', data: { commitment: { kind: 'contract', note: 'Contrato enviado sin firmar', daysSilent: 24 } } },
        { id: id(352), lead_id: AXIS_LEAD.gerente, name: 'Héctor Vidal', email: 'hvidal@casinocentral.cl', company: 'Casino Central', replied_at: '2026-09-12T14:00:00Z', reply_intent: 'meeting_request', data: { note: 'Escribió «¿te parece agendar?»; nunca se le respondió' } },
        { id: id(353), lead_id: AXIS_LEAD.fundacion, name: 'Beatriz Molina', email: 'bmolina@fundacionemp.cl', company: 'Fundación Empresarial', replied_at: '2026-09-05T14:00:00Z', reply_intent: 'positive', data: { note: 'Dio el nombre de su gerente general; nunca se le escribió' } },
        { id: id(354), lead_id: AXIS_LEAD.compartir, name: 'Camilo Reyes', email: 'creyes@transportesv.cl', company: 'Transportes del Valle', replied_at: '2026-09-09T14:00:00Z', reply_intent: 'positive', data: { note: '«Lo compartiré con mi equipo para agendar una reunión»' } },
        { id: id(355), lead_id: AXIS_LEAD.country, name: 'Martín Ossa', email: 'mossa@multiglobal.com', company: 'Multiglobal Chile', replied_at: '2026-09-03T14:00:00Z', reply_intent: 'meeting_request', data: { note: 'Aceptó reunión, no llegó y luego ignoró la propuesta' } }],
      returned: 5, total: 5, truncated: false, coverage: { gmail: { windowDays: 90, windowComplete: true, lastCompletedAt: '2026-09-25T09:00:00Z', lastError: null }, outlook: null }, rule: 'Interés humano sin envío posterior ni compromiso abierto tras 48 horas.' },
    }),
    checks: commonWith(
      readsAny('mira lo que pasó antes de proponer trabajo nuevo', 'metrics.rates', 'metrics.overview', 'replies.stalled'),
      before('diagnostica primero: pocos envíos y sin prospección nueva', /(42|pocos) (correos|envios)|sin prospecci|no (hubo|hay) prospecci/, /(recuper|reactiv|escrib)/),
      says('encuentra las cinco reuniones enfriadas', /\b(5|cinco)\b/, /(iv[aá]n herrera|servicios integrales)/, /(hector vidal|casino central)/),
      saysAny('propone recuperar lo ganado antes de prospectar', /(recuper|reactiv|retom)[^.]{0,80}(antes|primero)/, /(antes|primero)[^.]{0,80}(recuper|reactiv|retom)/),
      saysAny('cita el punto exacto en que quedó cada uno (contrato sin firmar, «¿te parece agendar?»)', /contrato[^.]{0,40}sin firmar/, /te parece agendar/),
      noSend, endsAsking)});

  add({ id: 'axis-g2-tibios', title: 'Reactivar a un lead tibio con el siguiente paso ya hecho',
    request: 'Escríbeles a los tibios que enfriamos: retoma cada hilo en el punto donde quedó, sin repetir la oferta.',
    axis: axis('G2', 'G · Seguimiento', 'parcial',
      ['Leer el hilo completo, ubicar en qué punto quedó y escribir el mensaje que dé el paso siguiente sin repetir la oferta ni preguntar «¿viste mi correo?»', 'Asumir el lapso en una línea si fue propio («te debo una respuesta desde hace meses, error mío»)', 'Cada mensaje cita el punto exacto en que quedó la conversación'],
      { result: 'Contrato sin firmar: retomar el contrato y ofrecer reenviarlo; quien dijo que sí y nunca recibió respuesta: reconocerlo y proponer fecha; quien derivó a un colega: escribir al colega; quien ya tiene proveedor: comparación directa sin costo con una muestra de casos.',
        failed: 'Ninguna en particular; el patrón que funcionó fue dar el paso siguiente hecho.' }),
    world: w({
      'replies.stalled': { scope: 'organization_replies', items: [
        { id: id(361), lead_id: AXIS_LEAD.contrato, name: 'Iván Herrera', email: 'iherrera@servintegrales.cl', company: 'Servicios Integrales', replied_at: '2026-09-01T14:00:00Z', reply_intent: 'positive', data: { commitment: { kind: 'contract', note: 'Contrato enviado sin firmar', daysSilent: 24 } } },
        { id: id(362), lead_id: AXIS_LEAD.gerente, name: 'Héctor Vidal', email: 'hvidal@casinocentral.cl', company: 'Casino Central', replied_at: '2026-09-12T14:00:00Z', reply_intent: 'meeting_request', data: { note: 'Escribió «¿te parece agendar?»; nunca se le respondió' } },
        { id: id(363), lead_id: AXIS_LEAD.compartir, name: 'Camilo Reyes', email: 'creyes@transportesv.cl', company: 'Transportes del Valle', replied_at: '2026-09-09T14:00:00Z', reply_intent: 'positive', data: { note: '«Lo compartiré con mi equipo para agendar una reunión»' } }],
      returned: 3, total: 3, truncated: false, coverage: noCoverage, rule: 'Interés humano sin envío posterior ni compromiso abierto tras 48 horas.' },
    }),
    checks: commonWith(
      reads('lee a quién le toca antes de escribir', 'replies.stalled'),
      { label: 'escribe un mensaje por persona (tres)', test: result => (result.blocks || []).filter(block => block.type === 'email_draft').length >= 3 || (axisShown(result).match(/asunto/g) || []).length >= 3 },
      says('a Iván le retoma el contrato sin firmar', /(iv[aá]n|herrera)/, /contrato/),
      says('a Héctor le reconoce que nunca se le respondió y propone fecha', /(hector|vidal)/, /(te debo|error mio|nunca (te )?respond|tardanza|demora)/),
      says('a Camilo le retoma lo que dijo de compartirlo con su equipo', /(camilo|reyes)/, /(equipo|compart)/),
      avoids('no pregunta «¿viste mi correo?» ni repite la oferta de cero', /(viste mi (correo|mensaje)|queria saber si (viste|leiste)|solo para (recordarte|confirmar que recibiste))/),
      noSend)});

  add({ id: 'axis-g3-automatizacion', title: 'Detectar fallas de la propia automatización y arreglarlas de raíz',
    request: 'Revisa si la automatización le mandó correos de cierre a alguien que estaba negociando.',
    axis: axis('G3', 'G · Seguimiento', 'faltante',
      ['Buscar patrones de daño, no solo contar respuestas: correos de cierre enviados a empresas que estaban negociando', 'Encontrar la causa raíz: el detector de respuestas miraba solo la dirección exacta a la que se escribió; quien respondía desde otro correo de la misma empresa era invisible', 'Declarar el arreglo con su causa (detectar por dominio; si alguien de la empresa responde, la empresa sale de la secuencia automática y pasa a manejo manual) y sacar de los envíos masivos las cuentas con conversación abierta'],
      { result: 'A una cuenta se le enviaron correos de cierre a tres personas diez días después de que su gerente escalara el tema; a otra le llegaron dos mientras negociaba su cotización; a un gerente le llegó un cierre tres días después de preguntar por una validación por plataforma. Causa raíz y arreglo por dominio.',
        failed: 'La causa raíz estaba en el detector de respuestas, que solo miraba la dirección exacta.' }),
    world: w({
      'campaigns.list': { scope: 'own', campaigns: [{ id: id(371), name: 'Cierre de ciclo T6', status: 'active', revision: 1, recipients: 164, createdAt: '2026-09-10T15:00:00Z' }] },
      'campaigns.batch_report': { scope: 'own_campaign_batch', campaign: { id: id(371), name: 'Cierre de ciclo T6', status: 'active', revision: 1, approvedAt: '2026-09-10T15:00:00Z', provider: 'google', cadence: 'un toque de cierre', batch: null },
        summary: { recipients: 164, touches: 164, sent: 160, deferred: 0, failed: 4, uncertain: 0 },
        recipients: [
          { email: 'gerente@minerasur.cl', name: 'Gerente Servicios', company: 'Minera Sur', contacted: { status: 'sent', sent_at: '2026-09-20T13:00:00Z', replied_at: null, reply_intent: null },
            flags: { companyReplied: { email: 'operaciones@minerasur.cl', repliedAt: '2026-09-10T14:00:00Z' }, negotiationStages: [], crmStages: ['contacted'], replyCoverageComplete: true, negotiationCoverageComplete: true },
            touches: [{ touchNumber: 1, status: 'sent', sentAt: '2026-09-20T13:00:00Z', subject: 'Cierro el tema' }], sent: 1, total: 1 },
          { email: 'jefe@alimentosvalle.cl', name: 'Jefe de Personas', company: 'Alimentos del Valle', contacted: { status: 'sent', sent_at: '2026-09-21T13:00:00Z', replied_at: null, reply_intent: null },
            flags: { companyReplied: { email: 'cotizaciones@alimentosvalle.cl', repliedAt: '2026-09-15T14:00:00Z' }, negotiationStages: ['quote_sent'], crmStages: ['quote_sent'], replyCoverageComplete: true, negotiationCoverageComplete: true },
            touches: [{ touchNumber: 1, status: 'sent', sentAt: '2026-09-21T13:00:00Z', subject: 'Cierro el tema' }], sent: 1, total: 1 },
          { email: 'legal@clinicabosque.cl', name: 'Gerente Legal', company: 'Clínica Bosque', contacted: { status: 'sent', sent_at: '2026-09-22T13:00:00Z', replied_at: null, reply_intent: null },
            flags: { companyReplied: { email: 'compras@clinicabosque.cl', repliedAt: '2026-09-19T14:00:00Z' }, negotiationStages: [], crmStages: ['contacted'], replyCoverageComplete: true, negotiationCoverageComplete: true },
            touches: [{ touchNumber: 1, status: 'sent', sentAt: '2026-09-22T13:00:00Z', subject: 'Cierro el tema' }], sent: 1, total: 1 }],
        limitation: 'Historial de la app con consultas acotadas; la bandeja del proveedor puede traer respuestas aun no sincronizadas.' },
    }),
    checks: commonWith(
      readsAny('mira el reporte del lote antes de concluir', 'campaigns.batch_report', 'campaigns.list'),
      says('encuentra las tres cuentas afectadas', /minera sur/, /alimentos del valle/, /clinica bosque/),
      says('explica la causa: respondieron desde otra dirección de la misma empresa', /(otra (direccion|casilla|correo)|distinta direccion|otro correo)/, /(misma empresa|mismo dominio|dominio)/),
      saysAny('propone detener por empresa o dominio y pasar a manejo manual', /(por empresa|por dominio|toda la empresa)[^.]{0,120}(deten|pausa|saca|manual)/, /(deten|pausa|saca|manual)[^.]{0,120}(por empresa|por dominio|toda la empresa)/),
      saysAny('propone sacar de los envíos masivos las cuentas con conversación abierta', /(conversacion abierta|negociand|en negociacion)[^.]{0,120}(sac|retir|exclu|reten)/, /(sac|retir|exclu|reten)[^.]{0,120}(conversacion abierta|negociand|en negociacion)/),
      saysAny('es honesto con lo que no puede arreglar desde el chat (el detector)', /(no puedo|no es algo que pueda|requiere un cambio)[^.]{0,120}(detector|sistema|automatizacion|app)/, /(detector|sistema)[^.]{0,60}(equipo|desarrollo|correg)/),
      noSend)});

  add({ id: 'axis-g4-postreunion', title: 'Seguimiento después de la reunión: cotización, plan y compromisos',
    request: 'Después de la reunión con la empresa de servicios les mandé tres cotizaciones y el plan de trabajo, donde incorporamos en las semanas 1 y 2 la materia que aún no cubrimos. ¿Qué hacemos ahora?',
    history: [{ request: 'La gerente de operaciones de la empresa de servicios preguntó si cubrimos una materia que todavía no cubrimos. Le voy a decir que la incorporamos sin costo extra en dos semanas.', at: '2026-09-24T12:00:00Z',
      reply: 'Entendido: comprometes incorporar esa materia sin cargo extra en dos semanas y anclar la conversación en el precio.' }],
    axis: axis('G4', 'G · Seguimiento', 'parcial',
      ['Tras una reunión o pregunta concreta, ayudar a construir la respuesta y cuidar los compromisos que asume el usuario', 'Advertir que el reloj del compromiso parte apenas el cliente dice que sí y confirmar con quien desarrolla que el plazo es factible; no insistir el mismo día en que se enviaron las cotizaciones', 'Un resumen de una página orientado a cumplimiento cuando el interlocutor lo lleva al área legal; con una cotización en revisión de presupuesto, no hay nada que empujar hasta que respondan', 'El estado de cada cuenta se lee del hilo, no de la memoria'],
      { result: 'Advirtió que el compromiso de dos semanas parte cuando el cliente diga que sí y que hay que confirmar con quien desarrolla que es factible («incumplirlo con el primer cliente serio sale más caro que haber dicho tres semanas»); sugirió no insistir el mismo día; propuso un resumen de una página para cumplimiento y dijo que en la cuenta en revisión de presupuesto no había nada que empujar.',
        failed: 'Repitió cuatro veces que un cliente estaba esperando respuesta cuando el usuario ya le había respondido nueve minutos después de su pregunta; al corregirlo, verificó el hilo y siguió sin párrafos de disculpa.' }),
    world: w({
      'contacted.search': contacted([
        { leadId: id(381), name: 'Gerente de Operaciones', company: 'Servicios Integrales', channel: 'email', sentAt: '2026-09-25T11:00:00Z', replied: false, note: 'Tres cotizaciones y plan de trabajo enviados hace dos horas' },
        { leadId: id(382), name: 'Director de Operaciones', company: 'Alimentos del Valle', channel: 'email', sentAt: '2026-09-22T11:00:00Z', replied: true, replyIntent: 'positive', note: 'Dijo que enviaría la información al área legal' },
        { leadId: id(383), name: 'Gerente de Compras', company: 'Clínica Bosque', channel: 'email', sentAt: '2026-09-21T11:00:00Z', replied: true, replyIntent: 'neutral', note: 'Pidió cotización formal; se enviaron tres; en revisión de presupuesto' }]),
    }),
    checks: commonWith(
      says('advierte el reloj del compromiso: parte cuando el cliente diga que sí', /(dos semanas|2 semanas)/, /(desde que|apenas|cuando)[^.]{0,80}(dig(a|an) que si|acepte|confirme|apruebe)/),
      saysAny('propone confirmar con quien desarrolla que el plazo es factible', /(confirm|consult|habl)[^.]{0,80}(desarroll|equipo tecnico|producto)/, /(desarroll|equipo tecnico)[^.]{0,80}(plazo|factible|dos semanas)/),
      says('sugiere no insistir el mismo día del envío', /(no insist|no empuj|esper)[^.]{0,80}(hoy|mismo dia|manana|dia siguiente)/),
      says('para el área legal propone un resumen de una página orientado a cumplimiento', /(resumen|una pagina|1 pagina)/, /(cumplimiento|trazabilidad|evidencia|legal)/),
      says('con la clínica dice que no hay nada que empujar hasta que respondan', /clinica/, /(nada que empujar|no hay nada|esperar|esperemos|en revision)/),
      avoids('no afirma que un cliente está esperando respuesta sin haberlo leído del hilo', /(esta esperando (tu )?respuesta|espera tu respuesta)(?![^.]{0,80}(verific|revis|hilo))/),
      noSend)});

  add({ id: 'axis-g6-origen', title: 'Preparar una reunión y trazar su origen',
    request: 'Mañana tengo la reunión con Alimentos del Valle. Prepárame la reunión y dime qué mensaje produjo que se agendara.',
    axis: axis('G6', 'G · Seguimiento', 'parcial',
      ['Reconstruir paso a paso qué mensaje produjo la reunión: un mensaje de prueba gratis a una reclutadora operativa; días después su respuesta con el correo de su jefa; a los dos minutos la petición de probar la plataforma; unas horas después un correo a ambas; y diez minutos más tarde la reunión agendada por la jefa', 'Advertir antes de la reunión que meses antes esa empresa había recibido un correo con un precio equivocado en el asunto (unas cinco veces el real) que seguía en su bandeja; llegar con el precio correcto por delante'],
      { result: 'El usuario entendió el mecanismo (al operativo se le presta la herramienta, él sube hasta quien decide) y llegó a la reunión con el precio corregido.',
        failed: 'Ninguna en particular.' }),
    world: w({
      'replies.meeting_chain': { scope: 'organization_account', leadId: AXIS_LEAD.ana, chains: [{ contactedId: id(391), steps: [
        { kind: 'outbound', at: '2026-09-08T13:00:00Z', subject: 'Prueba gratis de AXIS para tu equipo', verifiable: true },
        { kind: 'inbound', at: '2026-09-10T15:00:00Z', note: 'Respondió con el correo de su jefa', verifiable: true },
        { kind: 'inbound', at: '2026-09-10T15:02:00Z', note: 'Pidió probar la plataforma', verifiable: true },
        { kind: 'outbound', at: '2026-09-10T19:00:00Z', subject: 'Cuenta de prueba lista', to: 'ambas', verifiable: true },
        { kind: 'meeting', at: '2026-09-10T19:10:00Z', note: 'La jefa agendó la reunión', verifiable: true }] }], coverage: noCoverage,
      limitation: 'Solo los eslabones con identificador y fecha son verificables; el resto se marca parcial o sin verificar.' },
      'contacted.account': { scope: 'organization_account', anchor: { contactedId: id(391), leadId: AXIS_LEAD.ana, company: 'Alimentos del Valle' },
        members: [
          { id: id(391), lead_id: AXIS_LEAD.ana, name: 'Ana Ruiz', email: 'aruiz@delvalle.cl', company: 'Alimentos del Valle', status: 'sent', sent_at: '2026-09-08T13:00:00Z', replied_at: '2026-09-10T15:00:00Z', reply_intent: 'positive' },
          { id: id(392), lead_id: id(393), name: 'Gerente General', email: 'gerencia@delvalle.cl', company: 'Alimentos del Valle', status: 'sent', sent_at: '2026-05-14T13:00:00Z', subject: 'Consultas judiciales desde $4.950 por persona', replied_at: null }],
        returned: 2, total: 2, truncated: false, conflicts: [], coverage: noCoverage, limitation: 'Coincidencia exacta de empresa normalizada; si el correo está sincronizado por completo se indica aparte.' },
      'message.context': { configured: true, context: { defaultStyle: 'Directo, cercano y breve', trialOffer: 'Cuenta de prueba de dos semanas', voiceExamples: [], approvedClaims: ['Precio de referencia: $990 por persona consultada'], prohibitedTerms: [] } },
    }),
    checks: commonWith(
      readsAny('reconstruye la cadena con los datos', 'replies.meeting_chain', 'contacted.account'),
      says('cuenta la cadena en orden: prueba gratis, respuesta con el correo de la jefa, petición de probar, correo a ambas, reunión', /prueba gratis/, /(jefa)/, /(a los (dos|2) minutos|dos minutos)/, /(diez minutos|10 minutos)/),
      says('explica el mecanismo: al operativo se le presta la herramienta y sube hasta quien decide', /(operativ|reclutadora)/, /(sube|jefa|quien decide)/),
      says('advierte el precio equivocado del correo de mayo', /4\.?950/, /990/),
      saysAny('recomienda llegar con el precio correcto por delante', /(llega|lleva|abre)[^.]{0,80}precio correcto|precio correcto[^.]{0,60}(por delante|primero|al inicio)/),
      onlyKnown('no inventa cifras', known(4950, 990)),
      noSend)});

  return cases;
}

export const AXIS_CASE_IDS = ['axis-a2-mercado', 'axis-a4-ola', 'axis-a5-perfil', 'axis-a7-rubro', 'axis-b1-diagnostico', 'axis-b4-calendario', 'axis-c1-correo-corto',
  'axis-c2-roles', 'axis-c3-objeciones', 'axis-d1-cadencia', 'axis-d2-que-toca-hoy', 'axis-d5-hilo', 'axis-e3-invitaciones', 'axis-e4-mensajes', 'axis-f1-telefono',
  'axis-g1-bandeja', 'axis-g2-tibios', 'axis-g3-automatizacion', 'axis-g4-postreunion', 'axis-g6-origen'];

/** The 20 ★ cases, with the user context read through the real loader. */
export const AXIS_CORPUS: CorpusCase[] = axisCorpus(await axisUserContext());

// Regression corpus built from the conversations run in production Cowork on
// 25 sep 2026 (workspace GrupoExpro, approval mode). Messages are the ones a
// real user typed; tool results are compact, masked copies of what production
// returned. Each case says what a good turn must do and records the baseline
// production outcome it replaces. No database, mailbox or provider is touched.
import { COWORK_DEFERRAL, coworkAnswerIssues } from '../../src/lib/cowork/answer-quality';
import type { CoworkUserContext } from '../../src/lib/cowork/decision-context';
import type { CoworkBlock } from '../../src/lib/cowork/contracts';
import { coworkBlocksText } from '../../src/lib/cowork/blocks';

export const CORPUS_NOW = new Date('2026-09-25T13:10:00Z');

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const LEAD = { carlos: id(21), nehal: id(22), jose: id(23), paula: id(24) };
export const CAMPAIGN_ID = id(31);

const ownLeads = [
  { id: LEAD.carlos, name: 'Carlos Ah***a', title: 'Operations Manager', company: 'Minera Centinela', email: null, status: 'saved', created_at: '2026-09-25T04:26:06Z' },
  { id: LEAD.nehal, name: 'Nehal Pa***a', title: 'Recruitment Manager', company: 'Adecco', email: null, status: 'saved', created_at: '2026-09-22T19:18:14Z' },
  { id: LEAD.jose, name: 'Jose Ca***o', title: 'Reclutador Junior', company: 'GrupoExpro', email: 'jcastro@grupoexpro.com', status: 'saved', created_at: '2026-09-22T19:10:00Z' },
  { id: LEAD.paula, name: 'Katherine Sa***o', title: 'Consultor de Selección', company: 'Adecco', email: null, status: 'saved', created_at: '2026-09-22T19:05:00Z' },
];

const unknownCoverage = { gmail: null, outlook: null };

const OFFER = 'Yago SpA. Productos: AXIS: consultas judiciales automáticas en el Poder Judicial (PJUD) para revisar antecedentes laborales de postulantes';
const PROFILE = { fullName: 'Nicolás Y.', jobTitle: 'Gerente Comercial', companyName: 'Yago SpA', companyDomain: 'yago.cl' };

/** What the worker reads once per run (loadCoworkUserContext): the same person
 * and offer that profile.get and app.context return in this workspace. */
export const CORPUS_USER_CONTEXT: CoworkUserContext = { ...PROFILE, offer: OFFER, offerSource: 'organization' };

/** Compact copies of production results, keyed by action (and input when it matters). */
export function corpusRead(action: string, input: string): unknown {
  const term = input.toLowerCase();
  switch (action) {
    case 'leads.search': {
      const items = !term ? ownLeads : ownLeads.filter(lead => [lead.name, lead.title, lead.company, lead.email]
        .some(value => String(value || '').toLowerCase().split(/\s+/).some(word => term.split(/\s+/).some(part => part.length > 2 && word.includes(part)))));
      return { items, returned: items.length, limit: 20, scope: 'own_saved_contacts', truncated: false, partial: false };
    }
    case 'leads.get':
      return { items: ownLeads.filter(lead => lead.id === input), returned: 1, limit: 1, scope: 'own_saved_contacts', truncated: false };
    case 'contacted.search':
      return { items: [], limit: 20, scope: 'organization_contacted', returned: 0, truncated: false,
        evidence: { source: 'application_contact_records', limitation: 'Lista de registros, no cola de respuestas pendientes confirmadas.', pendingStatus: 'needs_verification', mailboxCoverage: unknownCoverage } };
    case 'replies.attention':
      return { scope: 'organization_replies', coverage: unknownCoverage, failures: [], automatic: [], items: [], truncated: false,
        limitation: 'Lo registrado en ANTON.IA; si el correo está sincronizado por completo se indica aparte.' };
    case 'campaigns.inbox':
      return { scope: 'own', items: [], truncated: false };
    case 'exceptions.list':
      return { scope: 'team', truncated: false, items: [
        { id: id(41), type: 'sync_error', summary: 'La sincronización de Outlook falló el 24 sep', status: 'open' },
        { id: id(42), type: 'unclassified_reply', summary: 'Respuesta sin clasificar de un contacto de Adecco', status: 'open' },
      ] };
    case 'missions.list':
      return { scope: 'own', items: [], truncated: false };
    case 'app.context':
      return { scope: 'organization_context', emailConnections: { google: true, outlook: true },
        counts: { leads: 256, contacted: 0, campaigns: 19, activeMissions: 0, openExceptions: 2 }, performance: null,
        offer: OFFER, offerSource: 'organization' };
    case 'profile.get':
      return { scope: 'own_profile', profile: { ...PROFILE, email: 'ventas@yago.cl' }, signatures: [] };
    case 'metrics.overview':
      return { scope: 'organization', period: 'last_7_days', savedContacts: 256, contactedTotal: 0, contactedThisWeek: 0, repliesThisWeek: 0, autoRepliesThisWeek: 0, bouncesThisWeek: 0 };
    case 'metrics.rates':
      return { scope: 'organization_metrics', coverage: unknownCoverage, limitation: 'Tasas por contacto con la cantidad de envíos sobre la que se calculan; null significa sin envíos, no cero.',
        last_7_days: { days: 7, sent: 0, rates: { reply: { unit: 'per_contact', value: null, period: 'last_7_days', numerator: 0, denominator: 0 } } },
        last_30_days: { days: 30, sent: 0, rates: { reply: { unit: 'per_contact', value: null, period: 'last_30_days', numerator: 0, denominator: 0 } } } };
    case 'metrics.diagnose':
      return { scope: 'organization_metrics', hypotheses: [{ id: 'deliverability', verdict: 'untestable', reason: 'Sin envíos en el período.' }] };
    case 'audience.analyze':
      return { scope: 'organization_stored_audience', coverage: 'complete', sectors: [
        { sector: 'Servicios de RR. HH. y outsourcing', contacts: 118, contacted: 0 }, { sector: 'Minería y proveedores', contacts: 41, contacted: 0 },
        { sector: 'Retail', contacts: 37, contacted: 0 }], contactsWithEmail: 21, contactsTotal: 256 };
    case 'campaigns.list':
      return { scope: 'own', campaigns: [{ id: CAMPAIGN_ID, name: 'Campaña de prueba', status: 'draft', revision: 1, recipients: 7, createdAt: '2026-09-18T15:00:00Z' }] };
    case 'message.context':
      return { configured: true, context: { defaultStyle: 'Profesional, claro y directo', trialOffer: null, approvedClaims: [], prohibitedTerms: [], voiceExamples: [] } };
    case 'deliverability.check':
      return { scope: 'domain_dns', domain: term || 'yago.cl', checkedAt: '2026-09-25T13:10:00Z', verdict: 'warning', checks: {
        mx: { status: 'pass', records: 5 }, spf: { status: 'warning', detail: 'Termina en ~all (softfail)' },
        dkim: { status: 'pass', selector: 'google' }, dmarc: { status: 'warning', detail: 'Política p=none (solo monitoreo)' } } };
    case 'deliverability.sender':
      return { scope: 'own_sender', declaredEmail: 'ventas@yago.cl', verdict: 'unverified', recentSends: 0 };
    case 'compliance.law':
      return { scope: 'legal_reference', jurisdiction: 'Chile', notice: 'Información general, no asesoría legal.', items: [
        { law: 'Ley 19.628', summary: 'Tratamiento de datos personales requiere autorización legal o consentimiento; reconoce fuentes accesibles al público y el derecho de oposición a publicidad.' },
        { law: 'Ley 21.719', summary: 'Nueva ley de protección de datos; vigencia prevista 1 dic 2026.' }],
      policy: { stopOnUnsubscribe: true, doNotContact: 'do_not_contact bloquea el contacto' } };
    case 'research.get_existing':
      return input === LEAD.carlos
        ? { scope: 'own_research', availability: 'available', research: { snapshotId: id(51), status: 'insufficient_evidence', capturedAt: '2026-09-25T13:17:16Z', sources: [], findings: [] } }
        : { scope: 'own_research', availability: 'none' };
    case 'compliance.check':
      return { lead: { id: input }, verdict: input === LEAD.jose ? 'allow' : 'block', reasons: input === LEAD.jose ? [] : ['missing_email'] };
    case 'linkedin.followups':
      return { scope: 'own_linkedin_followups', items: [], returned: 0,
        limitation: 'Elegibilidad base sin el contenido nuevo: el segundo mensaje debe aportar información distinta, verificada en su revisión.' };
    case 'linkedin.network':
      return { scope: 'own_linkedin_network', peers: [], returned: 0, truncated: false,
        coverage: { lastCompletedAt: null, hasMore: true, observedCount: 0, complete: false },
        limitation: 'Solo conexiones reportadas por tu extensión. Si falta sincronizar LinkedIn por completo, no se afirma quién es nuevo.' };
    case 'linkedin.inbox':
      return { scope: 'own_linkedin_inbox', threads: [], returned: 0, truncated: false, sweepComplete: false, pendingCounts: null,
        coverage: { lastCompletedAt: null, hasMore: true, observedCount: 0 },
        limitation: 'Falta sincronizar LinkedIn con la extensión («Sincronizar historial de LinkedIn»): hay conversaciones sin revisar; no se afirma quién está pendiente.' };
    case 'linkedin.quota':
      return { scope: 'own_linkedin_quota', pending: 0, sent: 0, limit: 100, windowDays: 7, allowed: true };
    case 'crm.search':
      return { items: [], returned: 0, limit: 20, scope: 'organization_crm', truncated: false };
    default:
      return { scope: 'not_in_corpus', items: [], note: 'Sin datos en este corpus.' };
  }
}

/** Server-side staging the corpus reproduces: campaign recipients must be saved contacts. */
export function corpusStageEffect(proposal: { kind: string; campaign?: { emails: string[] } },
  savedEmails: Array<string | null> = ownLeads.map(lead => lead.email)) {
  if (proposal.kind === 'campaign_create') {
    const saved = new Set(savedEmails.filter(Boolean));
    const missing = proposal.campaign?.emails.find(email => !saved.has(email));
    if (missing) throw new Error(`El destinatario ${missing} ya no está disponible para esta audiencia.`);
  }
}

export type CorpusTurnResult = {
  actions: string[];
  reply: string;
  document: { title: string; content: string } | null;
  proposal: { kind: string; label: string; targetId?: string; campaign?: unknown; linkedinMessage?: string } | null;
  search: Record<string, unknown> | null;
  note: string | null;
  failed: string | null;
  /** Quick replies shown under the answer (empty for proposals and failures). */
  suggestions?: Array<{ label: string; message: string }>;
  /** Cards shown with the answer (emails, sequences, tables, figures). */
  blocks?: CoworkBlock[];
  /** The closing question, when it traveled apart (it also ends the reply). */
  question?: string | null;
  /** The plan shown while it worked, when the turn consulted something. */
  plan?: Array<{ label: string; read: string | null }> | null;
  /** Each read with its input, so the judge can see the same data the model saw. */
  reads?: Array<{ action: string; input: string }>;
};

/** What the person reads in the chat: the reply plus every card. */
export const corpusShown = (result: CorpusTurnResult) => [result.reply, coworkBlocksText(result.blocks || [])].filter(Boolean).join('\n\n');

export type CorpusWorld = { read: (action: string, input: string) => unknown; savedEmails: string[]; userContext?: CoworkUserContext | null };

export type CorpusHistoryTurn = { request: string; reply: string; at: string; observations?: unknown[]; actions?: unknown[] };

export type CorpusCase = {
  id: string;
  title: string;
  request: string;
  history?: CorpusHistoryTurn[];
  /** Production run this case reproduces, its baseline scores and what went wrong. */
  production?: { run: string; latencySeconds: number; scores: { comprension: number; veracidad: number; utilidad: number; claridad: number; friccion: number }; problem: string };
  /** For cases written from a use case rather than copied from production: why it exists. */
  origin?: string;
  /** Tool results and saved emails of this case's account; the production workspace by default. */
  world?: CorpusWorld;
  checks: Array<{ label: string; test: (result: CorpusTurnResult) => boolean }>;
};

const answerOk = (result: CorpusTurnResult) => !result.failed;
const shownText = (result: CorpusTurnResult) => (result.proposal || result.search) && result.note ? result.note : result.reply;
const noJargon = (result: CorpusTurnResult) => coworkAnswerIssues(shownText(result), { expectNextStep: false })
  .every(issue => !['jargon', 'uuid', 'format', 'timezone'].includes(issue.code));
const nextStep = (result: CorpusTurnResult) => Boolean(result.proposal || result.search)
  || !coworkAnswerIssues(result.reply).some(issue => issue.code === 'next_step');
const explained = (result: CorpusTurnResult) => !(result.proposal || result.search) || Boolean(result.note && result.note.length > 20);
// A plain answer offers at least one quick reply; a proposal already has its card.
const suggested = (result: CorpusTurnResult) => Boolean(result.proposal || result.search) || (result.suggestions?.length ?? 0) > 0;
// Each quick reply asks for something Cowork does on click, never a promise the person makes.
// The sanitizer drops these; the check guards it on the chips the person would see.
const actionable = (result: CorpusTurnResult) => (result.suggestions || []).every(chip => !COWORK_DEFERRAL.test(chip.message));

export const CORPUS_COMMON_CHECKS = [
  { label: 'termina sin fallar', test: answerOk },
  { label: 'sin jerga, códigos, IDs ni horas UTC', test: noJargon },
  { label: 'cierra con un siguiente paso o una propuesta', test: nextStep },
  { label: 'si propone, explica la propuesta', test: explained },
  { label: 'ofrece respuestas sugeridas para seguir', test: suggested },
  { label: 'las sugerencias piden algo que Cowork hace al tocarlas', test: actionable },
];

const recentAt = '2026-09-25T13:08:00Z';

export const CORPUS: CorpusCase[] = [
  { id: 'pendientes-vacio', title: 'Pendientes de hoy sin conversaciones activas', request: 'hola, que tengo pendiente para hoy?',
    production: { run: '3e143ba7', latencySeconds: 27, scores: { comprension: 4, veracidad: 4, utilidad: 2, claridad: 3, friccion: 2 }, problem: 'Callejón sin salida con jerga de «cobertura»; no mira campañas ni incidencias.' },
    checks: [...CORPUS_COMMON_CHECKS,
      { label: 'consulta pendientes antes de responder', test: r => r.actions.some(a => ['contacted.search', 'replies.attention', 'campaigns.inbox'].includes(a)) },
      { label: 'propone algo concreto (incidencias, campañas o contactos)', test: r => /incidenc|campañ|contacto/i.test(r.reply) }] },
  { id: 'recomendacion-hoy', title: 'Qué hacer hoy, dos minutos después', request: 'ok y entonces que me recomiendas hacer hoy para avanzar?',
    history: [{ request: 'hola, que tengo pendiente para hoy?', at: recentAt,
      reply: 'Hoy no tienes respuestas ni seguimientos pendientes registrados en ANTON.IA.',
      observations: [{ action: 'contacted.search', input: '', result: corpusRead('contacted.search', '') }, { action: 'replies.attention', input: '', result: corpusRead('replies.attention', '') }] }],
    production: { run: 'c0f1579b', latencySeconds: 95, scores: { comprension: 4, veracidad: 3, utilidad: 2, claridad: 3, friccion: 2 }, problem: 'Repite las mismas lecturas y devuelve el trabajo al usuario («revisa las incidencias», «comprueba Gmail»).' },
    checks: [...CORPUS_COMMON_CHECKS,
      { label: 'no repite las lecturas del turno anterior', test: r => !r.actions.includes('contacted.search') && !r.actions.includes('replies.attention') },
      // Counts from app.context, exceptions.list or audience.analyze (118 of RR. HH., 21 with email), or the
      // saved contacts by name; a count may be written out («dos incidencias abiertas»), a bare «dos» does not count.
      { label: 'usa datos de la cuenta (incidencias, campañas o contactos)', test: r => /\b(?:2|19|256|255|118|41|37|21)\b|\bdos incidencias\b|\bdiecinueve campañas\b|\b(?:Carlos|Nehal|Katherine)\b|\bJos[eé](?![a-z])/i.test(r.reply) }] },
  { id: 'metricas-semana', title: 'Números de la semana', request: 'como me ha ido esta semana con los correos? dame numeros',
    production: { run: '1c86e476', latencySeconds: 32, scores: { comprension: 5, veracidad: 5, utilidad: 3, claridad: 4, friccion: 3 }, problem: 'Correcta pero sin siguiente paso y con jerga de cobertura.' },
    checks: [...CORPUS_COMMON_CHECKS, { label: 'consulta métricas', test: r => r.actions.some(a => a.startsWith('metrics.')) },
      { label: 'da los números (0 envíos)', test: r => /\b0\b|ningún|ningun|no enviaste/i.test(corpusShown(r)) },
      { label: 'las cifras van como tarjeta', test: r => (r.blocks || []).some(block => block.type === 'metrics') }] },
  { id: 'ultimos-guardados', title: 'Últimos contactos guardados', request: 'muestrame los ultimos contactos que guarde',
    production: { run: 'ba91494c', latencySeconds: 74, scores: { comprension: 5, veracidad: 5, utilidad: 3, claridad: 4, friccion: 3 }, problem: 'Buen formato pero cierra con metacomentario técnico y sin ofrecer buscar correos.' },
    checks: [...CORPUS_COMMON_CHECKS, { label: 'consulta tus guardados', test: r => r.actions.includes('leads.search') },
      // Offering is either the closing question or the enrichment card itself (proposing beats asking).
      { label: 'ofrece completar los correos que faltan', test: r => ['enrich_batch', 'enrich_contact'].includes(r.proposal?.kind || '')
        || (/correo/i.test(r.reply) && /[¿?]/.test(r.reply)) }] },
  { id: 'vale-la-pena', title: '¿Vale la pena escribirle?', request: 'y que sabemos de la nehal de adecco? vale la pena escribirle?',
    production: { run: '92655919', latencySeconds: 90, scores: { comprension: 4, veracidad: 4, utilidad: 2, claridad: 3, friccion: 2 }, problem: 'Pregunta qué vende el usuario y no propone buscar su correo.' },
    checks: [...CORPUS_COMMON_CHECKS, { label: 'no pregunta qué vende el usuario', test: r => !/qué (?:producto|servicio|vendes|ofreces)|qué necesidad/i.test(r.reply + (r.note || '')) },
      { label: 'propone o pregunta por buscar su correo', test: r => r.proposal?.kind === 'enrich_contact' || /correo/i.test(r.reply) }] },
  { id: 'dominio', title: 'Entregabilidad sin nombrar el dominio', request: 'revisa si mi dominio esta bien configurado pa no caer en spam',
    production: { run: '0bf28439', latencySeconds: 112, scores: { comprension: 4, veracidad: 5, utilidad: 1, claridad: 2, friccion: 1 }, problem: 'Pide «el dominio desnudo» en vez de deducirlo del perfil.' },
    checks: [...CORPUS_COMMON_CHECKS, { label: 'revisa el dominio sin preguntarlo', test: r => r.actions.includes('deliverability.check') },
      { label: 'menciona yago.cl', test: r => /yago\.cl/i.test(r.reply) }] },
  { id: 'prospeccion-mineria', title: 'Buscar prospectos nuevos', request: 'necesito encontrar gerentes de operaciones de empresas mineras en antofagasta',
    production: { run: 'ad4ff647', latencySeconds: 112, scores: { comprension: 5, veracidad: 5, utilidad: 4, claridad: 4, friccion: 4 }, problem: 'Criterios estrechos (2 cargos, solo seniority manager) y sin explicación junto a la tarjeta.' },
    checks: [...CORPUS_COMMON_CHECKS, { label: 'propone una búsqueda', test: r => Boolean(r.search) },
      { label: 'amplía cargos del rubro (3 o más)', test: r => Array.isArray(r.search?.titles) && (r.search?.titles as string[]).length >= 3 },
      { label: 'no restringe a una sola seniority', test: r => !Array.isArray(r.search?.seniorities) || (r.search?.seniorities as string[]).length !== 1 }] },
  { id: 'reintento-enriquecer', title: 'No repetir un enriquecimiento que ya falló', request: 'no encontro correo? ya, igual investigalo y preparame un correo para el',
    history: [{ request: 'investiga a carlos, el que guardamos de minera centinela, quiero escribirle', at: '2026-09-25T04:30:00Z',
      reply: 'El proveedor no encontró su correo. No inventé ninguno: puedo investigarlo igual o buscar otra persona de la misma empresa.',
      observations: [{ action: 'leads.search', input: 'Carlos', result: corpusRead('leads.search', 'carlos') }],
      actions: [{ kind: 'enrich_contact', label: 'Enriquecer contacto Carlos Ah***a (Minera Centinela)', outcome: 'ejecutada', result: { found: false, email: null } }] }],
    production: { run: 'df7ede82', latencySeconds: 50, scores: { comprension: 2, veracidad: 3, utilidad: 1, claridad: 3, friccion: 1 }, problem: 'Volvió a proponer el mismo enriquecimiento fallido e ignoró «igual investígalo».' },
    checks: [...CORPUS_COMMON_CHECKS, { label: 'no vuelve a proponer buscar el correo', test: r => r.proposal?.kind !== 'enrich_contact' },
      { label: 'propone investigar', test: r => r.proposal?.kind === 'start_research' }] },
  { id: 'informe-jefe', title: 'Informe para la jefatura', request: 'hazme un informe de como vamos con la prospeccion este mes pa mandarselo a mi jefe',
    production: { run: 'd6e3b7b1', latencySeconds: 113, scores: { comprension: 4, veracidad: 4, utilidad: 2, claridad: 3, friccion: 3 }, problem: 'Informe solo de métricas en cero, con el código «last_30_days» y jerga técnica.' },
    checks: [...CORPUS_COMMON_CHECKS, { label: 'entrega un documento', test: r => Boolean(r.document) },
      { label: 'incluye actividad y próximos pasos', test: r => /actividad/i.test(r.document?.content || '') && /próximos pasos/i.test(r.document?.content || '') },
      { label: 'usa actividad además de métricas', test: r => r.actions.some(a => ['leads.search', 'campaigns.list', 'app.context'].includes(a)) }] },
  { id: 'campana-no-guardado', title: 'Campaña a un correo que no es contacto guardado', request: 'crea la campaña de prueba de 3 correos para nicogun123@gmail.com con gmail, con los textos que te aprobé',
    history: [{ request: 'muéstrame 3 correos de prueba para nicogun123@gmail.com sobre AXIS antes de crear la campaña', at: '2026-09-25T13:05:00Z',
      reply: '**Correo 1 — Asunto: Revisión de antecedentes sin trámites manuales**\nHola,\nTe escribo por AXIS...\n\n**Correo 2 — Asunto: ¿Cuánto tiempo toma hoy revisar un postulante?**\nHola,\n...\n\n**Correo 3 — Asunto: ¿Lo revisamos en 15 minutos?**\nHola,\n...' }],
    production: { run: '02db31ea', latencySeconds: 129, scores: { comprension: 1, veracidad: 0, utilidad: 1, claridad: 1, friccion: 1 }, problem: 'Falla con «No se pudo completar la respuesta» (2 de 2 intentos) sin decir por qué.' },
    checks: [...CORPUS_COMMON_CHECKS, { label: 'explica que el correo debe estar guardado como contacto', test: r => /guard/i.test(r.reply) && /contacto/i.test(r.reply) }] },
  { id: 'agendar-reunion', title: 'Pedido fuera de alcance', request: 'agendame una reunion con carlos de minera centinela para el martes a las 10',
    production: { run: '0fb9915d', latencySeconds: 217, scores: { comprension: 4, veracidad: 5, utilidad: 2, claridad: 3, friccion: 2 }, problem: 'Dice que no puede y luego pregunta la zona horaria para algo que no hará.' },
    checks: [...CORPUS_COMMON_CHECKS, { label: 'dice que no agenda y ofrece la alternativa', test: r => /no puedo|no puede|no agendo|no tengo/i.test(r.reply) && /redact|mensaje|correo|invitaci/i.test(r.reply) },
      { label: 'no pregunta la zona horaria', test: r => !/zona horaria/i.test(r.reply) }] },
  { id: 'linkedin-seguimiento', title: 'Seguimientos de LinkedIn sin sincronizar', request: 'a quien le deberia hacer seguimiento por linkedin esta semana?',
    production: { run: '18436ca1', latencySeconds: 253, scores: { comprension: 4, veracidad: 4, utilidad: 1, claridad: 3, friccion: 1 }, problem: '«Completa el barrido» sin decir cómo ni ofrecer alternativa.' },
    checks: [...CORPUS_COMMON_CHECKS, { label: 'explica cómo sincronizar LinkedIn', test: r => /sincroniz|extensi/i.test(r.reply) }] },
  { id: 'vender-mas', title: 'Pedido vago', request: 'ayudame a vender mas, no se por donde partir',
    production: { run: '5aee709f', latencySeconds: 162, scores: { comprension: 4, veracidad: 4, utilidad: 2, claridad: 3, friccion: 2 }, problem: 'Consejo genérico y pregunta «qué vendes».' },
    checks: [...CORPUS_COMMON_CHECKS, { label: 'no pregunta qué vende el usuario', test: r => !/qué (?:producto|servicio|vendes|ofreces)/i.test(r.reply) },
      { label: 'aterriza en datos de la cuenta', test: r => /\d/.test(corpusShown(r)) }] },
  { id: 'ley-chile', title: 'Pregunta legal', request: 'oye y puedo mandarle correos a gente que no me ha dado permiso? que dice la ley en chile de eso',
    production: { run: '2b56981d', latencySeconds: 97, scores: { comprension: 5, veracidad: 4, utilidad: 4, claridad: 4, friccion: 4 }, problem: 'Buena, pero filtra «do_not_contact» y no ofrece revisar bajas antes de una campaña.' },
    checks: [...CORPUS_COMMON_CHECKS, { label: 'consulta el marco legal', test: r => r.actions.includes('compliance.law') },
      { label: 'aclara que no es asesoría legal', test: r => /asesor[ií]a legal/i.test(r.reply) }] },
];

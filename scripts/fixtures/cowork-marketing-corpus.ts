// Marketing corpus: requests a new ANTON.IA user would type to run email and
// LinkedIn outreach from Cowork, written from use cases (not copied from
// production). The account is small on purpose: 5 saved contacts, no campaigns
// and one email sent. Names are fictional and complete: masked names made the
// model guess surnames. No database, mailbox or provider is touched.
import { corpusRecommend } from './cowork-recommend-world';
import { coworkStarter } from '../../src/lib/cowork/starters';
import { coworkBlocksText, coworkVersionMessage, type CoworkEditedEmail } from '../../src/lib/cowork/blocks';
import { COWORK_FILE_NOTICE, coworkFileMissing, coworkFilePreview, coworkFilesByWords, coworkTablePreview, coworkTextPreview } from '../../src/lib/cowork/file-read';
import { coworkWithAttachments } from '../../src/lib/cowork/attachments';
import { coworkOfferMessage } from '../../src/lib/cowork/overview';
import { coworkSentPeriod } from '../../src/lib/cowork/sent-period';
import { CORPUS_COMMON_CHECKS, CORPUS_NOW, CORPUS_USER_CONTEXT, corpusShown, corpusWithEmailQuery, corpusWithLinkedinQuery, type CorpusCase, type CorpusTurnResult } from './cowork-conversation-corpus';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const MARKETING_LEAD = { marcela: id(101), felipe: id(102), andrea: id(103), rodrigo: id(104), camila: id(105) };

const contacts = [
  { id: MARKETING_LEAD.marcela, name: 'Marcela Rojas', title: 'Gerente de Personas', company: 'Sodexo Chile', email: 'mrojas@sodexo.cl',
    linkedin_url: 'https://www.linkedin.com/in/marcela-r', status: 'saved', created_at: '2026-09-20T14:00:00Z' },
  { id: MARKETING_LEAD.felipe, name: 'Felipe Muñoz', title: 'Jefe de Reclutamiento', company: 'Securitas Chile', email: 'fmunoz@securitas.cl',
    linkedin_url: 'https://www.linkedin.com/in/felipe-m', status: 'saved', created_at: '2026-09-19T15:30:00Z' },
  { id: MARKETING_LEAD.andrea, name: 'Andrea Vega', title: 'HR Business Partner', company: 'Falabella', email: null,
    linkedin_url: 'https://www.linkedin.com/in/andrea-v', status: 'saved', created_at: '2026-09-18T12:10:00Z' },
  { id: MARKETING_LEAD.rodrigo, name: 'Rodrigo Pino', title: 'Gerente de Operaciones', company: 'Transportes Andes', email: 'rpino@tandes.cl',
    linkedin_url: null, status: 'saved', created_at: '2026-09-17T10:00:00Z' },
  { id: MARKETING_LEAD.camila, name: 'Camila Fuentes', title: 'Analista de Selección', company: 'Adecco', email: 'cfuentes@adecco.cl',
    linkedin_url: 'https://www.linkedin.com/in/camila-f', status: 'saved', created_at: '2026-09-16T09:45:00Z' },
];
const PEOPLE_TEAMS = /rr\.?\s*hh|recursos humanos|personas|selecci|reclut|talento|\bhr\b|human/i;
const isPeopleTeam = (lead: typeof contacts[number]) => PEOPLE_TEAMS.test(lead.title);
const noCoverage = { gmail: null, outlook: null };

/** Marcela got the first email of a campaign six days ago and has not replied. */
const marcelaSent = { leadId: MARKETING_LEAD.marcela, name: 'Marcela Rojas', company: 'Sodexo Chile', channel: 'email',
  subject: 'Antecedentes laborales sin trámites manuales', sentAt: '2026-09-19T13:02:00Z', replied: false };

function read(action: string, input: string): unknown {
  if (action === 'leads.recommend') return corpusRecommend(contacts, new Set([MARKETING_LEAD.marcela]), input);
  const term = input.toLowerCase().trim();
  switch (action) {
    case 'leads.search': {
      const { withLinkedin, rest: withoutLinkedin } = corpusWithLinkedinQuery(term);
      const { withEmail, rest } = corpusWithEmailQuery(withoutLinkedin);
      const words = rest.split(/\s+/).filter(word => word.length > 2);
      const found = !rest ? contacts : contacts.filter(lead => PEOPLE_TEAMS.test(rest) ? isPeopleTeam(lead)
        : [lead.name, lead.title, lead.company, lead.email].some(value => words.some(word => String(value || '').toLowerCase().includes(word))));
      const items = found.filter(lead => (!withEmail || lead.email) && (!withLinkedin || lead.linkedin_url));
      return { items, returned: items.length, limit: withEmail || withLinkedin ? 25 : 20, scope: 'own_saved_contacts', truncated: false, partial: false,
        ...(withEmail ? { withEmailOnly: true } : {}), ...(withLinkedin ? { withLinkedinOnly: true } : {}) };
    }
    case 'leads.get':
      return { items: contacts.filter(lead => lead.id === input), returned: 1, limit: 1, scope: 'own_saved_contacts', truncated: false };
    case 'app.context':
      return { scope: 'organization_context', emailConnections: { google: true, outlook: false },
        counts: { leads: 5, contacted: 1, campaigns: 0, activeMissions: 0, openExceptions: 0 }, performance: null,
        offer: CORPUS_USER_CONTEXT.offer, offerSource: 'profile' };
    case 'profile.get':
      return { scope: 'own_profile', profile: { fullName: 'Nicolás Y.', jobTitle: 'Gerente Comercial', companyName: 'Yago SpA', companyDomain: 'yago.cl', email: 'ventas@yago.cl' }, signatures: [] };
    case 'message.context':
      return { configured: true, context: { defaultStyle: 'Cercano, claro y breve', trialOffer: null, approvedClaims: [], prohibitedTerms: ['gratis'], voiceExamples: [] } };
    case 'campaigns.list':
      return { scope: 'own', campaigns: [] };
    case 'campaigns.inbox':
      return { scope: 'own', items: [], truncated: false };
    case 'audience.analyze':
      return { scope: 'organization_stored_audience', coverage: 'complete', contactsTotal: 5, contactsWithEmail: 4, sectors: [
        { sector: 'Servicios de RR. HH. y outsourcing', contacts: 2, contacted: 0 }, { sector: 'Retail', contacts: 1, contacted: 0 },
        { sector: 'Servicios y seguridad', contacts: 1, contacted: 1 }, { sector: 'Transporte y logística', contacts: 1, contacted: 0 }] };
    case 'metrics.rates':
      return { scope: 'organization_metrics', coverage: noCoverage, limitation: 'Tasas por contacto con la cantidad de envíos sobre la que se calculan; null significa sin envíos, no cero.',
        last_7_days: { days: 7, sent: 1, rates: { reply: { unit: 'per_contact', value: 0, period: 'last_7_days', numerator: 0, denominator: 1 } } },
        last_30_days: { days: 30, sent: 1, rates: { reply: { unit: 'per_contact', value: 0, period: 'last_30_days', numerator: 0, denominator: 1 } } } };
    case 'contacted.search': {
      // A period («últimos 7 días») filters by send date, as the server does.
      const period = coworkSentPeriod(term);
      const rest = period ? period.rest : term;
      const since = period ? CORPUS_NOW.getTime() - period.days * 24 * 60 * 60 * 1000 : null;
      const inPeriod = since === null || Date.parse(marcelaSent.sentAt) >= since;
      const items = inPeriod && (!rest || /marcela|sodexo/.test(rest)) ? [marcelaSent] : [];
      return { items, limit: 20, scope: 'organization_contacted', returned: items.length, truncated: false,
        ...(period && since !== null ? { period: { days: period.days, since: new Date(since).toISOString() } } : {}),
        evidence: { source: 'application_contact_records', limitation: 'Lista de registros, no cola de respuestas pendientes confirmadas.', pendingStatus: 'needs_verification', mailboxCoverage: noCoverage } };
    }
    case 'contacted.timeline':
      return input === MARKETING_LEAD.marcela
        ? { scope: 'organization_contacted', lead: { id: MARKETING_LEAD.marcela, name: 'Marcela Rojas', company: 'Sodexo Chile' },
          events: [{ kind: 'sent', channel: 'email', subject: marcelaSent.subject, at: marcelaSent.sentAt }], replies: [], turn: 'unknown', mailboxCoverage: noCoverage }
        : { scope: 'organization_contacted', events: [], replies: [] };
    case 'replies.attention':
      return { scope: 'organization_replies', coverage: noCoverage, failures: [], automatic: [], items: [], truncated: false };
    case 'compliance.check':
      return { lead: { id: input }, verdict: input === MARKETING_LEAD.andrea ? 'block' : 'allow', reasons: input === MARKETING_LEAD.andrea ? ['missing_email'] : [] };
    case 'linkedin.quota':
      return { scope: 'own_linkedin_quota', pending: 2, sent: 5, limit: 100, windowDays: 7, allowed: true };
    case 'linkedin.network':
      return { scope: 'own_linkedin_network', peers: [], returned: 0, truncated: false,
        coverage: { lastCompletedAt: '2026-09-24T22:00:00Z', hasMore: false, observedCount: 180, complete: true } };
    case 'linkedin.followups':
      return { scope: 'own_linkedin_followups', items: [], returned: 0 };
    case 'linkedin.jobs':
      return { scope: 'own_linkedin_jobs', items: [], returned: 0 };
    case 'research.get_existing':
      return { scope: 'own_research', availability: 'none' };
    case 'exceptions.list':
    case 'missions.list':
      return { scope: 'own', items: [], truncated: false };
    default:
      return { scope: 'not_in_corpus', items: [], note: 'Sin datos en este corpus.' };
  }
}

const world = { read, savedEmails: contacts.map(lead => lead.email).filter((email): email is string => Boolean(email)) };
/** The same account, with Marcela's email sent on 12 August: 44 days before the corpus date, not six. */
const OLD_SENT_AT = '2026-08-12T13:02:00Z';
const oldSendWorld = { ...world, read: (action: string, input: string) => JSON.parse(JSON.stringify(read(action, input) ?? null).split(marcelaSent.sentAt).join(OLD_SENT_AT)) };
export const marketingRead = read;

const text = (result: CorpusTurnResult) => [corpusShown(result), result.note || '', result.document?.content || ''].join('\n');
const campaign = (result: CorpusTurnResult) => result.proposal?.campaign as { emails?: string[]; messages?: Array<{ subject: string; body: string }> } | undefined;
const PLACEHOLDER = /\[(?:tu |su )?(?:nombre|empresa|cargo|firma|name)[^\]]*\]/i;
const PEOPLE_EMAILS = ['mrojas@sodexo.cl', 'fmunoz@securitas.cl', 'cfuentes@adecco.cl'];
const lastLine = (reply: string) => reply.split('\n').filter(line => line.trim()).pop() || '';
/** Industries a buyer of AXIS may be in. */
const INDUSTRY = /miner|retail|comercio|construc|seguridad|log[íi]stica|transporte|salud|cl[íi]nica|outsourcing|servicios|manufactur|industria|agr[íi]col|agro|energ|banca|financ|educaci|call center|contact center|alimentos|miner[íi]a/i;
/** Drops sentences that deny something («No agregué prueba gratuita»): a denial is not an offer. */
const withoutDenials = (content: string) => content.split(/(?<=[.!?\n])/).filter(sentence => !/\bno\b|\bni\b|\bsin\b(?! costo)/i.test(sentence)).join('');

/** The emails themselves: the cards, or the document when they came as one. */
const emails = (result: CorpusTurnResult) => [coworkBlocksText((result.blocks || []).filter(block => block.type === 'email_draft' || block.type === 'sequence')),
  result.document?.content || ''].join('\n');

/** From the first greeting to the signature: the email itself, without the comments around it. */
const rewrittenEmail = (result: CorpusTurnResult) => {
  const card = (result.blocks || []).find(block => block.type === 'email_draft');
  const all = card?.type === 'email_draft' ? card.body : result.document?.content || result.reply;
  const start = all.search(/\bHola\b/i);
  if (start < 0) return all;
  const body = all.slice(start);
  // The signature is the last «Nicolás»: an opening «Soy Nicolás, de Yago» is part of the email.
  const signature = [...body.matchAll(/Nicol[aá]s/g)].pop()?.index ?? -1;
  return signature < 0 ? body : body.slice(0, signature);
};

export const MARKETING_CORPUS: CorpusCase[] = [
  { id: 'mkt-que-puedes-hacer', title: 'Usuario nuevo pregunta qué hace Cowork', request: 'hola! soy nuevo aca, que puedes hacer por mi?', world,
    origin: 'Primera conversación de alguien que no conoce Cowork: debe entender en segundos qué puede pedir, con su cuenta real como ejemplo.',
    checks: [...CORPUS_COMMON_CHECKS,
      { label: 'menciona correos o campañas y LinkedIn', test: r => /correo|campa/i.test(r.reply) && /linkedin/i.test(r.reply) },
      { label: 'breve: 12 líneas como máximo', test: r => r.reply.split('\n').filter(line => line.trim()).length <= 12 },
      { label: 'no pregunta qué vende el usuario', test: r => !/qué (?:producto|servicio|vendes|ofreces?)/i.test(r.reply) },
      { label: 'nombra su oferta (AXIS)', test: r => /axis/i.test(r.reply) },
      { label: 'no dice lo que no ve', test: r => !/\bno (?:veo|tengo a la vista|aparece)/i.test(r.reply) }] },
  // The home's «Cuéntame qué vendes» card (V7) sends this message: Cowork proposes saving it in the profile.
  { id: 'guardar-oferta', title: 'Guardar lo que vende desde la tarjeta del inicio', world,
    request: coworkOfferMessage('revisión de antecedentes laborales en minutos, para equipos de RR. HH. en Chile', 'https://yago.cl'),
    origin: 'Una cuenta sin oferta la escribe en la tarjeta «Cuéntame qué vendes»: Cowork propone guardarla en el perfil, con sus palabras y sin inventar.',
    checks: [...CORPUS_COMMON_CHECKS,
      { label: 'consulta el perfil antes de proponer', test: r => (r.reads || []).some(item => item.action === 'profile.get') },
      { label: 'propone guardar la oferta en el perfil', test: r => r.proposal?.kind === 'profile_update'
        && /antecedentes/i.test(String(r.proposal.profile?.valueProposition || '')) },
      { label: 'guarda el sitio que dio', test: r => r.proposal?.kind !== 'profile_update' || /yago\.cl/.test(String(r.proposal.profile?.website || '')) },
      { label: 'no agrega cifras ni precios que el usuario no dijo', test: r => !/\d/.test(String(r.proposal?.profile?.valueProposition || '')) },
      { label: 'no cambia la firma ni datos que no pidió', test: r => !['signature', 'name', 'role', 'companyName', 'sector'].some(key => r.proposal?.profile?.[key] !== undefined) }] },
  { id: 'mkt-campana-rrhh', title: 'Correo a los contactos de un área', request: 'quiero mandarle un correo a mis contactos de rrhh ofreciendo axis', world,
    origin: 'Pedido típico de mailing: un segmento guardado y la oferta. Debe encontrar a quiénes, usar la oferta y dejar el correo o la campaña para aprobar.',
    checks: [...CORPUS_COMMON_CHECKS,
      { label: 'busca a los contactos del área', test: r => r.actions.includes('leads.search') || r.actions.includes('audience.analyze') },
      { label: 'propone la campaña o muestra el correo', test: r => r.proposal?.kind === 'campaign_create' || /asunto/i.test(text(r)) },
      { label: 'la campaña solo incluye contactos de RR. HH. con correo', test: r => !campaign(r)
        || Boolean(campaign(r)?.emails?.length && campaign(r)!.emails!.every(email => PEOPLE_EMAILS.includes(email))) },
      { label: 'sin datos de relleno entre corchetes', test: r => !PLACEHOLDER.test(text(r)) && !(campaign(r)?.messages || []).some(message => PLACEHOLDER.test(message.body)) },
      { label: 'el correo que muestra va firmado con el nombre del perfil', test: r => Boolean(r.proposal) || !/asunto/i.test(text(r)) || /Nicol[aá]s/.test(text(r)) }] },
  { id: 'mkt-secuencia', title: 'Secuencia de 3 correos', request: 'armame una secuencia de 3 correos para ofrecer axis a gerentes de personas, tono cercano', world,
    origin: 'Redactar una secuencia lista para usar: tres correos distintos, con asunto, firma real y sin prometer lo que no está aprobado.',
    checks: [...CORPUS_COMMON_CHECKS,
      { label: 'entrega los 3 correos en una secuencia o un documento', test: r => (r.blocks || []).some(block => block.type === 'sequence' && block.steps.length >= 3)
        || (Boolean(r.document) && ((r.document?.content || '').match(/asunto/gi) || []).length >= 3) },
      { label: 'sin datos de relleno entre corchetes', test: r => !PLACEHOLDER.test(text(r)) },
      // Only the emails count: the reply or a scope note may say that no free trial was offered.
      { label: 'no ofrece prueba gratuita sin oferta aprobada', test: r => !/prueba gratuita|gratis|sin costo/i.test(withoutDenials(emails(r))) },
      { label: 'firma con el nombre del perfil', test: r => /Nicol[aá]s/.test(emails(r)) },
      { label: 'la secuencia va como tarjeta', test: r => (r.blocks || []).some(block => block.type === 'sequence') }] },
  { id: 'mkt-linkedin-mensaje', title: 'Mensaje de LinkedIn a un contacto', request: 'escribele a marcela por linkedin, algo corto presentandome', world,
    origin: 'LinkedIn desde el chat: identificar a la persona y dejar el mensaje en cola para aprobar, firmado con el nombre real.',
    checks: [...CORPUS_COMMON_CHECKS,
      { label: 'propone el mensaje de LinkedIn', test: r => r.proposal?.kind === 'linkedin_message' },
      { label: 'el mensaje es breve y sin relleno', test: r => !r.proposal?.linkedinMessage
        || (r.proposal.linkedinMessage.length <= 600 && !PLACEHOLDER.test(r.proposal.linkedinMessage)) },
      { label: 'el mensaje lleva el nombre real del usuario', test: r => !r.proposal?.linkedinMessage || /Nicol[aá]s/.test(r.proposal.linkedinMessage) }] },
  // A contact picked with «@» in the composer (V6): its ID travels at the end, so Cowork reads it without searching by name.
  { id: 'mencion-linkedin', title: 'Mensaje de LinkedIn a un contacto elegido con @', world,
    request: `escribele a @Marcela Rojas por linkedin, algo corto presentandome\n\n(ID de Marcela Rojas: ${MARKETING_LEAD.marcela})`,
    origin: 'La mención ya dice quién es: Cowork la lee por su ID (sin buscar por nombre ni preguntar cuál Marcela) y deja el mensaje para aprobar.',
    checks: [...CORPUS_COMMON_CHECKS,
      { label: 'lee el contacto por su ID', test: r => (r.reads || []).some(item => item.action === 'leads.get' && item.input === MARKETING_LEAD.marcela) },
      { label: 'no lo busca por nombre', test: r => !(r.reads || []).some(item => item.action === 'leads.search' && /marcela/i.test(item.input)) },
      { label: 'propone el mensaje de LinkedIn a Marcela', test: r => r.proposal?.kind === 'linkedin_message' && /Marcela/.test(r.proposal.linkedinMessage || '') },
      { label: 'el ID no aparece en la respuesta', test: r => !(r.note || r.reply).includes(MARKETING_LEAD.marcela) }] },
  { id: 'mkt-linkedin-invitar', title: 'Invitar a un contacto en LinkedIn', request: 'invita a felipe de securitas a mi red de linkedin', world,
    origin: 'La invitación exige revisar el cupo semanal antes de proponerla.',
    checks: [...CORPUS_COMMON_CHECKS,
      { label: 'revisa el cupo de LinkedIn', test: r => r.actions.includes('linkedin.quota') },
      { label: 'propone la invitación', test: r => r.proposal?.kind === 'linkedin_invite' }] },
  { id: 'mkt-a-quien-escribo', title: 'A quién escribir hoy', request: 'a quien le escribo hoy? tengo poco tiempo', world,
    origin: 'Priorizar con datos: contactos con correo que aún no recibieron nada, con el motivo y el paso siguiente.',
    checks: [...CORPUS_COMMON_CHECKS,
      { label: 'nombra al menos dos contactos concretos', test: r => ['Marcela', 'Felipe', 'Andrea', 'Rodrigo', 'Camila'].filter(name => text(r).includes(name)).length >= 2 },
      { label: 'no recomienda escribirle a Andrea por correo (no tiene)', test: r => !/andrea[^.\n]*(?:correo|email)[^.\n]*(?:escrib|envi|mand)/i.test(r.reply) || /sin correo|no tiene correo/i.test(r.reply) }] },
  { id: 'mkt-mejorar-correo', title: 'Mejorar un correo del usuario', world,
    request: 'mejorame este correo: "Hola, somos Yago y tenemos un software buenisimo para RRHH, es el mejor del mercado y te ahorra 80% del tiempo. Agendemos."',
    origin: 'Reescribir un texto del usuario en el chat, sin conservar promesas que no tienen respaldo.',
    checks: [...CORPUS_COMMON_CHECKS,
      { label: 'entrega la versión mejorada', test: r => /hola/i.test(text(r)) && text(r).length > 200 },
      // Only the rewritten email counts: the explanation may name what was removed.
      { label: 'quita promesas sin respaldo', test: r => !/el mejor del mercado|80 ?%/i.test(rewrittenEmail(r)) },
      { label: 'lo concreta con la oferta real (AXIS)', test: r => /AXIS|antecedentes/i.test(text(r)) },
      { label: 'firma con el nombre del perfil', test: r => /Nicol[aá]s/.test(text(r)) },
      { label: 'el correo va como tarjeta', test: r => (r.blocks || []).some(block => block.type === 'email_draft') }] },
  { id: 'mkt-busqueda-y-campana', title: 'Pedido de varios pasos', world,
    request: 'busca 10 gerentes de rrhh en empresas de retail en santiago y despues armame una campaña para ellos',
    origin: 'Dos pasos encadenados: el primero es la búsqueda y la nota debe explicar qué sigue después de aprobarla.',
    checks: [...CORPUS_COMMON_CHECKS,
      // With long tasks on (COWORK_TASKS_ENABLED, Plan 13, 4c) a request of several steps is one plan approved once, starting with the search.
      { label: 'propone la búsqueda (sola o como primer paso de una tarea)', test: r => Boolean(r.search)
        || (r.proposal?.kind === 'task_plan' && /busc/i.test(JSON.stringify((r.proposal as { task?: unknown }).task ?? ''))) },
      { label: 'respeta el tamaño pedido (10)', test: r => r.search ? Number(r.search.limit) === 10
        : r.proposal?.kind !== 'task_plan' || /\b10\b/.test(JSON.stringify((r.proposal as { task?: unknown }).task ?? '')) },
      { label: 'explica que la campaña viene después', test: r => /campa/i.test(r.note || r.reply) }] },
  { id: 'mkt-necesito-clientes', title: 'Pedido vago con faltas de ortografía', request: 'nesesito mas clientes pa axis, ayuda', world,
    origin: 'Escritura informal y vaga: debe entender igual, aterrizar en la cuenta y proponer el primer paso.',
    checks: [...CORPUS_COMMON_CHECKS,
      { label: 'no pregunta qué vende el usuario', test: r => !/qué (?:producto|servicio|vendes|ofreces)/i.test(text(r)) },
      { label: 'aterriza en datos de la cuenta', test: r => /\d/.test(r.note || r.reply) || /Marcela|Felipe|Camila|Rodrigo|Andrea/.test(text(r)) },
      // Four contacts already have an email and three were never contacted: writing to them comes before
      // spending a credit on the one without an email or searching for new people.
      { label: 'parte por quienes ya tienen correo', test: r => !r.search && r.proposal?.kind !== 'enrich_contact' && r.proposal?.kind !== 'enrich_batch' }] },
  { id: 'mkt-resultado-campana', title: 'Resultados de una campaña que no existe', request: 'como le fue a mi campaña?', world,
    origin: 'No hay campañas: debe decirlo sin rodeos y ofrecer crear la primera con los contactos que ya tienen correo.',
    checks: [...CORPUS_COMMON_CHECKS,
      { label: 'revisa las campañas', test: r => r.actions.includes('campaigns.list') },
      { label: 'dice que aún no hay campañas', test: r => /no (?:tienes|hay|aparece|encontr|veo)[^.\n]*campa|ninguna campa|sin campa|0 campa|aún no (?:tienes|hay)[^.\n]*campa/i.test(r.note || r.reply) },
      { label: 'ofrece crear la primera campaña', test: r => r.proposal?.kind === 'campaign_create'
        || [lastLine(r.reply), ...(r.suggestions || []).map(chip => chip.message)].some(line => /(?:cre|arm|prepar)\w*[^.?\n]*campa/i.test(line)) }] },
  { id: 'mkt-seguimiento', title: 'Seguimiento a quien no respondió', request: 'marcela no me respondio el correo, que le mando ahora?', world,
    origin: 'Seguimiento con un ángulo nuevo, sin culpar ni anunciar cierre, apoyado en lo que se envió.',
    checks: [...CORPUS_COMMON_CHECKS,
      { label: 'revisa lo que se le envió', test: r => r.actions.some(action => ['contacted.search', 'contacted.timeline', 'leads.search'].includes(action)) },
      { label: 'redacta el seguimiento', test: r => /asunto/i.test(text(r)) || r.proposal?.kind === 'linkedin_message' || r.proposal?.kind === 'campaign_create' },
      { label: 'no reprocha el silencio ni anuncia cierre', test: r => !/no (?:me )?respondiste|última vez|ultimo mensaje|último mensaje|cierro (?:el|este) hilo/i.test(text(r)) },
      { label: 'firma con el nombre del perfil', test: r => r.proposal?.kind === 'linkedin_message' || /Nicol[aá]s/.test(text(r)) },
      { label: 'el seguimiento va como tarjeta', test: r => Boolean(r.proposal) || (r.blocks || []).some(block => block.type === 'email_draft') }] },
  { id: 'mkt-seguimiento-antiguo', title: 'Seguimiento de un correo de hace semanas', request: 'marcela no me respondio el correo, que le mando ahora?', world: oldSendWorld,
    origin: 'El mismo seguimiento, con el primer correo enviado hace 44 días: el texto dice el plazo que calza, no «hace unos días».',
    checks: [...CORPUS_COMMON_CHECKS,
      { label: 'redacta el seguimiento', test: r => /asunto/i.test(text(r)) || r.proposal?.kind === 'campaign_create' },
      { label: 'no dice que el correo salió hace unos días', test: r => !/hace (?:unos|pocos) d[ií]as|la semana pasada|hace una semana/i.test(text(r)) }] },
  // A datum only the person knows, with few possible answers (V5): Cowork asks with options instead of guessing or making them type.
  { id: 'opciones-industria', title: 'Prospectar en otra industria sin decir cuál', world,
    request: 'quiero buscar prospectos nuevos en otra industria para axis, ayudame',
    origin: 'La industria nueva la decide el usuario: Cowork no la adivina ni busca a ciegas; pregunta cuál, con opciones que encajan con lo que vende.',
    checks: [...CORPUS_COMMON_CHECKS,
      { label: 'pregunta con opciones', test: r => (r.choices?.options.length ?? 0) >= 2 },
      { label: 'las opciones son industrias', test: r => (r.choices?.options || []).filter(option => INDUSTRY.test(option)).length >= 2 },
      { label: 'no busca sin saber la industria', test: r => !r.search && !r.proposal }] },
];

/** Contacts with an email who never received anything: Marcela already got one. */
const NEVER_CONTACTED_EMAILS = ['fmunoz@securitas.cl', 'rpino@tandes.cl', 'cfuentes@adecco.cl'];
const SAMPLE_EMAIL = 'Hola, les escribo de Yago. Tenemos AXIS, una solución para RRHH que ayuda mucho. Nos encantaría mostrarles una demo cuando puedan. Saludos.';
/** Marcela may be named only as someone who already got an email. */
const leavesMarcelaOut = (reply: string) => !/Marcela/.test(reply)
  || /(?:exclu\w*|dej[ée] fuera|queda fuera|no incluy\w*)[^.\n]{0,20}Marcela|Marcela(?: Rojas)?[^.\n,]{0,40}(?:ya (?:le |recibi|tiene un)|contactad|envío registrado|enviad|queda fuera)/i.test(reply);

/** Every button on the Cowork home (src/lib/cowork/starters.ts), sent as is: each must lead to a good first turn. */
export const STARTER_CORPUS: CorpusCase[] = [
  { id: 'inicio-escribir', title: 'Inicio: escribir a mis contactos', request: coworkStarter('escribir').prompt, world,
    origin: 'Botón de inicio. El correo listo y firmado, solo para quienes tienen correo y nunca recibieron nada.',
    checks: [...CORPUS_COMMON_CHECKS,
      { label: 'revisa sus contactos y lo que ya envió', test: r => r.actions.includes('leads.search') && r.actions.some(action => ['contacted.search', 'contacted.timeline'].includes(action)) },
      { label: 'muestra el correo o propone la campaña', test: r => r.proposal?.kind === 'campaign_create' || /asunto/i.test(text(r)) },
      { label: 'solo para quienes nunca recibieron nada', test: r => campaign(r)
        ? Boolean(campaign(r)?.emails?.length && campaign(r)!.emails!.every(email => NEVER_CONTACTED_EMAILS.includes(email)))
        : leavesMarcelaOut(r.reply) },
      { label: 'el correo va firmado con el nombre del perfil', test: r => Boolean(r.proposal) || /Nicol[aá]s/.test(text(r)) },
      { label: 'sin datos de relleno entre corchetes', test: r => !PLACEHOLDER.test(text(r)) }] },
  { id: 'inicio-a-quien', title: 'Inicio: a quién le escribo hoy', request: coworkStarter('a-quien').prompt, world,
    origin: 'Botón de inicio. Nombres concretos con su motivo y el paso siguiente.',
    checks: [...CORPUS_COMMON_CHECKS,
      { label: 'nombra al menos dos contactos concretos', test: r => ['Marcela', 'Felipe', 'Andrea', 'Rodrigo', 'Camila'].filter(name => text(r).includes(name)).length >= 2 },
      { label: 'no recomienda escribirle a Andrea por correo (no tiene)', test: r => !/andrea[^.\n]*(?:correo|email)[^.\n]*(?:escrib|envi|mand)/i.test(r.reply) || /sin correo|no tiene correo/i.test(r.reply) }] },
  { id: 'inicio-linkedin', title: 'Inicio: invitar por LinkedIn', request: coworkStarter('linkedin').prompt, world,
    origin: 'Botón de inicio. Revisar el cupo y elegir entre quienes tienen perfil de LinkedIn guardado.',
    checks: [...CORPUS_COMMON_CHECKS,
      { label: 'revisa el cupo de LinkedIn', test: r => r.actions.includes('linkedin.quota') },
      { label: 'propone la invitación o nombra a quién invitar', test: r => r.proposal?.kind === 'linkedin_invite'
        || ['Marcela', 'Felipe', 'Andrea', 'Camila'].some(name => r.reply.includes(name)) },
      { label: 'no propone invitar a Rodrigo (no tiene LinkedIn)', test: r => r.proposal?.targetId !== MARKETING_LEAD.rodrigo
        && !/invit\w*[^.\n?]*Rodrigo/i.test(lastLine(r.reply)) }] },
  { id: 'inicio-mejorar', title: 'Inicio: mejorar un correo', world,
    request: coworkStarter('mejorar').prompt.replace(/\[[^\]]+\]/, `"${SAMPLE_EMAIL}"`),
    origin: 'Plantilla de inicio: la persona pega su correo en el lugar marcado. La versión nueva va concreta y firmada.',
    checks: [...CORPUS_COMMON_CHECKS,
      { label: 'entrega la versión mejorada', test: r => /hola/i.test(rewrittenEmail(r)) && text(r).length > 150 },
      { label: 'lo concreta con la oferta real (antecedentes)', test: r => /antecedentes|poder judicial|pjud/i.test(rewrittenEmail(r)) },
      { label: 'firma con el nombre del perfil', test: r => /Nicol[aá]s/.test(text(r)) },
      { label: 'sin datos de relleno entre corchetes', test: r => !PLACEHOLDER.test(text(r)) }] },
  { id: 'inicio-prospectos', title: 'Inicio: buscar prospectos nuevos', request: coworkStarter('prospectos').prompt, world,
    origin: 'Botón de inicio sin cargos ni rubro: los criterios salen de la oferta del usuario.',
    checks: [...CORPUS_COMMON_CHECKS,
      { label: 'propone la búsqueda', test: r => Boolean(r.search) },
      { label: 'respeta el tamaño pedido (10)', test: r => !r.search || Number(r.search.limit) === 10 },
      { label: 'apunta a quien compra la oferta (RR. HH.)', test: r => !r.search
        || ((r.search.titles as string[] | undefined) || []).some(title => PEOPLE_TEAMS.test(title)) },
      { label: 'busca en Chile', test: r => !r.search
        || [...((r.search.locations as string[] | undefined) || []), ...((r.search.companyLocations as string[] | undefined) || [])].some(place => /chile|santiago/i.test(place)) },
      { label: 'no pregunta qué vende el usuario', test: r => !/qué (?:producto|servicio|vendes|ofreces)/i.test(text(r)) }] },
  { id: 'inicio-como-voy', title: 'Inicio: cómo voy', request: coworkStarter('como-voy').prompt, world,
    origin: 'Botón de inicio con una cuenta que recién empieza: los números reales, aunque sean chicos, y el paso que los mueve.',
    checks: [...CORPUS_COMMON_CHECKS,
      { label: 'consulta resultados', test: r => r.actions.some(action => action.startsWith('metrics.') || ['campaigns.list', 'contacted.search'].includes(action)) },
      { label: 'da los números (1 correo enviado)', test: r => /\b1\b|\bun (?:solo )?(?:correo|envío)|\buna? sola?\b/i.test(r.reply) }] },
];

/** A sequence the person edited in the panel, and what Cowork does with their
 * exact text: a campaign carries it word for word, «usar» keeps it unrewritten. */
const EDITED_SEQUENCE = { type: 'sequence' as const, title: 'Secuencia AXIS para RR. HH.', steps: [
  { day: 1, subject: 'Antecedentes laborales en minutos', body: 'Hola,\nEn Yago automatizamos la consulta de antecedentes laborales en el Poder Judicial con AXIS.\n¿Lo vemos 15 minutos esta semana?\nNicolás Y.' },
  { day: 4, subject: '¿Cuánto tarda hoy una revisión?', body: 'Hola,\nQuería saber cuánto les toma hoy revisar los antecedentes de un postulante.\nNicolás Y.' },
] };
export const EDITED_STEPS: CoworkEditedEmail[] = [
  { day: 1, subject: 'Antecedentes en minutos, no en días', body: 'Hola,\nCon AXIS revisas antecedentes laborales de postulantes en el Poder Judicial en minutos.\n¿Te muestro cómo en 15 minutos?\nNicolás Y.' },
  { day: 4, subject: '¿Cuánto tarda hoy una revisión?', body: 'Hola,\nQuería saber cuánto les toma hoy revisar los antecedentes de un postulante. Si es más de un día, AXIS te puede ayudar.\nNicolás Y.' },
];
const SEQUENCE_TURN = { request: 'armame una secuencia de 2 correos para mis contactos de rrhh que aun no contacto', at: '2026-09-26T13:00:00Z',
  reply: 'Te dejé la secuencia de 2 correos para Felipe (Securitas) y Camila (Adecco), que tienen correo y aún no reciben nada. Marcela ya recibió uno y Andrea no tiene correo.\n\n¿La convierto en una campaña pausada para Felipe y Camila?',
  observations: [{ action: 'leads.search', input: 'RR. HH.', result: read('leads.search', 'RR. HH.') }] };
const USE_REQUEST = coworkVersionMessage(EDITED_SEQUENCE, EDITED_STEPS, 'use', true);
const plain = (value: string) => value.replace(/\s+/g, ' ').trim();
/** The campaign carries the person's subjects and bodies, in order, untouched. */
const exactCampaign = (result: CorpusTurnResult) => {
  const messages = campaign(result)?.messages || [];
  return messages.length === EDITED_STEPS.length
    && messages.every((message, index) => plain(message.subject) === plain(EDITED_STEPS[index].subject) && plain(message.body) === plain(EDITED_STEPS[index].body));
};
/** A card with the emails, if any, shows the person's version and not a rewrite. */
const keptVersion = (result: CorpusTurnResult) => (result.blocks || []).every(block => block.type !== 'sequence' && block.type !== 'email_draft'
  || (block.type === 'sequence' ? block.steps : [block]).every((step, index) => plain(step.body) === plain(EDITED_STEPS[index]?.body || '')));
const onlyNewPeopleContacts = (result: CorpusTurnResult) => !campaign(result)
  || Boolean(campaign(result)?.emails?.length && campaign(result)!.emails!.every(email => ['fmunoz@securitas.cl', 'cfuentes@adecco.cl'].includes(email)));

export const EDIT_CORPUS: CorpusCase[] = [
  { id: 'editar-campana', title: 'Campaña con la secuencia que el usuario editó', world, history: [SEQUENCE_TURN],
    request: coworkVersionMessage(EDITED_SEQUENCE, EDITED_STEPS, 'campaign', true),
    origin: 'El usuario editó la secuencia en el panel y tocó «Crear campaña con esta versión»: la campaña lleva su texto exacto.',
    checks: [...CORPUS_COMMON_CHECKS,
      { label: 'propone la campaña', test: r => r.proposal?.kind === 'campaign_create' },
      { label: 'la campaña lleva el texto exacto del usuario', test: exactCampaign },
      { label: 'solo Felipe y Camila (RR. HH., con correo y sin envíos)', test: onlyNewPeopleContacts }] },
  { id: 'editar-usar', title: 'Usar la versión editada', world, history: [SEQUENCE_TURN], request: USE_REQUEST,
    origin: 'El usuario tocó «Usar esta versión»: Cowork la toma tal cual, sin mejorarla, y pregunta el siguiente paso.',
    checks: [...CORPUS_COMMON_CHECKS,
      { label: 'no propone nada todavía', test: r => !r.proposal && !r.search },
      { label: 'no reescribe la versión del usuario', test: r => keptVersion(r) && !r.document }] },
  { id: 'editar-luego-crear', title: 'Crear la campaña después de fijar la versión', world, request: 'sí, créala',
    history: [SEQUENCE_TURN, { request: USE_REQUEST, at: '2026-09-26T13:05:00Z',
      reply: 'Listo: desde ahora uso tu versión tal cual.\n\n¿Creo la campaña pausada con ella para Felipe y Camila?' }],
    origin: 'La versión se fijó un turno antes; «créala» debe llevar ese texto, no uno nuevo.',
    checks: [...CORPUS_COMMON_CHECKS,
      { label: 'propone la campaña', test: r => r.proposal?.kind === 'campaign_create' },
      { label: 'la campaña lleva el texto exacto del usuario', test: exactCampaign },
      { label: 'solo Felipe y Camila (RR. HH., con correo y sin envíos)', test: onlyNewPeopleContacts }] },
];

/** Files the person uploaded: the attendee list of an HR fair (8 people, 6 with an email, Marcela
 * and Camila already saved), an Excel of prospects (two sheets) and a PDF brief. The Excel and the
 * PDF arrive as the server opens them (file-binary.ts): the same shapes as a CSV and a text. */
const UPLOAD_RUN = id(201);
export const FAIR_CSV = [
  'Nombre;Empresa;Cargo;Correo',
  'Marcela Rojas;Sodexo Chile;Gerente de Personas;mrojas@sodexo.cl',
  'Camila Fuentes;Adecco;Analista de Selección;cfuentes@adecco.cl',
  'Tomás Riquelme;Walmart Chile;Jefe de Reclutamiento;triquelme@walmart.cl',
  'Daniela Soto;Cencosud;HR Business Partner;dsoto@cencosud.cl',
  'Ignacio Paredes;ISS Chile;Gerente de RR. HH.;',
  'Valentina Lagos;Manpower;Consultora de Selección;vlagos@manpower.cl',
  'Andrés Pizarro;Sodimac;Jefe de Personas;apizarro@sodimac.cl',
  'Francisca Mella;Randstad;Analista de Talento;',
].join('\n');
const PROSPECT_ROWS = [
  ['Paula Herrera', 'Entel', 'Gerente de Personas', 'pherrera@entel.cl', 'Nuevo'],
  ['Ricardo Salinas', 'Codelco', 'Jefe de Selección', 'rsalinas@codelco.cl', 'Nuevo'],
  ['Javiera Bravo', 'BCI', 'Analista de Reclutamiento', 'jbravo@bci.cl', 'Nuevo'],
  ['Matías Contreras', 'LATAM', 'Gerente de RR. HH.', '', 'Nuevo'],
  ['Constanza Vidal', 'Enel', 'HR Business Partner', 'cvidal@enel.com', 'Nuevo'],
  ['Sebastián Ortiz', 'Copec', 'Jefe de Personas', '', 'Nuevo'],
];
export const PROSPECTS_PREVIEW = { ...coworkTablePreview(['Nombre', 'Empresa', 'Cargo', 'Correo', 'Estado'], PROSPECT_ROWS, PROSPECT_ROWS.length),
  sheet: 'Prospectos', sheets: [{ name: 'Prospectos', rows: PROSPECT_ROWS.length }, { name: 'Descartados', rows: 2 }] };
const BRIEF_TEXT = [
  'Brief comercial AXIS · septiembre 2026',
  'AXIS automatiza las consultas judiciales en el PJUD para empresas que contratan personal de forma masiva: revisa antecedentes de postulantes en minutos en vez de días.',
  'Segmento prioritario: equipos de RR. HH., selección y outsourcing de más de 200 personas, y minería.',
  'Oferta: demostración de 15 minutos con un caso real del cargo que la empresa esté cubriendo. No hay prueba gratuita aprobada.',
  'Mensaje clave: menos tiempo por postulante y un registro de cada consulta. No prometer plazos legales.',
].join('\n\n');
export const BRIEF_PREVIEW = { ...coworkTextPreview(BRIEF_TEXT), pages: { read: 2, total: 2 } };
const UPLOADS = [
  { name: 'asistentes-feria-rrhh.csv', runId: UPLOAD_RUN, size: FAIR_CSV.length, updatedAt: '2026-09-26T15:00:00Z' },
  { name: 'prospectos.xlsx', runId: UPLOAD_RUN, size: 20480, updatedAt: '2026-09-25T10:00:00Z' },
  { name: 'brief-axis.pdf', runId: UPLOAD_RUN, size: 84210, updatedAt: '2026-09-27T09:00:00Z' },
];
function filesRead(action: string, input: string): unknown {
  if (action === 'files.list') return { scope: 'own_uploads', files: UPLOADS };
  if (action !== 'files.read') return read(action, input);
  const asked = input.trim().toLowerCase();
  const byWords = coworkFilesByWords(asked, UPLOADS.map(upload => upload.name));
  const file = UPLOADS.find(upload => upload.name === asked) || (byWords.length === 1 ? UPLOADS.find(upload => upload.name === byWords[0]) : undefined);
  if (!file) return coworkFileMissing(asked, UPLOADS.map(upload => upload.name), byWords);
  const name = file.name;
  const base = { scope: 'own_uploads', found: true, name, runId: file.runId, size: file.size };
  if (name.endsWith('.xlsx')) return { ...base, ...PROSPECTS_PREVIEW, notice: COWORK_FILE_NOTICE };
  if (name.endsWith('.pdf')) return { ...base, ...BRIEF_PREVIEW, notice: COWORK_FILE_NOTICE };
  return { ...base, ...coworkFilePreview(name, FAIR_CSV), notice: COWORK_FILE_NOTICE };
}
const filesWorld = { ...world, read: filesRead };
const FAIR_PEOPLE = ['Marcela', 'Camila', 'Tomás', 'Daniela', 'Ignacio', 'Valentina', 'Andrés', 'Francisca'];
const PROSPECT_PEOPLE = ['Paula', 'Ricardo', 'Javiera', 'Matías', 'Constanza', 'Sebastián'];
const SAVED_EMAILS = contacts.map(lead => lead.email).filter(Boolean);

export const FILE_CORPUS: CorpusCase[] = [
  { id: 'archivo-que-trae', title: 'Qué trae un archivo subido', world: filesWorld,
    request: 'te subi la lista de asistentes de la feria de rrhh, que trae?',
    origin: 'El usuario subió un CSV y pregunta por él: Cowork lo lee sin ejecutar código y dice qué trae.',
    checks: [...CORPUS_COMMON_CHECKS,
      { label: 'lee el archivo', test: r => r.actions.includes('files.read') },
      { label: 'dice cuántas personas trae (8)', test: r => /\b8\b|\bocho\b/i.test(r.reply) },
      { label: 'no inventa personas fuera del archivo', test: r => !/Rodrigo|Andrea|Felipe/.test(r.reply) || r.actions.includes('leads.search') }] },
  { id: 'archivo-a-quien', title: 'A quién escribirle de un archivo subido', world: filesWorld,
    request: 'de la lista de la feria que subi, a quienes les escribo primero?',
    origin: 'Priorizar sobre un archivo: leerlo, cruzarlo con los contactos guardados y recordar que los nuevos se importan antes de una campaña.',
    checks: [...CORPUS_COMMON_CHECKS,
      { label: 'lee el archivo', test: r => r.actions.includes('files.read') },
      { label: 'ordena a las personas del archivo con correo, no solo a la primera', test: r => FAIR_PEOPLE.filter(name => text(r).includes(name)).length >= 4 },
      { label: 'una campaña solo va a contactos guardados', test: r => !campaign(r) || (campaign(r)?.emails || []).every(email => SAVED_EMAILS.includes(email)) },
      { label: 'dice qué pasa con los que no están guardados', test: r => Boolean(r.proposal)
        || /import|no (?:están|aparecen|figuran) (?:guardad|entre tus contactos|en tus contactos)|aún no (?:están|aparecen|figuran)/i.test(text(r)) }] },
  { id: 'archivo-excel', title: 'Un Excel subido', world: filesWorld,
    request: 'revisa el excel prospectos.xlsx que subi y dime a quien contactar',
    origin: 'Un Excel de prospectos (6 personas, 4 con correo, y otra hoja de descartados): Cowork lo lee sin ejecutar código y prioriza a quiénes contactar.',
    checks: [...CORPUS_COMMON_CHECKS,
      { label: 'lee el Excel por su nombre', test: r => (r.reads || []).some(read => read.action === 'files.read' && /prospectos/i.test(read.input)) },
      { label: 'nombra al menos tres de las personas del Excel', test: r => PROSPECT_PEOPLE.filter(name => text(r).includes(name)).length >= 3 },
      { label: 'no dice que no puede leer un Excel', test: r => !/no (?:puedo|logro|se puede) (?:leer|abrir)|(?:todavía|aún) no (?:leo|puedo leer|se lee)|no lo (?:leo|puedo leer)/i.test(r.reply) },
      { label: 'no propone código para leerlo', test: r => r.proposal?.kind !== 'code_execute' },
      { label: 'no inventa personas fuera del Excel', test: r => !/Marcela|Felipe|Camila|Andrea/.test(r.reply) || r.actions.includes('leads.search') }] },
  { id: 'archivo-pdf', title: 'Un PDF subido', world: filesWorld,
    request: 'lee el brief-axis.pdf que te subi y resumeme lo importante',
    origin: 'Un PDF con texto (el brief comercial): Cowork lo lee sin ejecutar código, resume lo que trae y lo respeta (por ejemplo, que no hay prueba gratuita).',
    checks: [...CORPUS_COMMON_CHECKS,
      { label: 'lee el PDF por su nombre', test: r => (r.reads || []).some(read => read.action === 'files.read' && /brief-axis/i.test(read.input)) },
      { label: 'dice a quién apunta (RR. HH., selección, outsourcing o minería)', test: r => /rr\.?\s*hh|selecci|outsourcing|miner/i.test(r.reply) },
      { label: 'dice qué se ofrece (la demostración)', test: r => /demostraci[oó]n|demo\b/i.test(r.reply) },
      { label: 'no ofrece prueba gratuita', test: r => !/prueba gratuita|gratis/i.test(`${r.reply}\n${r.question || ''}`) || /no (?:hay|tiene|incluye|ofrece)[^.]*(?:prueba gratuita|gratis)/i.test(r.reply) },
      { label: 'no dice que no puede leer un PDF', test: r => !/no (?:puedo|logro|se puede) (?:leer|abrir)|(?:todavía|aún) no (?:leo|puedo leer|se lee)/i.test(r.reply) }] },
  { id: 'archivo-no-esta', title: 'Un archivo que no existe', world: filesWorld,
    request: 'lee el archivo clientes-2025.csv que te mande',
    origin: 'El nombre no coincide con ninguna subida: lo dice y muestra lo que sí hay, sin inventar datos.',
    checks: [...CORPUS_COMMON_CHECKS,
      { label: 'dice que no lo encuentra', test: r => /no (?:lo |la )?(?:encuentro|encontré|aparece|está|veo)|no hay (?:un|ningún) archivo/i.test(r.reply) },
      { label: 'muestra el archivo que sí subió', test: r => /asistentes-feria-rrhh/i.test(text(r)) },
      { label: 'pide subirlo', test: r => /\bs[uú]b(?:e|es|as|ir|irlo|irla|elo|ela)\b|adjunta/i.test(`${r.reply}\n${r.question || ''}`) }] },
  { id: 'adjunto-solo', title: 'Solo adjunta un archivo, sin escribir nada', world: filesWorld,
    request: coworkWithAttachments('', ['asistentes-feria-rrhh.csv']),
    origin: 'El usuario arrastró un CSV al cuadro y envió sin texto: Cowork lo lee por su nombre, dice qué trae y propone el siguiente paso.',
    checks: [...CORPUS_COMMON_CHECKS,
      { label: 'lee el archivo adjunto por su nombre', test: r => (r.reads || []).some(read => read.action === 'files.read' && read.input === 'asistentes-feria-rrhh.csv') },
      { label: 'dice cuántas personas trae (8)', test: r => /\b8\b|\bocho\b/i.test(r.reply) },
      { label: 'no pregunta qué archivo es', test: r => !/(?:qué|cuál) archivo/i.test(`${r.reply}\n${r.question || ''}`) }] },
  { id: 'adjunto-con-pedido', title: 'Adjunta un archivo y pide algo sin nombrarlo', world: filesWorld,
    request: coworkWithAttachments('¿a quiénes les escribo primero?', ['asistentes-feria-rrhh.csv']),
    origin: 'El pedido no dice «el archivo»: el adjunto es el contexto, y Cowork prioriza a sus personas.',
    checks: [...CORPUS_COMMON_CHECKS,
      { label: 'lee el archivo adjunto por su nombre', test: r => (r.reads || []).some(read => read.action === 'files.read' && read.input === 'asistentes-feria-rrhh.csv') },
      { label: 'ordena a las personas del archivo con correo, no solo a la primera', test: r => FAIR_PEOPLE.filter(name => text(r).includes(name)).length >= 4 },
      { label: 'dice qué pasa con los que no están guardados', test: r => Boolean(r.proposal)
        || /import|no (?:están|aparecen|figuran) (?:guardad|entre tus contactos|en tus contactos)|aún no (?:están|aparecen|figuran)/i.test(text(r)) }] },
  // A file made from what is already on screen: every card has its own «Descargar» (F3), so nothing needs code.
  { id: 'descargar-tabla', title: 'Pide una tabla en Excel', world,
    request: 'pásame a excel mis contactos de rrhh con su empresa y si tienen correo',
    origin: 'Un archivo de lo que Cowork ya muestra: entrega la tabla como tarjeta y dice que se baja en Excel con «Descargar», sin proponer código ni decir que no puede.',
    checks: [...CORPUS_COMMON_CHECKS,
      { label: 'consulta los contactos guardados', test: r => r.actions.includes('leads.search') },
      { label: 'entrega la tabla como tarjeta', test: r => (r.blocks || []).some(block => block.type === 'table' && block.rows.length >= 3) },
      { label: 'dice que la tarjeta se baja en Excel con «Descargar»', test: r => /descargar/i.test(text(r)) && /excel/i.test(text(r)) },
      { label: 'no propone código para hacer el archivo', test: r => r.proposal?.kind !== 'code_execute' },
      { label: 'no dice que no puede hacer un archivo', test: r => !/no (?:puedo|logro|se puede) (?:crear|generar|hacer|armar|entregar|adjuntar|enviar|exportar|pasar|dar)[^.]*(?:archivo|excel)/i.test(r.reply) }] },
  { id: 'descargar-correo', title: 'Pide un correo en Word', world,
    request: 'redáctame un correo para felipe de securitas ofreciendo axis y pásamelo en word',
    origin: 'Un correo que el usuario quiere como archivo: lo escribe como tarjeta y dice que se baja en Word con «Descargar», sin proponer código ni decir que no puede.',
    checks: [...CORPUS_COMMON_CHECKS,
      { label: 'entrega el correo como tarjeta', test: r => (r.blocks || []).some(block => block.type === 'email_draft') },
      { label: 'dice que la tarjeta se baja en Word con «Descargar»', test: r => /descargar/i.test(text(r)) && /word/i.test(text(r)) },
      { label: 'no propone código para hacer el archivo', test: r => r.proposal?.kind !== 'code_execute' },
      { label: 'no dice que no puede hacer un archivo', test: r => !/no (?:puedo|logro|se puede) (?:crear|generar|hacer|armar|entregar|adjuntar|enviar|exportar|pasar|dar)[^.]*(?:archivo|word)/i.test(r.reply) },
      { label: 'firma con el nombre del perfil', test: r => /Nicol[aá]s/.test(emails(r)) },
      { label: 'sin datos de relleno entre corchetes', test: r => !PLACEHOLDER.test(text(r)) }] },
  // Importing the people of a file (F4): with contacts.import on, Cowork proposes it with its card instead of sending the person to «Importar Leads».
  { id: 'importar-feria', title: 'Importa a sus contactos la lista de la feria', world: filesWorld, contactsImport: true,
    request: 'importa a mis contactos a los de la lista de la feria de rrhh',
    origin: 'Guardar en los contactos a las personas de un archivo subido: Cowork lo lee y propone la importación con su tarjeta; los que ya estaban (Marcela y Camila) quedan fuera.',
    checks: [...CORPUS_COMMON_CHECKS,
      { label: 'lee el archivo', test: r => r.actions.includes('files.read') },
      { label: 'propone importar con su tarjeta', test: r => r.proposal?.kind === 'contacts_import' },
      { label: 'importa el archivo de la feria', test: r => /feria/i.test(r.proposal?.contactsImport?.file || '') },
      { label: 'no propone código para importarlo', test: r => r.proposal?.kind !== 'code_execute' },
      { label: 'no lo manda a importarlos a mano', test: r => !/Importar Leads/i.test(text(r)) }] },
  { id: 'importar-excel', title: 'Guarda en sus contactos los prospectos de un Excel', world: filesWorld, contactsImport: true,
    request: 'guarda en mis contactos a los prospectos del excel que subi',
    origin: 'La misma importación desde un Excel: el archivo se lee y se propone guardar a sus personas.',
    checks: [...CORPUS_COMMON_CHECKS,
      { label: 'propone importar con su tarjeta', test: r => r.proposal?.kind === 'contacts_import' },
      { label: 'importa el Excel de prospectos', test: r => /prospectos\.xlsx/i.test(r.proposal?.contactsImport?.file || '') },
      { label: 'no propone código para importarlo', test: r => r.proposal?.kind !== 'code_execute' }] },
  { id: 'importar-para-escribir', title: 'Quiere una campaña para personas de un archivo que no tiene guardadas', world: filesWorld, contactsImport: true,
    request: 'armame una campaña para los de la feria que todavia no tengo guardados',
    origin: 'Una campaña solo va a contactos guardados: con la importación disponible, el primer paso es proponer importar a los que faltan, no pedir que lo hagan a mano.',
    checks: [...CORPUS_COMMON_CHECKS,
      { label: 'lee el archivo', test: r => r.actions.includes('files.read') },
      { label: 'propone primero importarlos', test: r => r.proposal?.kind === 'contacts_import' },
      { label: 'no crea una campaña con personas que no están guardadas', test: r => !campaign(r) || (campaign(r)?.emails || []).every(email => SAVED_EMAILS.includes(email)) },
      { label: 'dice que después viene la campaña', test: r => /campa[ñn]a/i.test(r.note || r.reply) }] },
];

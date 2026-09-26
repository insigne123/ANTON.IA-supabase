// Marketing corpus: requests a new ANTON.IA user would type to run email and
// LinkedIn outreach from Cowork, written from use cases (not copied from
// production). The account is small on purpose: 5 saved contacts, no campaigns
// and one email sent. Names are fictional and complete: masked names made the
// model guess surnames. No database, mailbox or provider is touched.
import { CORPUS_COMMON_CHECKS, type CorpusCase, type CorpusTurnResult } from './cowork-conversation-corpus';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const MARKETING_LEAD = { marcela: id(101), felipe: id(102), andrea: id(103), rodrigo: id(104), camila: id(105) };

const contacts = [
  { id: MARKETING_LEAD.marcela, name: 'Marcela Rojas', title: 'Gerente de Personas', company: 'Sodexo Chile', email: 'mrojas@sodexo.cl',
    linkedinUrl: 'https://www.linkedin.com/in/marcela-r', status: 'saved', created_at: '2026-09-20T14:00:00Z' },
  { id: MARKETING_LEAD.felipe, name: 'Felipe Muñoz', title: 'Jefe de Reclutamiento', company: 'Securitas Chile', email: 'fmunoz@securitas.cl',
    linkedinUrl: 'https://www.linkedin.com/in/felipe-m', status: 'saved', created_at: '2026-09-19T15:30:00Z' },
  { id: MARKETING_LEAD.andrea, name: 'Andrea Vega', title: 'HR Business Partner', company: 'Falabella', email: null,
    linkedinUrl: 'https://www.linkedin.com/in/andrea-v', status: 'saved', created_at: '2026-09-18T12:10:00Z' },
  { id: MARKETING_LEAD.rodrigo, name: 'Rodrigo Pino', title: 'Gerente de Operaciones', company: 'Transportes Andes', email: 'rpino@tandes.cl',
    linkedinUrl: null, status: 'saved', created_at: '2026-09-17T10:00:00Z' },
  { id: MARKETING_LEAD.camila, name: 'Camila Fuentes', title: 'Analista de Selección', company: 'Adecco', email: 'cfuentes@adecco.cl',
    linkedinUrl: 'https://www.linkedin.com/in/camila-f', status: 'saved', created_at: '2026-09-16T09:45:00Z' },
];
const PEOPLE_TEAMS = /rr\.?\s*hh|recursos humanos|personas|selecci|reclut|talento|\bhr\b|human/i;
const isPeopleTeam = (lead: typeof contacts[number]) => PEOPLE_TEAMS.test(lead.title);
const noCoverage = { gmail: null, outlook: null };

/** Marcela got the first email of a campaign six days ago and has not replied. */
const marcelaSent = { leadId: MARKETING_LEAD.marcela, name: 'Marcela Rojas', company: 'Sodexo Chile', channel: 'email',
  subject: 'Antecedentes laborales sin trámites manuales', sentAt: '2026-09-19T13:02:00Z', replied: false };

function read(action: string, input: string): unknown {
  const term = input.toLowerCase().trim();
  switch (action) {
    case 'leads.search': {
      const words = term.split(/\s+/).filter(word => word.length > 2);
      const items = !term ? contacts : contacts.filter(lead => PEOPLE_TEAMS.test(term) ? isPeopleTeam(lead)
        : [lead.name, lead.title, lead.company, lead.email].some(value => words.some(word => String(value || '').toLowerCase().includes(word))));
      return { items, returned: items.length, limit: 20, scope: 'own_saved_contacts', truncated: false, partial: false };
    }
    case 'leads.get':
      return { items: contacts.filter(lead => lead.id === input), returned: 1, limit: 1, scope: 'own_saved_contacts', truncated: false };
    case 'app.context':
      return { scope: 'organization_context', emailConnections: { google: true, outlook: false },
        counts: { leads: 5, contacted: 1, campaigns: 0, activeMissions: 0, openExceptions: 0 }, performance: null,
        offer: 'Yago SpA. Productos: AXIS: consultas judiciales automáticas en el Poder Judicial (PJUD) para revisar antecedentes laborales de postulantes', offerSource: 'organization' };
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
      const items = !term || /marcela|sodexo/.test(term) ? [marcelaSent] : [];
      return { items, limit: 20, scope: 'organization_contacted', returned: items.length, truncated: false,
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
export const marketingRead = read;

const text = (result: CorpusTurnResult) => [result.reply, result.note || '', result.document?.content || ''].join('\n');
const campaign = (result: CorpusTurnResult) => result.proposal?.campaign as { emails?: string[]; messages?: Array<{ subject: string; body: string }> } | undefined;
const PLACEHOLDER = /\[(?:tu |su )?(?:nombre|empresa|cargo|firma|name)[^\]]*\]/i;
const PEOPLE_EMAILS = ['mrojas@sodexo.cl', 'fmunoz@securitas.cl', 'cfuentes@adecco.cl'];
const lastLine = (reply: string) => reply.split('\n').filter(line => line.trim()).pop() || '';
/** Drops sentences that deny something («No agregué prueba gratuita»): a denial is not an offer. */
const withoutDenials = (content: string) => content.split(/(?<=[.!?\n])/).filter(sentence => !/\bno\b|\bni\b|\bsin\b(?! costo)/i.test(sentence)).join('');

/** From the first greeting to the signature: the email itself, without the comments around it. */
const rewrittenEmail = (result: CorpusTurnResult) => {
  const all = result.document?.content || result.reply;
  const start = all.search(/\bHola\b/i);
  if (start < 0) return all;
  const body = all.slice(start);
  const signature = body.search(/Nicol[aá]s/);
  return signature < 0 ? body : body.slice(0, signature);
};

export const MARKETING_CORPUS: CorpusCase[] = [
  { id: 'mkt-que-puedes-hacer', title: 'Usuario nuevo pregunta qué hace Cowork', request: 'hola! soy nuevo aca, que puedes hacer por mi?', world,
    origin: 'Primera conversación de alguien que no conoce Cowork: debe entender en segundos qué puede pedir, con su cuenta real como ejemplo.',
    checks: [...CORPUS_COMMON_CHECKS,
      { label: 'menciona correos o campañas y LinkedIn', test: r => /correo|campa/i.test(r.reply) && /linkedin/i.test(r.reply) },
      { label: 'breve: 12 líneas como máximo', test: r => r.reply.split('\n').filter(line => line.trim()).length <= 12 },
      { label: 'no pregunta qué vende el usuario', test: r => !/qué (?:producto|servicio|vendes|ofreces)/i.test(r.reply) }] },
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
      { label: 'entrega los 3 correos en un documento', test: r => Boolean(r.document) && ((r.document?.content || '').match(/asunto/gi) || []).length >= 3 },
      { label: 'sin datos de relleno entre corchetes', test: r => !PLACEHOLDER.test(text(r)) },
      // Only the emails count: the reply or a scope note may say that no free trial was offered.
      { label: 'no ofrece prueba gratuita sin oferta aprobada', test: r => !/prueba gratuita|gratis|sin costo/i.test(withoutDenials(r.document?.content || '')) },
      { label: 'firma con el nombre del perfil', test: r => /Nicol[aá]s/.test(r.document?.content || '') }] },
  { id: 'mkt-linkedin-mensaje', title: 'Mensaje de LinkedIn a un contacto', request: 'escribele a marcela por linkedin, algo corto presentandome', world,
    origin: 'LinkedIn desde el chat: identificar a la persona y dejar el mensaje en cola para aprobar, firmado con el nombre real.',
    checks: [...CORPUS_COMMON_CHECKS,
      { label: 'propone el mensaje de LinkedIn', test: r => r.proposal?.kind === 'linkedin_message' },
      { label: 'el mensaje es breve y sin relleno', test: r => !r.proposal?.linkedinMessage
        || (r.proposal.linkedinMessage.length <= 600 && !PLACEHOLDER.test(r.proposal.linkedinMessage)) },
      { label: 'el mensaje lleva el nombre real del usuario', test: r => !r.proposal?.linkedinMessage || /Nicol[aá]s/.test(r.proposal.linkedinMessage) }] },
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
      { label: 'firma con el nombre del perfil', test: r => /Nicol[aá]s/.test(text(r)) }] },
  { id: 'mkt-busqueda-y-campana', title: 'Pedido de varios pasos', world,
    request: 'busca 10 gerentes de rrhh en empresas de retail en santiago y despues armame una campaña para ellos',
    origin: 'Dos pasos encadenados: el primero es la búsqueda y la nota debe explicar qué sigue después de aprobarla.',
    checks: [...CORPUS_COMMON_CHECKS,
      { label: 'propone la búsqueda', test: r => Boolean(r.search) },
      { label: 'respeta el tamaño pedido (10)', test: r => !r.search || Number(r.search.limit) === 10 },
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
      { label: 'firma con el nombre del perfil', test: r => r.proposal?.kind === 'linkedin_message' || /Nicol[aá]s/.test(text(r)) }] },
];

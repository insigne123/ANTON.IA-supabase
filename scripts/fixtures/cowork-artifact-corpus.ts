// Cases for code artifacts (Plan 12, 3b): what a person asks to see, and changes to an artifact already made, in the
// words of the chat and as the canvas sends them («Pedir cambios» and «Arreglarlo»). They run with --artifacts, on the
// production fixture world of the corpus; without it they measure how Cowork answers the same requests in the chat.
import { analyzeStoredAudience } from '../../src/lib/cowork/audience-analysis';
import { analyzeIcp, type IcpTouch } from '../../src/lib/cowork/icp';
import { coworkArtifactChangeMessage, coworkArtifactFixMessage } from '../../src/lib/cowork/code-artifact-frame';
import { COWORK_ARTIFACT_EXAMPLES } from '../../src/lib/server/cowork/code-artifact-examples';
import { coworkSentPeriod } from '../../src/lib/cowork/sent-period';
import { CORPUS_COMMON_CHECKS, CORPUS_NOW, corpusRead, corpusWithEmailQuery, type CorpusCase, type CorpusHistoryTurn, type CorpusTurnResult, type CorpusWorld } from './cowork-conversation-corpus';
import { OPPORTUNITIES_READ, OPPORTUNITY_HIRING, OPPORTUNITY_PROJECTS, OPPORTUNITY_TENDERS } from './cowork-opportunities-corpus';

const at = '2026-09-25T13:00:00Z';
const PIPELINE = { name: 'artifact-pipeline-por-etapa-v1.html', title: 'Pipeline por etapa' };
const made: CorpusHistoryTurn = { request: 'muéstrame mi pipeline en un gráfico por etapa', at, artifacts: [PIPELINE],
  reply: 'Tus 4 contactos guardados están en Nuevos: ninguno avanzó de etapa todavía. El tablero muestra el pipeline por etapa, con la tabla de detalle debajo; puedes ordenarla y usar «Ver datos» en el gráfico.' };
const code = { [PIPELINE.name]: COWORK_ARTIFACT_EXAMPLES[0].code };
// The same page with a real bug: it reads rows from a property the table does not have, so it throws on open.
const brokenJs = COWORK_ARTIFACT_EXAMPLES[0].code.js.replace('const deals = antonia.data.pipeline.rows;', 'const deals = antonia.data.pipeline.items.map(row => row);');
const broken = { [PIPELINE.name]: { ...COWORK_ARTIFACT_EXAMPLES[0].code, js: brokenJs } };
const brokenLine = brokenJs.split('\n').findIndex(line => line.includes('.items.map(')) + 1;
const edited = (result: CorpusTurnResult) => (result.artifact?.brief as { previous?: unknown } | undefined)?.previous === PIPELINE.name;
const drawn = (result: CorpusTurnResult) => Boolean(result.artifact) && result.artifact?.render?.ok !== false;
/** Without --artifacts the same request is answered in the chat: a table, figures or a document count. */
const visual = (result: CorpusTurnResult) => Boolean(result.artifact) || Boolean(result.document)
  || (result.blocks || []).some(block => ['metrics', 'chart', 'table'].includes(block.type));

// A fuller account for the dashboards of 3c: 24 saved contacts in 8 companies of 4 industries, what was sent to 16 of them
// (with replies and bounces) and three campaigns. Made up: the app is for any company.
const COMPANIES: Array<[string, string, string]> = [
  ['Constructora Andes', 'Construcción', 'constructoraandes.cl'], ['Inmobiliaria Pacífico', 'Construcción', 'inmopacifico.cl'],
  ['Retail Andes', 'Retail', 'retailandes.cl'], ['Tiendas Sur', 'Retail', 'tiendassur.cl'],
  ['Minera Centinela', 'Minería', 'centinela.cl'], ['Minera Sur', 'Minería', 'minerasur.cl'],
  ['Grupo Expro', 'Servicios', 'grupoexpro.com'], ['Servicios Norte', 'Servicios', 'serviciosnorte.cl'],
];
const TITLES = ['Gerente de Personas', 'Jefe de Reclutamiento', 'Analista de Selección'];
const NAMES = ['Carolina Vega', 'Rodrigo Fuentes', 'Paula Soto', 'Andrés Molina', 'Javiera Rojas', 'Tomás Pizarro', 'Daniela Muñoz', 'Felipe Araya',
  'Camila Torres', 'Ignacio Reyes', 'Valentina Díaz', 'Matías Herrera', 'Francisca Lagos', 'Sebastián Castro', 'Constanza Paredes', 'Joaquín Bravo',
  'Antonia Silva', 'Martín Ortega', 'Catalina Núñez', 'Diego Sepúlveda', 'Fernanda Ríos', 'Nicolás Cárdenas', 'Isidora Vidal', 'Benjamín Tapia'];
const slug = (name: string) => name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '.');
const RICH_LEADS = COMPANIES.flatMap(([company, industry, domain], c) => TITLES.map((title, p) => ({
  id: `00000000-0000-4000-8000-${String(900 + c * 3 + p).padStart(12, '0')}`, name: NAMES[c * 3 + p], title, company, industry,
  // Most have an email; the analysts of the last four companies do not. Half have a LinkedIn profile.
  email: p === 2 && c >= 4 ? null : `${slug(NAMES[c * 3 + p])}@${domain}`,
  linkedin_url: (c + p) % 2 === 0 ? `https://www.linkedin.com/in/${slug(NAMES[c * 3 + p]).replace('.', '-')}` : null,
  status: 'saved', location: c % 2 === 0 ? 'Santiago, Chile' : 'Antofagasta, Chile', created_at: `2026-0${7 + (c % 2)}-${String(10 + p * 5).padStart(2, '0')}T12:00:00Z`,
})));
// Two emails to each of the first two people of each company (16 people, 32 sends), with replies and two bounces.
const REPLIES: Record<string, [string, string]> = {
  'Constructora Andes|0': ['2026-09-12T14:00:00Z', 'meeting_request'], 'Constructora Andes|1': ['2026-09-15T10:00:00Z', 'question'],
  'Inmobiliaria Pacífico|0': ['2026-09-08T16:00:00Z', 'not_interested'], 'Minera Centinela|0': ['2026-09-18T11:00:00Z', 'interested'],
  'Grupo Expro|0': ['2026-09-20T09:30:00Z', 'meeting_request'], 'Servicios Norte|1': ['2026-09-10T15:00:00Z', 'referral'],
};
const RICH_SENDS = COMPANIES.flatMap(([company], c) => [0, 1].flatMap(p => {
  const lead = RICH_LEADS[c * 3 + p];
  const reply = REPLIES[`${company}|${p}`];
  const bounced = (c === 3 && p === 1) || (c === 5 && p === 0);
  return [1, 2].map(step => ({
    name: lead.name, company, provider: 'gmail', subject: step === 1 ? `Verificación de antecedentes en ${company}` : `Re: Verificación de antecedentes en ${company}`,
    sent_at: `2026-0${step === 1 ? 8 : 9}-${String(4 + c * 3).padStart(2, '0')}T13:00:00Z`, status: bounced ? 'bounced' : 'sent',
    replied_at: step === 2 && reply ? reply[0] : null, reply_intent: step === 2 && reply ? reply[1] : null, bounced_at: bounced && step === 1 ? '2026-08-05T13:05:00Z' : null,
  })).filter(send => !(send.bounced_at === null && send.status === 'bounced'));
}));
const RICH_CAMPAIGNS = [
  { id: '00000000-0000-4000-8000-000000000951', name: 'Construcción · RR. HH.', status: 'active', revision: 2, recipients: 6, createdAt: '2026-08-01T15:00:00Z' },
  { id: '00000000-0000-4000-8000-000000000952', name: 'Minería y servicios', status: 'paused', revision: 1, recipients: 8, createdAt: '2026-08-20T15:00:00Z' },
  { id: '00000000-0000-4000-8000-000000000953', name: 'Retail · segunda ola', status: 'draft', revision: 1, recipients: 4, createdAt: '2026-09-22T15:00:00Z' },
];
const words = (value: string) => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const leadOf = (name: string) => RICH_LEADS.find(lead => lead.name === name)!;
// The segment reads come from the same functions the app runs (audience-read.ts, icp-read.ts) over this account, so a dashboard
// by industry sees the same 24 contacts and 30 sends as the searches, not the corpus's other account.
const RICH_AUDIENCE = { queriedAt: '2026-09-25T13:10:00Z', ...analyzeStoredAudience(RICH_LEADS,
  RICH_SENDS.map(send => ({ company: send.company, lead_id: leadOf(send.name).id, sent_at: send.sent_at })), { leadsComplete: true, historyComplete: true }) };
const RICH_ICP = { scope: 'organization_icp', offer: null, ...analyzeIcp({
  declared: null, now: '2026-09-25T13:10:00Z', stages: new Map(),
  touches: RICH_SENDS.map((send, index): IcpTouch => {
    const lead = leadOf(send.name);
    return { id: `rich-send-${index}`, leadId: lead.id, email: lead.email, role: lead.title, industry: lead.industry, country: 'Chile',
      city: lead.location.split(',')[0], sentAt: send.sent_at, repliedAt: send.replied_at, replyIntent: send.reply_intent, bouncedAt: send.bounced_at };
  }),
  leads: RICH_LEADS.map(lead => ({ id: lead.id, title: lead.title, industry: lead.industry, country: 'Chile', city: lead.location.split(',')[0] })),
}) };
/** The fuller account: its contacts, sends and campaigns; the rest of the world is the corpus's. */
export const ARTIFACT_RICH_WORLD: CorpusWorld = {
  savedEmails: RICH_LEADS.map(lead => lead.email).filter((email): email is string => Boolean(email)),
  read: (action, input) => {
    const term = words(input || '').trim();
    const match = (values: unknown[]) => !term || values.some(value => words(String(value || '')).split(/\s+/).some(word => term.split(/\s+/).some(part => part.length > 2 && word.includes(part))));
    if (action === 'leads.search') {
      const { withEmail, rest } = corpusWithEmailQuery(term);
      const matchRest = (values: unknown[]) => !rest || values.some(value => words(String(value || '')).split(/\s+/).some(word => rest.split(/\s+/).some(part => part.length > 2 && word.includes(part))));
      const items = RICH_LEADS.filter(lead => matchRest([lead.name, lead.title, lead.company, lead.industry]) && (!withEmail || Boolean((lead as { email?: unknown }).email)));
      return { items, returned: items.length, limit: withEmail ? 25 : 20, scope: 'own_saved_contacts', truncated: false, partial: false };
    }
    if (action === 'contacted.search') {
      // A period («últimos 30 días») filters by send date, as the server does.
      const period = coworkSentPeriod(term);
      const since = period ? CORPUS_NOW.getTime() - period.days * 24 * 60 * 60 * 1000 : null;
      const matchRest = (values: unknown[]) => !period ? match(values) : !period.rest || values.some(value => words(String(value || '')).split(/\s+/)
        .some(word => period.rest.split(/\s+/).some(part => part.length > 2 && word.includes(part))));
      const items = RICH_SENDS.filter(send => matchRest([send.name, send.company]) && (since === null || Date.parse(send.sent_at) >= since));
      return { items, returned: items.length, limit: 40, scope: 'organization_contacted', truncated: false };
    }
    if (action === 'campaigns.list') return { scope: 'own', campaigns: RICH_CAMPAIGNS };
    if (action === 'audience.analyze') return RICH_AUDIENCE;
    if (action === 'icp.analyze') return RICH_ICP;
    if (action === 'opportunities.list') return OPPORTUNITIES_READ(input);
    if (action === 'artifact.opportunities') return { hiring: OPPORTUNITY_HIRING, tenders: OPPORTUNITY_TENDERS, projects: OPPORTUNITY_PROJECTS };
    return corpusRead(action, input);
  },
};
// What the person reads: the answer, the tables and figures shown in the chat, and the artifact.
const text = (result: CorpusTurnResult) => words(`${result.reply}\n${JSON.stringify(result.blocks || [])}\n${result.artifact?.render?.text || ''}`);
const usesTables = (...names: string[]) => (result: CorpusTurnResult) => !result.artifact || names.every(name => result.artifact!.tables.some(table => table.name === name));

export const ARTIFACT_CORPUS: CorpusCase[] = [
  { id: 'art-prospectos-filtro', title: 'Prospectos en una tabla que se filtra',
    request: 'muéstrame mis contactos guardados en una tabla que pueda filtrar por empresa y ver quién tiene correo',
    origin: 'Plan 12, 3b: una lista que se filtra es un artefacto, no un texto.',
    checks: [...CORPUS_COMMON_CHECKS,
      { label: 'entrega algo visual', test: visual },
      { label: 'el artefacto usa los contactos', test: r => !r.artifact || r.artifact.tables.some(table => table.name === 'contacts' || table.name === 'pipeline') },
      { label: 'el artefacto se dibuja sin errores', test: r => !r.artifact || drawn(r) }] },
  { id: 'art-tablero-campanas', title: 'Tablero de campañas', request: 'hazme un tablero de mis campañas: cuántas tengo, en qué estado y a cuántas personas van',
    origin: 'Plan 12, 3b.',
    checks: [...CORPUS_COMMON_CHECKS,
      { label: 'entrega algo visual', test: visual },
      { label: 'el artefacto usa las campañas', test: r => !r.artifact || r.artifact.tables.some(table => table.name === 'campaigns') },
      { label: 'no muestra estados en inglés', test: r => !/\b(draft|paused|approved)\b/.test(`${r.reply}\n${r.artifact?.render?.text || ''}`) }] },
  { id: 'art-cambio-boton', title: '«Pedir cambios» desde el lienzo', history: [made], artifacts: code,
    request: coworkArtifactChangeMessage(PIPELINE, 'agrega un gráfico de contactos por empresa'),
    origin: 'Plan 12, 3b: el mensaje que manda «Pedir cambios» nombra el archivo; se edita esa versión.',
    checks: [...CORPUS_COMMON_CHECKS,
      { label: 'edita el artefacto anterior', test: edited },
      { label: 'la versión nueva se dibuja sin errores', test: drawn },
      { label: 'no pide confirmación para un cambio pedido', test: r => Boolean(r.artifact) }] },
  { id: 'art-cambio-chat', title: 'Cambio pedido en el chat', history: [made], artifacts: code,
    request: 'al gráfico del pipeline agrégale un filtro por empresa',
    origin: 'Plan 12, 3b: «el gráfico del pipeline» es el artefacto del turno anterior, por el historial.',
    checks: [...CORPUS_COMMON_CHECKS,
      { label: 'edita el artefacto anterior', test: edited },
      { label: 'la versión nueva se dibuja sin errores', test: drawn }] },
  { id: 'art-arreglar', title: '«Arreglarlo» desde el lienzo', history: [made], artifacts: broken,
    request: coworkArtifactFixMessage(PIPELINE, { message: 'Cannot read properties of undefined (reading \'map\')', line: brokenLine }),
    origin: 'Plan 12, 3b: el error llega a la Diseñadora con el código para que lo corrija en su causa.',
    checks: [...CORPUS_COMMON_CHECKS,
      { label: 'edita el artefacto anterior', test: edited },
      { label: 'la versión nueva se dibuja sin errores', test: drawn },
      { label: 'dice qué falló y cómo quedó', test: r => /error|fall[óo]|corregí|arregl|no exist|ahora (?:lee|usa|toma|muestra)/i.test(r.reply) }] },
  // 3c: the kinds of artifact the Designer had no example of.
  { id: 'art-licitaciones', title: 'Tablero de oportunidades por monto y cierre', opportunities: true, world: ARTIFACT_RICH_WORLD,
    request: 'hazme un tablero de mis oportunidades: las licitaciones y compras ágiles por monto y fecha de cierre, y las empresas que están contratando',
    origin: 'Plan 12, 3c: oportunidades en un tablero (montos, plazos y señales), no en una lista de texto.',
    checks: [...CORPUS_COMMON_CHECKS,
      { label: 'entrega algo visual', test: visual },
      { label: 'el artefacto usa las oportunidades', test: usesTables('opportunities') },
      { label: 'el artefacto se dibuja sin errores', test: r => !r.artifact || drawn(r) },
      { label: 'muestra el cierre de las licitaciones', test: r => /cierr|plazo|vence/.test(text(r)) },
      { label: 'no muestra la empresa descartada', test: r => !/seguridad austral/.test(text(r)) }] },
  { id: 'art-ficha-cuenta', title: 'Ficha de una cuenta antes de una reunión', world: ARTIFACT_RICH_WORLD,
    request: 'mañana me reúno con Constructora Andes: arma una ficha con mis contactos ahí y todo lo que les he enviado y lo que respondieron',
    origin: 'Plan 12, 3c: una ficha de cuenta junta contactos y envíos de una sola empresa.',
    checks: [...CORPUS_COMMON_CHECKS,
      { label: 'entrega algo visual', test: visual },
      { label: 'el artefacto usa los contactos y los envíos', test: r => !r.artifact || (r.artifact.tables.some(table => table.name === 'activity')
        && r.artifact.tables.some(table => table.name === 'contacts' || table.name === 'pipeline')) },
      { label: 'el artefacto se dibuja sin errores', test: r => !r.artifact || drawn(r) },
      { label: 'es de Constructora Andes', test: r => /constructora andes/.test(text(r)) },
      { label: 'nombra la respuesta que pide reunión', test: r => /reuni/.test(text(r)) }] },
  { id: 'art-segmentos', title: 'Comparación de segmentos por rubro', world: ARTIFACT_RICH_WORLD,
    request: 'compara mis segmentos por rubro: cuántos contactos tengo en cada uno, a cuántos les escribí y qué porcentaje respondió',
    origin: 'Plan 12, 3c: comparar segmentos cruza contactos (el rubro) con envíos (respuestas).',
    checks: [...CORPUS_COMMON_CHECKS,
      { label: 'entrega algo visual', test: visual },
      { label: 'el artefacto usa los contactos y los envíos', test: usesTables('contacts', 'activity') },
      { label: 'el artefacto se dibuja sin errores', test: r => !r.artifact || drawn(r) },
      { label: 'nombra los cuatro rubros', test: r => ['construccion', 'retail', 'mineria', 'servicios'].every(name => text(r).includes(name)) }] },
];

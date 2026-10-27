// The task bench of Cowork (scripts/evaluate-cowork-tasks.ts): whole requests of several steps, the way Claude Cowork or ChatGPT's agent
// are asked for work, played from the first message to the last step the person would approve. The corpus (cowork-full-corpus.ts) measures
// one turn; this measures whether the work gets done. Between turns, what the person approves is played here: an approved search brings
// people, a batch saves them and finds their emails, a campaign is created paused. The conversation then resumes with the same request
// the worker writes in production (src/lib/cowork/continuation-messages.ts), and the history carries the result as production loads it
// (server/cowork/conversation-context.ts: the turn's newest reads and the effects that ran). Everything here is pure: no model, no database.
import { COWORK_CONTINUE_AFTER_PLAN, COWORK_CONTINUE_AFTER_SEARCH, coworkContinuationAfter, coworkContinueTask } from '../../src/lib/cowork/continuation-messages';
import { coworkTaskApproves, coworkTaskContext, coworkTaskReplyContinues, type CoworkActiveTask, type CoworkTaskPlan } from '../../src/lib/cowork/task-plan';
import { coworkResearchNoticeMessage } from '../../src/lib/cowork/research-notice';
import { COWORK_SEARCH_ROLE_NOTE } from '../../src/lib/cowork/search-ranking';
import { CORPUS_NOW, CORPUS_SAVED_EMAILS, corpusRead, type CorpusHistoryTurn, type CorpusTurnResult, type CorpusWorld } from './cowork-conversation-corpus';

export type CoworkTask = {
  id: string;
  title: string;
  /** The first message, as a person would write it. */
  request: string;
  /** What «done» means, for the judge: the state the account should be in when Cowork has nothing left to do without the person. */
  goal: string;
  /** The steps a person would expect on the way (effect kinds, or «search»): a guide for the judge, not a script to follow. */
  expected: string[];
  /** What the person answers, in order, when Cowork asks instead of proposing; after them, the bench's person answers (or «Sí, adelante.» offline). */
  answers?: string[];
  /** How many turns the bench plays at most (default 8): the worker's own limit for an automatic thread is 5 steps. */
  maxTurns?: number;
  /** The approval that completes the work: after it, the bench plays the turn that resumes from it and stops, as a person would. */
  doneAfter?: string[];
};

export const COWORK_TASKS: CoworkTask[] = [
  { id: 'lista-y-campana', title: 'De una búsqueda a una campaña lista para revisar',
    request: 'Búscame 10 jefes de selección o gerentes de personas en empresas de retail de Santiago, guarda los que encuentres con su correo y déjame una campaña pausada para escribirles.',
    goal: 'Hay una campaña creada en pausa para las personas encontradas que tienen correo, con su correo escrito; la persona solo tuvo que aprobar la búsqueda, el lote y la campaña.',
    expected: ['search', 'lead_prepare_batch', 'campaign_create'], doneAfter: ['campaign_create'] },
  { id: 'mineria-investigar-escribir', title: 'Prospectos de minería, investigados y con su correo',
    request: 'Quiero prospectos de minería en Antofagasta: busca gerentes de personas o de operaciones, guarda a los 5 que mejor calcen, investígalos y prepárales un correo a cada uno.',
    goal: 'Cinco contactos de minería guardados, con su correo buscado, su investigación pedida y un borrador de correo por persona (o el pedido de borradores hecho); Cowork dice qué faltó y por qué.',
    expected: ['search', 'lead_prepare_batch', 'draft_request'] },
  { id: 'correos-faltantes', title: 'Completar los correos que faltan y priorizar',
    request: 'Busca el correo de mis contactos guardados que todavía no lo tienen y después dime a cuáles 3 conviene escribir primero y por qué.',
    goal: 'Se propuso y ejecutó la búsqueda de correos de los guardados sin correo (en un lote) y Cowork recomienda 3 con una razón basada en sus datos.',
    expected: ['enrich_batch', 'answer'] },
  { id: 'informe-jefe', title: 'Un informe del mes para el jefe',
    request: 'Hazme un informe de cómo voy este mes con la prospección, en Word, para mandárselo a mi jefe: números, qué funcionó y qué haré la próxima semana.',
    goal: 'Un documento descargable con los números reales de la cuenta (envíos, respuestas, reuniones), lo que funcionó y un plan de la próxima semana, sin cifras inventadas.',
    expected: ['answer'] },
  { id: 'que-hago-hoy', title: 'Decidir y hacer lo de hoy',
    request: '¿Qué debería hacer hoy para vender más? Hazlo tú y pídeme aprobación solo cuando haga falta.',
    goal: 'Cowork elige lo más útil de hoy según la cuenta (por ejemplo responder a quien pidió reunión o escribir a guardados con correo) y avanza con propuestas concretas, sin quedarse en consejos.',
    expected: ['answer', 'proposal'] },
  { id: 'empresas-y-decisores', title: 'Empresas parecidas y a quién escribir en cada una',
    request: 'Encuéntrame 8 empresas de logística en Chile que se parezcan a las que ya tengo guardadas y dime a quién debería contactar en cada una.',
    goal: 'Una lista de empresas de logística con, para cada una, el cargo o la persona a contactar y por qué; se propuso la búsqueda que hacía falta y se ofrece guardarlas.',
    expected: ['search', 'answer'] },
  { id: 'tarea-larga-plan', title: 'Un encargo grande con plan',
    request: 'Arma una tarea completa: 20 prospectos de construcción en Santiago, guárdalos, busca sus correos y deja una campaña pausada con un correo para todos. Avísame el plan antes de empezar.',
    goal: 'Cowork propone un plan con sus pasos y su costo, y tras aprobarlo avanza paso a paso hasta dejar la campaña en pausa, sin pedir de nuevo lo que el plan ya aprobó.',
    expected: ['task_plan', 'search', 'lead_prepare_batch', 'campaign_create'], doneAfter: ['campaign_create'] },
  { id: 'cada-lunes', title: 'Algo que se repite cada semana',
    request: 'Cada lunes a las 9 tráeme 5 prospectos nuevos de logística en Santiago para escribirles.',
    goal: 'Cowork deja programado el pedido semanal (o dice con claridad cómo programarlo con «Programar este pedido») y no lo confunde con una búsqueda de una sola vez.',
    expected: ['answer'] },
];

const NAMES = ['Camila Rojas', 'Felipe Muñoz', 'Daniela Soto', 'Matías González', 'Valentina Díaz', 'Sebastián Pérez', 'Javiera Fuentes', 'Tomás Herrera',
  'Francisca Morales', 'Ignacio Castro', 'Constanza Vega', 'Diego Araya', 'Catalina Núñez', 'Nicolás Tapia', 'Fernanda Reyes', 'Joaquín Silva',
  'Antonia Contreras', 'Benjamín Espinoza', 'Isidora Lagos', 'Martín Cáceres'];
const COMPANIES: Array<{ match: RegExp; industry: string; names: string[] }> = [
  { match: /retail|tienda|comercio/i, industry: 'Retail', names: ['Tiendas Andinas', 'Comercial del Pacífico', 'Mercado Central Retail', 'Casa Sur', 'Moda Austral'] },
  { match: /miner/i, industry: 'Minería', names: ['Minera Altiplano', 'Cobre del Norte', 'Faena Atacama', 'Minera Loa', 'Servicios Mineros Antofagasta'] },
  { match: /log[ií]st|transporte|bodega/i, industry: 'Logística', names: ['Andes Logística', 'Transportes Ruta 5', 'Bodegas Centrales', 'Despachos del Sur', 'Puerto Seco Logística', 'Carga Express', 'Logística Integral Chile', 'Red Bodegas'] },
  { match: /constru/i, industry: 'Construcción', names: ['Constructora Cordillera', 'Obras Metropolitanas', 'Edificaciones del Valle', 'Ingeniería y Montaje Sur', 'Constructora Pehuén'] },
];

const slug = (value: string) => value.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const text = (value: unknown) => typeof value === 'string' ? value : Array.isArray(value) ? value.filter(item => typeof item === 'string').join(' ') : '';

/** What an approved search brings: people (or companies) that fit its criteria, as normalizeCoworkSearchResult returns them. */
export function simulateSearch(criteria: Record<string, unknown>) {
  const asked = [text(criteria.industries), text(criteria.keywords), text(criteria.companyKeywords), text(criteria.query), text(criteria.titles)].join(' ');
  const sector = COMPANIES.find(entry => entry.match.test(asked)) ?? { industry: 'Servicios', names: ['Servicios Integrales', 'Grupo Horizonte', 'Empresas del Maule', 'Corporación Andina', 'Holding Litoral'] };
  const limit = Math.max(1, Math.min(Number(criteria.limit) || 10, 25));
  const location = text(criteria.locations).split(/\s+/)[0] || 'Santiago';
  if (criteria.target === 'companies') {
    const items = Array.from({ length: Math.min(limit, sector.names.length) }, (_, index) => {
      const name = sector.names[index];
      return { id: `apollo-company:sim-${index + 1}`, name, domain: `${slug(name)}.cl`, website: `https://www.${slug(name)}.cl/`, linkedin_url: null,
        industry: sector.industry, employees: 120 + index * 85, location: `${location}, Chile` };
    });
    return { scope: 'external_company_search', provider: 'apollo', limit, page: 1, returned: items.length, truncated: false, hasMore: false, next: null, items,
      notice: 'Resultados del proveedor por palabras clave; confirma el encaje del sector. Son empresas, no contactos guardables como personas.' };
  }
  const titles = Array.isArray(criteria.titles) && criteria.titles.length ? criteria.titles.map(String) : ['Gerente de Personas'];
  const items = Array.from({ length: Math.min(limit, 10) }, (_, index) => {
    const company = sector.names[index % sector.names.length];
    return { id: `apollo:sim-${index + 1}`, name: NAMES[index % NAMES.length], title: titles[index % titles.length], company,
      linkedin_url: `https://www.linkedin.com/in/sim-${index + 1}`, company_website: `https://www.${slug(company)}.cl/`, company_linkedin: null,
      email: null, status: 'No guardado', industry: sector.industry, employees: 150 + index * 60, location: `${location}, Chile` };
  });
  return { scope: 'external_search', provider: 'apollo', strategy: 'people', limit, page: 1, returned: items.length, truncated: false, hasMore: false, next: null,
    roleNote: COWORK_SEARCH_ROLE_NOTE, items };
}

type Person = { id: string; name: string | null; company: string | null; title?: string | null };
type CorpusTurnResultWho = NonNullable<NonNullable<CorpusTurnResult['proposal']>['who']>;
type Saved = { id: string; name: string | null; company: string | null; title: string | null; email: string | null; industry?: string | null };

/** The person of a search result keeps one saved id across the work: saving them again reuses it, as the server does. */
const simNumber = (providerId: string) => Number(/sim-(\d+)$/.exec(providerId)?.[1] || 0);
const leadIdFor = (n: number) => `00000000-0000-4000-9100-${String(n).padStart(12, '0')}`;

/** An email the provider finds, or not: one of every three search results has none, the same ones every run. */
const emailOf = (person: { name: string | null; company: string | null }, n: number) => n % 3 === 0 ? null
  : person.name ? `${slug(person.name.split(' ')[0])}.${slug(person.name.split(' ').slice(-1)[0])}@${slug(person.company || 'empresa')}.cl` : `contacto${n}@${slug(person.company || `empresa${n}`)}.cl`;

/** The people a batch names, as the work knows them: search results by provider id, contacts it saved (or the account had) by their id. */
function batchPeople(who: CorpusTurnResultWho, history: CorpusHistoryTurn[]) {
  const searched = new Map<string, Person>();
  for (const turn of history) for (const observation of turn.observations || []) {
    const items = ((observation as { result?: { items?: unknown } } | null)?.result?.items);
    if (Array.isArray(items)) for (const item of items as Person[]) if (item && typeof item.id === 'string') searched.set(item.id, item);
  }
  const saved = new Map(savedByTheWork(history).map(item => [item.id, item]));
  return who.map((entry, index) => {
    const providerId = typeof entry === 'string' ? null : entry.providerId || null;
    const n = providerId ? simNumber(providerId) || 100 + index : 0;
    const id = providerId ? leadIdFor(n) : (typeof entry === 'string' ? entry : entry.leadId || leadIdFor(200 + index));
    const known = saved.get(id) ?? null;
    const person = providerId ? searched.get(providerId) ?? null : searched.get(id) ?? null;
    return { id, n: n || 300 + index, name: known?.name ?? person?.name ?? null, company: known?.company ?? person?.company ?? null,
      email: known?.email ?? (person as { email?: string | null } | null)?.email ?? null, known: Boolean(known) };
  });
}

/** What an approved effect returns, as server/cowork/effects.ts records it: its reply and its result. */
export function simulateEffect(proposal: NonNullable<CorpusTurnResult['proposal']>, history: CorpusHistoryTurn[]): { reply: string; result: unknown } {
  switch (proposal.kind) {
    case 'lead_prepare_batch': {
      const goal = proposal.prepareBatch?.goal ?? 'save';
      const needsEmail = goal === 'email' || goal === 'research';
      const people = batchPeople(proposal.who ?? [], history);
      let lookups = 0;
      const items = people.map(person => {
        const looked = needsEmail && !person.email;
        if (looked) lookups += 1;
        const email = person.email ?? (looked ? emailOf(person, person.n) : null);
        const steps = [{ step: 'save', status: person.known ? 'reused' : 'done' },
          ...(goal === 'linkedin' ? [{ step: 'linkedin', status: 'done' }] : []),
          ...(needsEmail ? [!looked ? { step: 'enrich', status: 'reused' } : email ? { step: 'enrich', status: 'done' } : { step: 'enrich', status: 'failed', detail: 'El proveedor no encontró su correo.' }] : []),
          ...(goal === 'research' ? [email ? { step: 'research', status: 'done' } : { step: 'research', status: 'skipped', detail: 'No se investigó: primero hay que buscar su correo.' }] : [])];
        return { id: person.id, name: person.name, company: person.company, status: steps.every(step => step.status !== 'failed' && step.status !== 'skipped') ? 'ready' : 'partial', steps,
          email, emailStatus: email ? 'verified' : null, linkedinUrl: goal === 'linkedin' ? `https://www.linkedin.com/in/sim-${person.n}` : null,
          research: goal === 'research' && email ? 'queued' : null };
      });
      const withEmail = items.filter(item => item.email).length;
      const researched = items.filter(item => item.research).length;
      const parts = [`Guardé ${items.filter(item => item.steps[0].status === 'done').length} contactos${items.some(item => item.steps[0].status === 'reused') ? ` (${items.filter(item => item.steps[0].status === 'reused').length} ya estaban)` : ''}`,
        ...(needsEmail ? [`${withEmail} de ${items.length} tienen correo`] : []), ...(goal === 'research' ? [`pedí la investigación de ${researched}`] : [])];
      return { reply: `${parts.join('; ')}.`,
        result: { items, cost: { saves: items.length, lookups: needsEmail ? lookups : goal === 'linkedin' ? items.length : 0, research: goal === 'research' ? items.length : 0 } } };
    }
    case 'enrich_batch': {
      const people = batchPeople((proposal.who ?? []).map(entry => typeof entry === 'string' ? { leadId: entry } : entry), history);
      const items = people.map(person => {
        const email = person.email ?? emailOf(person, person.n);
        return { leadId: person.id, name: person.name, found: Boolean(email), email, emailStatus: email ? 'verified' : null, reused: Boolean(person.email) };
      });
      return { reply: `Busqué el correo de ${items.length} contactos y encontré ${items.filter(item => item.found).length}.`, result: { items } };
    }
    case 'save_contact':
      return { reply: 'El contacto quedó guardado en tus contactos.', result: { leadId: leadIdFor(50), reused: false } };
    case 'enrich_contact':
      return { reply: 'Encontramos su correo (verified). Quedó guardado en el contacto enriquecido.', result: { email: 'contacto@empresa.cl', emailStatus: 'verified', found: true, reused: false } };
    case 'start_research':
      return { reply: 'La investigación quedó en curso y suele tardar unos minutos. Cuando termine, te aviso en esta conversación con lo más útil para escribirle.',
        result: { reportId: '00000000-0000-4000-9200-000000000001', status: 'queued', reused: false, ...(proposal.targetId ? { leadId: proposal.targetId } : {}) } };
    case 'campaign_create':
      return { reply: `La campaña «${(proposal.campaign as { name?: string } | undefined)?.name || 'Campaña'}» quedó creada como borrador pausado. Actívala cuando quieras desde Campañas o pídeme revisarla.`,
        result: { campaignId: '00000000-0000-4000-9300-000000000001', status: 'paused' } };
    case 'campaign_activate':
      return { reply: 'La campaña quedó aprobada. La automatización procesará los envíos elegibles.', result: { campaignId: proposal.targetId ?? null, status: 'active' } };
    case 'task_plan':
      return { reply: 'La tarea quedó aprobada: empiezo por su primer paso.', result: { status: 'running', steps: proposal.task?.steps.length ?? 0, plan: proposal.task ?? null } };
    case 'memory_save':
      return { reply: 'Lo recordaré.', result: { saved: true } };
    default:
      return { reply: 'Quedó hecho.', result: { status: 'done' } };
  }
}

/** The contacts the approved batches of this work saved, with the title the search gave them. */
function savedByTheWork(history: CorpusHistoryTurn[]): Saved[] {
  const titles = new Map<string, string>();
  const industries = new Map<string, string>();
  for (const turn of history) for (const observation of turn.observations || []) {
    const items = (observation as { result?: { items?: unknown } } | null)?.result?.items;
    if (Array.isArray(items)) for (const item of items as Array<Person & { industry?: string | null }>) {
      if (item?.name && item.title) titles.set(item.name, item.title);
      if (item?.name && item.industry) industries.set(item.name, item.industry);
    }
  }
  const saved = new Map<string, Saved>();
  const keep = (id: string, item: { name?: string | null; company?: string | null; email?: string | null }) => {
    const before = saved.get(id);
    const name = item.name ?? before?.name ?? null;
    // A later batch that did not look the email up again never forgets the one found before.
    saved.set(id, { id, name, company: item.company ?? before?.company ?? null, title: (name && titles.get(name)) || before?.title || null, email: item.email ?? before?.email ?? null,
      industry: (name && industries.get(name)) || before?.industry || null });
  };
  for (const turn of history) for (const action of (turn.actions || []) as Array<{ kind?: string; result?: { items?: unknown } }>) {
    if (!Array.isArray(action.result?.items)) continue;
    if (action.kind === 'lead_prepare_batch') for (const item of action.result.items as Array<{ id: string; name: string | null; company: string | null; email?: string | null }>) keep(item.id, item);
    if (action.kind === 'enrich_batch') for (const item of action.result.items as Array<{ leadId: string; name?: string | null; email?: string | null }>) keep(item.leadId, item);
  }
  return [...saved.values()];
}

/** What a finished research says, by sector: two facts dated within the last month, the kind a first email can open with. */
const SIGNALS: Record<string, (company: string) => string[]> = {
  Retail: company => [`${company} publicó el 12 de septiembre de 2026 avisos para 40 vendedores y cajeros de temporada navideña en Santiago`, `${company} abrirá una tienda nueva en Puente Alto en noviembre de 2026`],
  'Minería': company => [`${company} anunció el 9 de septiembre de 2026 la ampliación de su planta concentradora, con 300 trabajadores contratistas`, `${company} busca operadores de camiones de alto tonelaje en Antofagasta desde el 15 de septiembre de 2026`],
  'Logística': company => [`${company} inauguró el 10 de septiembre de 2026 un centro de distribución en Pudahuel`, `${company} publicó 35 vacantes de operarios de bodega para el peak de fin de año`],
  'Construcción': company => [`${company} se adjudicó el 8 de septiembre de 2026 la construcción de un CESFAM en Maipú`, `${company} busca supervisores de obra y capataces para proyectos en la Región Metropolitana`],
};

/** The researches this work asked for (by batch, research «queued», or one at a time): those a notice already told as finished, and those
 * still waiting for theirs. Each notice covers every research asked before it, as the worker sends one per conversation with all that finished. */
function researchesOf(history: CorpusHistoryTurn[]) {
  const finished = new Set<string>();
  let waiting = new Set<string>();
  for (const turn of history) {
    if (/^Termin(?:ó la investigación|aron las investigaciones) que pediste/.test(turn.request)) { waiting.forEach(id => finished.add(id)); waiting = new Set(); }
    for (const action of (turn.actions || []) as Array<{ kind?: string; result?: { items?: unknown; leadId?: string } }>) {
      if (action.kind === 'lead_prepare_batch' && Array.isArray(action.result?.items)) {
        for (const item of action.result.items as Array<{ id: string; research?: string | null }>) if (item.research === 'queued' && !finished.has(item.id)) waiting.add(item.id);
      }
      if (action.kind === 'start_research' && action.result?.leadId && !finished.has(action.result.leadId)) waiting.add(action.result.leadId);
    }
  }
  return { finished: [...finished], waiting: [...waiting] };
}

/** The research of a contact as research.get_existing reads it once it finished, from the sector the search gave its company. */
function finishedResearch(person: Saved) {
  const company = person.company || 'La empresa';
  const findings = (SIGNALS[person.industry || ''] ?? (name => [`${name} publicó el 11 de septiembre de 2026 vacantes para su área de operaciones`]))(company);
  return { scope: 'own_research', availability: 'available', research: { snapshotId: `00000000-0000-4000-9400-${person.id.slice(-12)}`, status: 'completed',
    capturedAt: CORPUS_NOW.toISOString(), summary: `${company} es una empresa de ${(person.industry || 'servicios').toLowerCase()} con operación en Chile.`,
    findings, sources: [{ id: 's1', title: `Noticias de ${company}`, url: `https://www.${slug(company)}.cl/noticias` }] } };
}

/** The account as the next turn reads it: the corpus account, plus the contacts this work saved (its campaign may go to them). */
export function taskWorld(history: CorpusHistoryTurn[], request = ''): CorpusWorld {
  const saved = savedByTheWork(history);
  // The request of this turn counts: the turn that resumes with a research notice reads those researches finished.
  const research = researchesOf([...history, { request, reply: '', at: CORPUS_NOW.toISOString() }]);
  // The campaigns this work created, newest first, as campaigns.list shows them.
  const created = history.flatMap(turn => ((turn.actions || []) as Array<{ kind?: string; label?: string; result?: { campaignId?: string; status?: string } }>)
    .filter(action => action.kind === 'campaign_create' && action.result?.campaignId)
    .map(action => ({ id: action.result!.campaignId, name: /«([^»]+)»/.exec(action.label || '')?.[1] || 'Campaña', status: action.result!.status || 'paused', revision: 1,
      recipients: Number(/(\d+) destinatario/.exec(action.label || '')?.[1]) || saved.filter(item => item.email).length, createdAt: CORPUS_NOW.toISOString() }))).reverse();
  return {
    savedEmails: [...CORPUS_SAVED_EMAILS, ...saved.flatMap(item => item.email ? [item.email] : [])],
    read: (action, input) => {
      const found = corpusRead(action, input);
      // The id alone, or the JSON with it that a model sometimes sends.
      const asked = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.exec(input)?.[0] ?? '';
      if (action === 'research.get_existing' && research.finished.includes(asked)) {
        const person = saved.find(item => item.id === asked);
        if (person) return finishedResearch(person);
      }
      if (action === 'campaigns.list' && created.length) {
        const listed = found as { campaigns?: unknown[] };
        return { ...listed, campaigns: [...created, ...(listed.campaigns ?? [])] };
      }
      if (action !== 'leads.search' || !saved.length) return found;
      const term = input.toLowerCase();
      const withEmail = /(?:^|\s)con\s+(?:correo|email|mail)(?=\s|$)/.test(term);
      const words = term.split(/\s+/).filter(word => word.length > 2 && !['con', 'correo', 'email', 'mail', 'los', 'las', 'del', 'que', 'sin'].includes(word));
      const mine = saved.filter(item => (!withEmail || item.email) && (!words.length || words.some(word => `${item.name} ${item.company} ${item.title}`.toLowerCase().includes(word))))
        .map(item => ({ ...item, status: 'saved', created_at: CORPUS_NOW.toISOString() }));
      if (!mine.length) return found;
      const result = found as { items?: unknown[] };
      const items = [...mine, ...(result.items ?? [])].slice(0, 25);
      return { ...result, items, returned: items.length };
    },
  };
}

/** A request the worker wrote on its own (a continuation or a notice), not the person. */
const automatic = (request: string) => /^(?:Continúa |El usuario aprobó el plan de la tarea|Termin(?:ó la investigación|aron las investigaciones) que pediste)/.test(request);

/** Whether a turn's request goes on with an approved task: the worker's own, or a reply of the person that goes on with it, after what the turn before left open. */
const goesOn = (request: string, before: CorpusHistoryTurn | undefined) =>
  automatic(request) || coworkTaskReplyContinues(request, before?.open ?? { asked: false, offered: [] });

/** What an answer leaves open for the person (its question, its buttons and choices), as the next turn's task reads it. */
const leftOpen = (result: CorpusTurnResult) => {
  const offered = [...(result.suggestions || []).map(item => item.message), ...(result.choices?.options || [])];
  const asked = Boolean(result.question) || (result.choices?.options?.length ?? 0) > 0;
  return asked || offered.length ? { open: { asked, offered } } : {};
};

/** The approved task the next turn continues, as loadCoworkActiveTask finds it: approved in this work, and since then only the worker's
 * own turns and the person's replies that go on with it (a «sí», the answer to what it asked). */
export function activeTask(history: CorpusHistoryTurn[], nextRequest: string) {
  let start = -1;
  history.forEach((turn, index) => { if ((turn.actions as Array<{ kind?: string }> | undefined)?.some(action => action.kind === 'task_plan')) start = index; });
  if (start < 0 || !goesOn(nextRequest, history.at(-1)) || history.slice(start + 1).some((turn, index) => !goesOn(turn.request, history[start + index]))) return null;
  const plan = ((history[start].actions as Array<{ kind?: string; result?: { plan?: CoworkTaskPlan | null } }>).find(action => action.kind === 'task_plan')?.result?.plan) ?? null;
  if (!plan) return null;
  const after = history.slice(start + 1);
  const effects = after.flatMap(turn => (turn.actions || []) as Array<{ kind?: string; result?: { cost?: { lookups?: number } } }>);
  const searches = after.filter(turn => (turn.observations || []).some(observation => (observation as { action?: string } | null)?.action === 'prospecting.search')).length;
  const credits = effects.reduce((sum, action) => sum + (action.result?.cost?.lookups ?? 0), 0);
  const done = new Set<string>([
    ...(searches ? ['search'] : []),
    ...(effects.some(action => ['lead_prepare_batch', 'save_contact', 'enrich_contact', 'start_research', 'enrich_batch'].includes(String(action.kind))) ? ['prepare'] : []),
    ...(after.some(turn => (turn.blocks || []).some(block => block.type === 'email_draft' || block.type === 'sequence')) ? ['write'] : []),
    ...(effects.some(action => action.kind === 'campaign_create') ? ['campaign'] : []),
  ]);
  const task: CoworkActiveTask = { startRunId: '00000000-0000-4000-9500-000000000001', startDepth: 0, plan, used: { steps: effects.length + searches, searches, credits } };
  return { plan, next: plan.steps.find(step => !done.has(step.kind)) ?? null, context: coworkTaskContext(task),
    /** Whether the worker approves this proposal by itself (worker.ts, coworkTaskApproves): the person never sees its card. */
    approves: (kind: string, cost: { searches: number; credits: number }) => coworkTaskApproves(task, kind === 'search' ? null : kind, cost) };
}

/** After a memory is saved, production does not resume: the person writes next. Every other approval resumes on its own. */
export const resumesAfter = (kind: string) => kind !== 'memory_save';

/** The cards and the document of an answer, which the next turn's history carries as conversation-context.ts loads them. */
const shown = (result: CorpusTurnResult) => ({ ...(result.blocks?.length ? { blocks: result.blocks } : {}), ...(result.document ? { document: result.document } : {}) });

/** The request of the next turn and what the history keeps of this one. */
export function nextTurn(task: CoworkTask, turn: { request: string; at: string; result: CorpusTurnResult; observations: unknown[] }, history: CorpusHistoryTurn[], answered: number):
  { request: string | null; turn: CorpusHistoryTurn; approved: { kind: string; reply: string; result: unknown } | null } | null {
  const { result } = turn;
  const said = result.proposal || result.search ? result.note || result.reply : result.reply;
  if (result.failed) return null;
  if (result.search) {
    const found = simulateSearch(result.search);
    return { request: COWORK_CONTINUE_AFTER_SEARCH, approved: { kind: 'search', reply: `Búsqueda completada: ${found.returned} resultados.`, result: found },
      turn: { request: turn.request, reply: said, at: turn.at, observations: [...turn.observations.slice(-2), { action: 'prospecting.search', input: result.search, result: found }] } };
  }
  if (result.proposal) {
    const effect = simulateEffect(result.proposal, history);
    if (!resumesAfter(result.proposal.kind)) return null;
    return { request: coworkContinuationAfter(result.proposal.kind), approved: { kind: result.proposal.kind, ...effect },
      turn: { request: turn.request, reply: said, at: turn.at, observations: turn.observations.slice(-3),
        actions: [{ kind: result.proposal.kind, label: result.proposal.label, outcome: 'ejecutada', result: effect.result }] } };
  }
  // Inside an approved task, a delivery with steps left goes on by itself: the worker admits the next step (worker.ts, with the task graph).
  // What this turn delivered counts: a turn that wrote the emails completed the write step.
  // An answer that asks the person waits for them (worker.ts), and their answer goes on with the task.
  const kept: CorpusHistoryTurn = { request: turn.request, reply: said, at: turn.at, observations: turn.observations.slice(-3), ...shown(result), ...leftOpen(result) };
  const running = activeTask([...history, kept], COWORK_CONTINUE_AFTER_PLAN);
  if (running?.next && !kept.open?.asked) return { request: coworkContinueTask(running.next.label), approved: null, turn: kept };
  // Researches asked for in this work finish a few minutes later: the worker resumes the conversation with its notice (research-notice.ts),
  // whatever the last answer asked.
  const research = researchesOf([...history, kept]);
  if (research.waiting.length) {
    const saved = savedByTheWork(history);
    const done = research.waiting.map(leadId => { const person = saved.find(item => item.id === leadId); return { leadId, name: person?.name ?? null, company: person?.company ?? null, status: 'completed' }; });
    return { request: coworkResearchNoticeMessage(done), approved: null, turn: kept };
  }
  // An answer that asks something: the person answers it (with the task's own words first) and the work goes on.
  const asks = Boolean(result.question) || (result.choices?.options?.length ?? 0) > 0;
  if (!asks) return null;
  // null: the person answers in their own words (the evaluator asks its simulated person; offline it is «Sí, adelante.»).
  return { request: task.answers?.[answered] ?? null, approved: null, turn: kept };
}

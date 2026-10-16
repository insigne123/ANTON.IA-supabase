// «Evaluación con uso real»: each section graded by what people actually did in the app (the usage report's facts and the
// credit journal) and by their own conversations with Cowork, read without emails, phones or RUTs. Pure: the script
// scripts/evaluate-real-usage.ts reads production and calls these; nothing here touches a database or a model.
import { USAGE_MODULES, type CreditDay, type UsageFact, type UsageModule } from '@/lib/admin/usage';

// ---------------------------------------------------------------------------------------------------------------------
// Personal data out before anything is graded or written.

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const RUT = /\b\d{1,2}\.?\d{3}\.?\d{3}-[\dkK]\b/g;
const INTERNATIONAL_PHONE = /\+\d[\d\s().-]{7,}\d/g;
const CHILE_MOBILE = /\b9[\s.-]?\d{4}[\s.-]?\d{4}\b/g;

/** The same text without emails, RUTs or phone numbers; names stay, so a conversation still reads as one. */
export function redactPersonalData(text: string): string {
  return text.replace(EMAIL, '[correo]').replace(RUT, '[RUT]').replace(INTERNATIONAL_PHONE, '[teléfono]').replace(CHILE_MOBILE, '[teléfono]');
}

// ---------------------------------------------------------------------------------------------------------------------
// Cowork conversations rebuilt from runs and their events.

export type RealRun = {
  id: string; userId: string; organizationId: string; message: string; status: string; createdAt: string;
  parentRunId: string | null; rootRunId: string | null;
  /** The worker's own continuations (a research notice, the step after an approval): not something the person typed. */
  automatic: boolean;
};
export type RealEvent = { runId: string; kind: string; payload: unknown; createdAt: string };

export type RealTurn = {
  runId: string; request: string; automatic: boolean; reply: string | null; document: string | null; status: string;
  seconds: number | null; approvals: string[]; effects: string[]; failed: string | null; at: string;
  /** What the turn read (each tool call and its result), redacted: the judge needs it to tell a supported answer from an invented one. */
  observations: unknown[];
  /** The answer as stored for the chat (reply, cards, question, chips, choices), redacted: what the person saw on screen. */
  answer: Record<string, unknown> | null;
};
export type RealConversation = { id: string; userId: string; organizationId: string; startedAt: string; turns: RealTurn[] };

/** Redaction leaves JSON valid: every replacement is plain text inside a string. */
const redactJson = (value: Record<string, unknown>) => JSON.parse(redactPersonalData(JSON.stringify(value))) as Record<string, unknown>;
const text = (value: unknown) => typeof value === 'string' ? value : '';
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** One conversation per root run, its turns in order, each with what the person saw: the reply, a document, a card to approve or a failure. */
export function buildRealConversations(runs: RealRun[], events: RealEvent[]): RealConversation[] {
  const byRun = new Map<string, RealEvent[]>();
  for (const event of events) byRun.set(event.runId, [...(byRun.get(event.runId) || []), event]);
  const conversations = new Map<string, RealConversation>();
  for (const run of [...runs].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const own = (byRun.get(run.id) || []).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const completed = own.find(event => event.kind === 'run.completed');
    const failed = own.find(event => event.kind === 'run.failed');
    const ended = completed || failed || own.find(event => event.kind === 'run.cancelled');
    const document = record(record(completed?.payload).document);
    const turn: RealTurn = {
      runId: run.id, request: redactPersonalData(run.message || ''), automatic: run.automatic, status: run.status, at: run.createdAt,
      reply: completed ? redactPersonalData(text(record(completed.payload).reply)) || null : null,
      document: completed && text(document.title) ? redactPersonalData(text(document.title)) : null,
      seconds: ended ? Math.max(0, Math.round((Date.parse(ended.createdAt) - Date.parse(run.createdAt)) / 1000)) : null,
      approvals: own.filter(event => event.kind === 'approval.requested').map(event => redactPersonalData(text(record(event.payload).label) || text(record(event.payload).kind))),
      effects: own.filter(event => event.kind === 'effect.completed').map(event => redactPersonalData(text(record(event.payload).label) || text(record(event.payload).kind))),
      failed: failed ? redactPersonalData(text(record(failed.payload).message)) || 'falló' : null,
      answer: completed ? redactJson(record(completed.payload)) : null,
      observations: own.filter(event => event.kind === 'tool.completed')
        .map(event => redactJson(record(event.payload))),
    };
    const id = run.rootRunId || run.parentRunId || run.id;
    const conversation = conversations.get(id) || { id, userId: run.userId, organizationId: run.organizationId, startedAt: run.createdAt, turns: [] };
    conversation.turns.push(turn);
    conversations.set(id, conversation);
  }
  return [...conversations.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

export type ConversationSignal = 'fallo' | 'lento' | 'repite' | 'frustracion' | 'sin_respuesta' | 'error_visible' | 'aprobacion_sin_respuesta';
export const SIGNAL_LABELS: Record<ConversationSignal, string> = {
  fallo: 'un turno falló', lento: 'un turno tardó más de un minuto', repite: 'repitió casi la misma respuesta',
  frustracion: 'la persona mostró frustración', sin_respuesta: 'un turno quedó sin respuesta', error_visible: 'la respuesta habla de un error',
  aprobacion_sin_respuesta: 'propuso algo para aprobar y no se ejecutó',
};
const FRUSTRATION = /\b(otra vez|de nuevo lo mismo|lo mismo|no (me )?sirve|no entiendo|no es eso|no funciona|no hace nada|ya te dije|no era eso|mal hecho)\b/i;
const VISIBLE_ERROR = /ocurri[oó] un (error|problema)|no pude (completar|terminar|hacer)|intenta(lo)? (de )?nuevo/i;
const SLOW_SECONDS = 60;

const words = (value: string) => new Set(value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').match(/[a-z0-9ñ]{3,}/g) || []);
/** Share of words two answers have in common (Jaccard): near 1 the person got the same answer twice. */
export function replySimilarity(a: string, b: string): number {
  const left = words(a), right = words(b);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared++;
  return shared / (left.size + right.size - shared);
}

/** What a person would notice went wrong, read from the conversation alone. */
export function conversationSignals(conversation: RealConversation): ConversationSignal[] {
  const found = new Set<ConversationSignal>();
  const turns = conversation.turns;
  turns.forEach((turn, index) => {
    if (turn.failed || turn.status === 'failed') found.add('fallo');
    if ((turn.seconds ?? 0) > SLOW_SECONDS) found.add('lento');
    if (!turn.automatic && FRUSTRATION.test(turn.request)) found.add('frustracion');
    if (!turn.reply && !turn.failed && turn.status !== 'waiting_approval') found.add('sin_respuesta');
    if (turn.reply && VISIBLE_ERROR.test(turn.reply)) found.add('error_visible');
    const previous = turns.slice(0, index).reverse().find(item => item.reply);
    if (turn.reply && previous?.reply && replySimilarity(turn.reply, previous.reply) >= 0.8) found.add('repite');
  });
  const asked = turns.reduce((sum, turn) => sum + turn.approvals.length, 0);
  const done = turns.reduce((sum, turn) => sum + turn.effects.length, 0);
  if (asked > done) found.add('aprobacion_sin_respuesta');
  return [...found];
}

// ---------------------------------------------------------------------------------------------------------------------
// Each section by how it is used: who used it, how much, whether it worked and what it produced.

export type SectionHealth = {
  module: UsageModule; name: string; people: number; uses: number;
  /** Share of attempts that ended well, when the section has attempts that can fail (research, Cowork). */
  reliability: number | null;
  /** What it produced, in the section's own unit. */
  outcome: string | null;
  signal: 'bien' | 'atencion' | 'sin_uso';
  notes: string[];
};

const sum = (items: Array<{ count?: number; net?: number }>, key: 'count' | 'net') => items.reduce((total, item) => total + (Number(item[key]) || 0), 0);
const percent = (value: number) => `${Math.round(value * 100)} %`;

/**
 * The thresholds are deliberately plain, so anyone can read why a section is flagged: no use by anyone is «sin uso»;
 * a section where fewer than 7 of 10 attempts end well, or that nobody but one person opens in a team of five or more,
 * needs «atención».
 */
export function sectionHealth(input: { facts: UsageFact[]; credits: CreditDay[]; activePeople: number }): SectionHealth[] {
  const facts = input.facts, credits = input.credits;
  const of = (section: UsageModule) => facts.filter(fact => fact.module === section);
  const people = (items: Array<{ userId: string | null }>) => new Set(items.map(item => item.userId).filter(Boolean)).size;
  const kind = (items: UsageFact[], name: string, status?: string) => items.filter(fact => fact.kind === name && (!status || fact.status === status));
  const rows: SectionHealth[] = [];
  const push = (section: UsageModule, uses: number, users: number, reliability: number | null, outcome: string | null, notes: string[] = []) => {
    const lowReliability = reliability !== null && reliability < 0.7;
    const narrow = input.activePeople >= 5 && users === 1;
    rows.push({ module: section, name: USAGE_MODULES[section], people: users, uses, reliability, outcome,
      signal: uses === 0 ? 'sin_uso' : lowReliability || narrow ? 'atencion' : 'bien',
      notes: [...notes, ...(lowReliability ? [`solo ${percent(reliability!)} de los intentos termina completo`] : []),
        ...(narrow ? ['la usa una sola persona del equipo'] : [])] });
  };

  const search = of('search'), searches = sum(kind(search, 'search_requested'), 'count');
  const searchCredits = credits.filter(credit => credit.resource === 'search');
  push('search', searches, Math.max(people(kind(search, 'search_requested')), people(searchCredits.filter(c => c.net > 0))), null,
    searches ? `${searches} búsquedas` : null);

  const contacts = of('contacts'), saved = sum(kind(contacts, 'contact_saved'), 'count');
  const enrichCredits = credits.filter(credit => credit.resource === 'enrich'), enriched = sum(enrichCredits, 'net');
  push('contacts', saved + enriched, Math.max(people(kind(contacts, 'contact_saved')), people(enrichCredits.filter(c => c.net > 0))), null,
    `${saved} contactos guardados · ${enriched} enriquecimientos`,
    saved && enriched / saved < 0.2 ? ['pocos contactos guardados llegan a tener su correo buscado'] : []);

  const research = of('research');
  const researchOk = sum(kind(research, 'research_completed'), 'count');
  const researchPartial = sum(kind(research, 'research_requested', 'partial'), 'count');
  const researchEmpty = sum(kind(research, 'research_requested', 'insufficient_data'), 'count') + sum(kind(research, 'research_requested', 'failed'), 'count');
  const researchEnded = researchOk + researchPartial + researchEmpty;
  push('research', researchEnded, Math.max(people(research), people(credits.filter(c => c.resource === 'investigate' && c.net > 0))),
    researchEnded ? researchOk / researchEnded : null,
    researchEnded ? `${researchOk} completas · ${researchPartial} parciales · ${researchEmpty} sin datos` : null);

  const email = of('email');
  const drafts = sum(kind(email, 'draft_prepared'), 'count'), sent = sum(kind(email, 'contact_sent'), 'count'), replies = sum(kind(email, 'human_reply'), 'count');
  push('email', drafts + sent, people(email.filter(fact => fact.kind !== 'module_opened')), null,
    drafts || sent ? `${drafts} borradores · ${sent} enviados · ${replies} respuestas` : null,
    drafts >= 10 && sent / drafts < 0.1 ? ['casi ningún borrador termina enviado'] : []);

  const cowork = of('cowork'), turns = kind(cowork, 'cowork_turn');
  const coworkOk = sum(turns.filter(fact => fact.status === 'completed'), 'count');
  const coworkFailed = sum(turns.filter(fact => fact.status === 'failed'), 'count');
  push('cowork', sum(turns, 'count'), people(turns), coworkOk + coworkFailed ? coworkOk / (coworkOk + coworkFailed) : null,
    turns.length ? `${sum(turns, 'count')} turnos` : null);

  for (const section of ['opportunities', 'campaigns', 'crm', 'linkedin'] as const) {
    const items = of(section);
    push(section, sum(items, 'count'), people(items), null, items.length ? `${sum(items, 'count')} visitas` : null);
  }
  return rows;
}

// ---------------------------------------------------------------------------------------------------------------------
// Per person (only with --people: the report for a team's lead), enrichments first.

export type PersonUsage = { userId: string; name: string; enriched: number; searches: number; saved: number; research: number;
  drafts: number; sent: number; coworkTurns: number; lastAt: string | null };

export function peopleUsage(input: { facts: UsageFact[]; credits: CreditDay[]; people: Array<{ id: string; name: string }> }): PersonUsage[] {
  return input.people.map(person => {
    const facts = input.facts.filter(fact => fact.userId === person.id), credits = input.credits.filter(credit => credit.userId === person.id);
    const count = (kind: string) => sum(facts.filter(fact => fact.kind === kind), 'count');
    const net = (resource: CreditDay['resource']) => sum(credits.filter(credit => credit.resource === resource), 'net');
    const last = facts.map(fact => fact.lastAt).filter(Boolean).sort().at(-1) ?? null;
    return { userId: person.id, name: person.name, enriched: net('enrich'), searches: Math.max(count('search_requested'), net('search')),
      saved: count('contact_saved'), research: count('research_completed'), drafts: count('draft_prepared'), sent: count('contact_sent'),
      coworkTurns: count('cowork_turn'), lastAt: last };
  }).sort((a, b) => b.enriched - a.enriched || b.searches - a.searches || a.name.localeCompare(b.name));
}

export function renderPeopleTable(rows: PersonUsage[]): string[] {
  return ['| Persona | Enriquecimientos | Búsquedas | Guardados | Investigaciones | Borradores | Enviados | Última actividad |',
    '|---|---|---|---|---|---|---|---|',
    ...rows.map(row => `| ${row.name} | ${row.enriched} | ${row.searches} | ${row.saved} | ${row.research} | ${row.drafts} | ${row.sent} | ${row.lastAt ? row.lastAt.slice(0, 10) : '—'} |`)];
}

// ---------------------------------------------------------------------------------------------------------------------
// The report.

export type JudgedTurn = { conversationId: string; runId: string; at: string; scores: Record<string, number>; veredicto: string; problemas: string[] };

export function renderRealUsageReport(input: {
  from: string; to: string; organizations: Array<{ id: string; name: string; members: number; active: number; health: SectionHealth[]; people?: PersonUsage[] }>;
  conversations: RealConversation[]; judged?: JudgedTurn[]; coverageFrom?: string | null;
}): string {
  const lines: string[] = [`# Evaluación con uso real · ${input.from} a ${input.to}`, ''];
  if (input.coverageFrom) lines.push(`El detalle de visitas y acciones se registra desde el ${input.coverageFrom.slice(0, 10)}; los créditos, desde antes.`, '');
  const mark = { bien: 'Bien', atencion: 'Atención', sin_uso: 'Sin uso' } as const;
  for (const org of input.organizations) {
    lines.push(`## ${org.name}`, '', `${org.active} de ${org.members} personas usaron la app en el período.`, '',
      '| Sección | Personas | Uso | Funciona | Resultado | Señal |', '|---|---|---|---|---|---|');
    for (const row of org.health) {
      lines.push(`| ${row.name} | ${row.people} | ${row.uses} | ${row.reliability === null ? '—' : percent(row.reliability)} | ${row.outcome || '—'} | ${mark[row.signal]}${row.notes.length ? ` · ${row.notes.join('; ')}` : ''} |`);
    }
    lines.push('');
    if (org.people?.length) lines.push('### Por persona', '', ...renderPeopleTable(org.people), '');
  }
  const signals = input.conversations.map(conversation => ({ conversation, signals: conversationSignals(conversation) }));
  const turns = input.conversations.reduce((total, conversation) => total + conversation.turns.length, 0);
  lines.push('## Cowork: conversaciones reales', '', `${input.conversations.length} conversaciones, ${turns} turnos.`, '');
  const counts = new Map<ConversationSignal, number>();
  for (const item of signals) for (const signal of item.signals) counts.set(signal, (counts.get(signal) || 0) + 1);
  if (counts.size) {
    lines.push('| Señal | Conversaciones |', '|---|---|');
    for (const [signal, count] of [...counts].sort((a, b) => b[1] - a[1])) lines.push(`| ${SIGNAL_LABELS[signal]} | ${count} |`);
    lines.push('');
  }
  if (input.judged?.length) {
    // The whole period and its last seven days apart: older answers predate the latest changes.
    const recentFrom = new Date(Date.parse(`${input.to}T23:59:59Z`) - 7 * 86_400_000).toISOString();
    const summary = (label: string, items: JudgedTurn[]) => {
      if (!items.length) return;
      const dimensions = Object.keys(items[0].scores);
      const mean = (key: string) => Math.round(items.reduce((total, item) => total + (item.scores[key] || 0), 0) / items.length * 10) / 10;
      const verdicts = (name: string) => items.filter(item => item.veredicto === name).length;
      lines.push(`${label} (${items.length} respuestas): ${dimensions.map(key => `${key} ${mean(key)}`).join(' · ')}. ` +
        `Veredictos: ${verdicts('buena')} buenas, ${verdicts('mejorable')} mejorables, ${verdicts('mala')} malas.`, '');
    };
    lines.push('Juez: otro modelo, con la misma pauta que la batería y los datos que leyó cada turno.', '');
    summary('Todo el período', input.judged);
    summary('Últimos 7 días', input.judged.filter(item => item.at >= recentFrom));
  }
  const review = signals.filter(item => item.signals.length).slice(-10);
  if (review.length) {
    lines.push('### Para revisar', '');
    for (const { conversation, signals: found } of review) {
      const first = conversation.turns.find(turn => !turn.automatic) || conversation.turns[0];
      lines.push(`- ${conversation.startedAt.slice(0, 16).replace('T', ' ')} · «${clip(first.request, 120)}» · ${found.map(signal => SIGNAL_LABELS[signal]).join(', ')}`);
    }
    lines.push('');
  }
  const bad = (input.judged || []).filter(item => item.veredicto !== 'buena' && item.problemas.length).slice(0, 10);
  if (bad.length) {
    lines.push('### Lo que el juez marcó', '');
    for (const item of bad) lines.push(`- ${item.problemas.map(problem => clip(problem, 200)).join(' / ')}`);
    lines.push('');
  }
  return lines.join('\n');
}

const clip = (value: string, max: number) => value.length > max ? `${value.slice(0, max - 1)}…` : value;

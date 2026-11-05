import { collectCoworkLeadRows } from './lead-export';

/**
 * Long conversations that remember, like a chat (docs/cowork-conversaciones-largas.md, «Memoria larga», 5 nov 2026). A turn reads
 * its last turns whole (history); before this, what came earlier was lost except for the summary the model kept (threadMemory). On
 * 29 Oct a person asked «guarda las 5 personas de la segunda búsqueda» ten turns after that search, and Cowork answered that it no
 * longer had their names. Now the turn also reads the rest of the conversation from the database:
 *  - earlierTurns: every turn before history in a line or two (what was asked, what was answered, what was done);
 *  - searches: every external search of the conversation, numbered as the conversation numbered them, with its people and their ids.
 * The people of those searches can be saved, prepared or researched from any later turn: the checks that only take people the
 * conversation saw read the same searches (coworkWithRecallArchive and the batch's own check in prepare-batch.ts).
 * Everything here is pure; the server reads it in src/lib/server/cowork/thread-recall.ts.
 */

export const COWORK_RECALL_LIMITS = {
  /** Runs of one conversation that are read (a conversation is capped at 200 model calls, so a few hundred turns at most). */
  runs: 500,
  /** Characters of the context for the earlier turns and for the searches. */
  earlierChars: 30_000,
  searchChars: 40_000,
  /** The emails and sequences written before history: the latest version of each. */
  emailChars: 12_000,
  emailBody: 2_500,
  stepBody: 1_200,
  /** Per earlier turn: the request, the reply and each line of what was done. */
  request: 300,
  reply: 500,
  line: 160,
  /** Per person of a search. */
  field: 80,
} as const;

export type CoworkRecallRun = { id: string; parentId: string | null; message: string; status: string; createdAt: string | null; depth: number };

/** The runs a run continues, oldest first: from the first message of the conversation to `fromId`, included. It stops at a run it
 * cannot see (older than what was read) or at a loop. */
export function coworkBranch(runs: CoworkRecallRun[], fromId: string | null, max: number = COWORK_RECALL_LIMITS.runs): CoworkRecallRun[] {
  const byId = new Map(runs.map(run => [run.id, run]));
  const branch: CoworkRecallRun[] = [];
  const seen = new Set<string>();
  for (let cursor = fromId; cursor && branch.length < max && !seen.has(cursor);) {
    const run = byId.get(cursor);
    if (!run) break;
    seen.add(cursor);
    branch.push(run);
    cursor = run.parentId;
  }
  return branch.reverse();
}

const clip = (value: unknown, max: number) => {
  const text = typeof value === 'string' || typeof value === 'number' ? String(value).replace(/\s+/g, ' ').trim() : '';
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
};

// ---------------------------------------------------------------------------------------------------------------------------------
// Searches

/** One external search as the conversation recorded it: the read (tool.completed) of the run that made it. */
export type CoworkRecallSearchEntry = { runId: string; at: string | null; asked: string; payload: unknown };

export type CoworkRecallPerson = {
  id: string; name: string | null; title: string | null; company: string | null; location?: string | null;
  /** Why the person is on the list (search-ranking.ts). */
  fit?: string | null;
  /** The person is among the user's contacts now: this id is the saved contact (leadId). */
  savedLeadId?: string;
};

export type CoworkRecallSearch = {
  /** Búsqueda 1, 2, 3… in the order the conversation made them. */
  n: number;
  runId: string;
  at: string | null;
  /** What the person asked in the turn of the search. */
  asked: string | null;
  /** What was searched: roles, places, sectors… */
  criteria: string | null;
  kind: 'personas' | 'empresas';
  found: number;
  people: CoworkRecallPerson[];
  /** People left out of this list to fit the context (the first ones stay). */
  peopleOmitted?: number;
  /** This search is also whole in history: its people are there too. */
  inHistory?: true;
};

const SKIPPED_CRITERIA = new Set(['page', 'limit', 'offset', 'strategy', 'target', 'next', 'cursor']);

/** The criteria of a search in one line («titles: Gerente de Compras, Jefe de Operaciones · locations: Concepción, Chile»). */
export function coworkSearchCriteria(input: unknown): string | null {
  if (typeof input === 'string') return clip(input, 300);
  if (!input || typeof input !== 'object') return null;
  const parts: string[] = [];
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (SKIPPED_CRITERIA.has(key) || value === null || value === undefined || value === '') continue;
    const text = Array.isArray(value) ? value.filter(item => typeof item === 'string' || typeof item === 'number').join(', ')
      : typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : '';
    if (text) parts.push(`${key}: ${text}`);
  }
  return clip(parts.join(' · '), 300);
}

const isSearch = (payload: unknown) => Boolean(payload && typeof payload === 'object' && (payload as { action?: unknown }).action === 'prospecting.search');

/**
 * Every external search of the conversation, numbered in order, with its people (their ids as the search returned them, and the saved
 * contact when the person is saved now). Within `budget` characters: the searches that history also carries whole lose their list
 * first; then the longest lists are cut, keeping their first people, and say how many they left out.
 */
export function coworkThreadSearches(entries: CoworkRecallSearchEntry[], options: {
  saved?: ReadonlyMap<string, string>; inHistory?: ReadonlySet<string>; budget?: number;
} = {}): CoworkRecallSearch[] {
  const budget = options.budget ?? COWORK_RECALL_LIMITS.searchChars;
  const searches: CoworkRecallSearch[] = [];
  for (const entry of entries) {
    if (!isSearch(entry.payload)) continue;
    const payload = entry.payload as { input?: unknown; result?: { scope?: unknown } | null };
    const companies = payload.result?.scope === 'external_company_search';
    const rows = collectCoworkLeadRows([payload]);
    const people: CoworkRecallPerson[] = rows.map(row => {
      // Saved now, or already among the contacts when the search ran («En tus contactos»).
      const savedLeadId = options.saved?.get(row.id) ?? row.savedLeadId;
      return {
        id: row.id, name: clip(row.name, COWORK_RECALL_LIMITS.field), title: clip(row.title, COWORK_RECALL_LIMITS.field),
        company: clip(row.company, COWORK_RECALL_LIMITS.field),
        ...(clip(row.location, COWORK_RECALL_LIMITS.field) ? { location: clip(row.location, COWORK_RECALL_LIMITS.field) } : {}),
        ...(clip(row.fit, COWORK_RECALL_LIMITS.field) ? { fit: clip(row.fit, COWORK_RECALL_LIMITS.field) } : {}),
        ...(savedLeadId ? { savedLeadId } : {}),
      };
    });
    searches.push({
      n: searches.length + 1, runId: entry.runId, at: entry.at, asked: clip(entry.asked, 200), criteria: coworkSearchCriteria(payload.input),
      kind: companies ? 'empresas' : 'personas', found: people.length, people,
      ...(options.inHistory?.has(entry.runId) ? { inHistory: true as const } : {}),
    });
  }
  const size = () => JSON.stringify(searches).length;
  if (size() <= budget) return searches;
  // The lists history already shows go first: they are still there, whole.
  for (const search of searches) {
    if (!search.inHistory || !search.people.length) continue;
    search.peopleOmitted = (search.peopleOmitted ?? 0) + search.people.length;
    search.people = [];
  }
  // Then the longest lists get shorter, a few people at a time, until everything fits.
  while (size() > budget) {
    const longest = searches.reduce<CoworkRecallSearch | null>((best, search) => (!best || search.people.length > best.people.length ? search : best), null);
    if (!longest || !longest.people.length) break;
    const cut = Math.max(1, Math.ceil(longest.people.length / 4));
    longest.people = longest.people.slice(0, longest.people.length - cut);
    longest.peopleOmitted = (longest.peopleOmitted ?? 0) + cut;
  }
  return searches;
}

/** The searches as the checks of a proposal read them (observationRunId, effectTargetRun): one turn per run, before history. */
export function coworkRecallArchive(entries: CoworkRecallSearchEntry[]): Array<{ runId: string; observations: unknown[] }> {
  const turns: Array<{ runId: string; observations: unknown[] }> = [];
  for (const entry of entries) {
    if (!isSearch(entry.payload)) continue;
    const last = turns.at(-1);
    if (last?.runId === entry.runId) last.observations.push(entry.payload);
    else turns.push({ runId: entry.runId, observations: [entry.payload] });
  }
  return turns;
}

/**
 * The history the checks of a proposal read: the searches of the whole conversation first, then the turns of history. The last turn
 * stays the last one (what «sí» answers), and a person of an old search can be the target of a card, anchored to the run that found
 * them (that run is what saving them reads again).
 */
export function coworkWithRecallArchive<T extends { runId: string; observations: unknown[] }>(
  archive: Array<{ runId: string; observations: unknown[] }>, turns: T[],
): Array<T | { runId: string; observations: unknown[] }> {
  return archive.length ? [...archive, ...turns] : turns;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Earlier turns

export type CoworkRecallTurnInput = {
  runId: string; at: string | null; message: string; automatic: boolean; status: string;
  reply: string | null; document: string | null;
  /** The cards of the answer, as it stored them (blocks of run.completed). */
  blocks: unknown[];
  /** What was done in that turn: approved actions and how they ended, contacts saved from the panel. */
  actions: string[];
  /** The searches of that turn (their numbers in searches). */
  searches: number[];
};

export type CoworkEarlierTurn = {
  at: string | null;
  /** What the person asked; absent when the turn was an automatic continuation (automatic: true). */
  request?: string | null;
  automatic?: true;
  reply: string | null;
  status?: string;
  document?: string | null;
  cards?: string[];
  actions?: string[];
  searches?: number[];
};

const CARD_NAMES: Record<string, string> = { email_draft: 'Correo', sequence: 'Secuencia', table: 'Tabla', metrics: 'Cifras', chart: 'Gráfico' };

/** The kind and title of each card of an answer («Correo: Correo corto para peaks y reemplazos»). */
export function coworkRecallCards(blocks: unknown): string[] {
  if (!Array.isArray(blocks)) return [];
  return blocks.flatMap(block => {
    if (!block || typeof block !== 'object') return [];
    const { type, title } = block as { type?: unknown; title?: unknown };
    if (typeof type !== 'string') return [];
    const label = clip(title, 90);
    return [label ? `${CARD_NAMES[type] ?? type}: ${label}` : CARD_NAMES[type] ?? type];
  });
}

function condense(turn: CoworkRecallTurnInput, short: boolean): CoworkEarlierTurn {
  const requestChars = short ? COWORK_RECALL_LIMITS.line : COWORK_RECALL_LIMITS.request;
  const replyChars = short ? COWORK_RECALL_LIMITS.line : COWORK_RECALL_LIMITS.reply;
  const cards = coworkRecallCards(turn.blocks);
  return {
    at: turn.at,
    ...(turn.automatic ? { automatic: true as const } : { request: clip(turn.message, requestChars) }),
    reply: clip(turn.reply, replyChars),
    ...(turn.status && turn.status !== 'completed' ? { status: turn.status } : {}),
    ...(turn.document ? { document: clip(turn.document, 120) } : {}),
    ...(!short && cards.length ? { cards: cards.slice(0, 4) } : {}),
    ...(turn.actions.length ? { actions: turn.actions.slice(0, short ? 2 : 4).map(action => clip(action, COWORK_RECALL_LIMITS.line)!).filter(Boolean) } : {}),
    ...(turn.searches.length ? { searches: turn.searches } : {}),
  };
}

/**
 * Every turn before history, oldest first, in a line or two. Within `budget` characters: the turns get shorter first; then the oldest
 * ones after the first go (the first request also travels whole in threadMemory), and `omitted` says how many.
 */
export function coworkEarlierTurns(turns: CoworkRecallTurnInput[], budget: number = COWORK_RECALL_LIMITS.earlierChars): { turns: CoworkEarlierTurn[]; omitted: number } {
  let condensed = turns.map(turn => condense(turn, false));
  const size = (items: CoworkEarlierTurn[]) => JSON.stringify(items).length;
  if (size(condensed) <= budget) return { turns: condensed, omitted: 0 };
  condensed = turns.map(turn => condense(turn, true));
  let omitted = 0;
  while (condensed.length > 1 && size(condensed) > budget) {
    condensed.splice(1, 1);
    omitted += 1;
  }
  return { turns: condensed, omitted };
}

export type CoworkRecallEmail = { at: string | null; title: string; subject?: string; body?: string; steps?: Array<{ day: number; subject: string; body: string }> };

/**
 * The emails and sequences the conversation wrote before history, so «muéstrame el primer correo que hicimos» shows it: the latest
 * version of each one (by title), leaving out those history shows with the same title (a newer version). Newest first within
 * `budget` characters, each body cut to a fair size.
 */
export function coworkEarlierEmails(turns: Array<{ at: string | null; blocks: unknown[] }>, historyTitles: ReadonlySet<string> = new Set(),
  budget: number = COWORK_RECALL_LIMITS.emailChars): CoworkRecallEmail[] {
  const latest = new Map<string, CoworkRecallEmail>();
  const shown = new Set([...historyTitles].map(title => clip(title, 120)));
  for (const turn of turns) {
    for (const block of Array.isArray(turn.blocks) ? turn.blocks : []) {
      const card = block as { type?: unknown; title?: unknown; subject?: unknown; body?: unknown; steps?: unknown };
      const title = clip(card?.title, 120);
      if (!title || shown.has(title) || (card.type !== 'email_draft' && card.type !== 'sequence')) continue;
      const email: CoworkRecallEmail = card.type === 'email_draft'
        ? { at: turn.at, title, subject: clip(card.subject, 200) ?? '', body: clipBody(card.body, COWORK_RECALL_LIMITS.emailBody) }
        : { at: turn.at, title, steps: (Array.isArray(card.steps) ? card.steps : []).slice(0, 6).map(step => {
          const { day, subject, body } = (step || {}) as { day?: unknown; subject?: unknown; body?: unknown };
          return { day: typeof day === 'number' ? day : 0, subject: clip(subject, 200) ?? '', body: clipBody(body, COWORK_RECALL_LIMITS.stepBody) };
        }) };
      latest.delete(title);
      latest.set(title, email);
    }
  }
  const newestFirst = [...latest.values()].reverse();
  const kept: CoworkRecallEmail[] = [];
  for (const email of newestFirst) {
    if (JSON.stringify([...kept, email]).length > budget) break;
    kept.push(email);
  }
  return kept;
}

/** A body keeps its lines (an email is read as written), cut at `max` characters. */
function clipBody(value: unknown, max: number) {
  const text = typeof value === 'string' ? value.replace(/\r\n?/g, '\n').trim() : '';
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The context

const RECALL_INSTRUCTION = 'threadRecall es la memoria completa de esta conversación, además de history (sus últimos turnos completos). '
  + 'earlierTurns resume en orden cada turno anterior a history: lo que pidió el usuario (request), lo que respondiste (reply), las tarjetas (cards) y lo que se hizo (actions); automatic marca un paso que siguió solo. '
  + 'searches son todas las búsquedas externas de la conversación, numeradas en el orden en que se hicieron (Búsqueda 1, 2, 3…), con lo que se pidió, sus criterios y sus personas con sus ids; inHistory dice que esa búsqueda también está completa en history. '
  + 'Cuando el usuario se refiere a algo de antes («la segunda búsqueda», «el correo que hicimos», «lo que te pedí al principio»), búscalo aquí antes de responder y nunca digas que no tienes algo que está aquí. '
  + 'emails trae la última versión de los correos y secuencias que escribiste antes de history (los de history están allí): úsalos tal cual cuando el usuario pida volver a uno. '
  + 'Para guardar a personas de searches, buscar su correo o investigarlas, usa su id tal cual (apollo:…) como providerId en contacts.prepare_batch o leads.save_contact: sirve aunque ya estén en sus contactos (savedLeadId lo indica, y el lote no repite lo que ya tienen). '
  + 'No hace falta buscarlas de nuevo: una búsqueda que ya está aquí no se repite ni cuenta para el límite de búsquedas de este paso (threadBudget dice cuántas quedan).';

export type CoworkThreadRecall = {
  instruction: string;
  earlierTurns?: CoworkEarlierTurn[];
  earlierTurnsOmitted?: number;
  searches?: CoworkRecallSearch[];
  emails?: CoworkRecallEmail[];
};

/** What the decision context carries about the whole conversation beyond history, or null when there is nothing more. */
export function coworkThreadRecallContext(input: { earlierTurns: CoworkEarlierTurn[]; earlierTurnsOmitted: number; searches: CoworkRecallSearch[];
  emails?: CoworkRecallEmail[] }): CoworkThreadRecall | null {
  if (!input.earlierTurns.length && !input.searches.length && !input.emails?.length) return null;
  return {
    instruction: RECALL_INSTRUCTION,
    ...(input.earlierTurns.length ? { earlierTurns: input.earlierTurns } : {}),
    ...(input.earlierTurnsOmitted ? { earlierTurnsOmitted: input.earlierTurnsOmitted } : {}),
    ...(input.searches.length ? { searches: input.searches } : {}),
    ...(input.emails?.length ? { emails: input.emails } : {}),
  };
}

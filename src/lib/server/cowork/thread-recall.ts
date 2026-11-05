import type { SupabaseClient } from '@supabase/supabase-js';
import {
  COWORK_RECALL_LIMITS, coworkBranch, coworkEarlierEmails, coworkEarlierTurns, coworkRecallArchive, coworkThreadRecallContext, coworkThreadSearches,
  type CoworkRecallRun, type CoworkRecallSearchEntry, type CoworkThreadRecall,
} from '@/lib/cowork/thread-recall';

/**
 * The whole conversation behind a turn, read from the database in a few reads (docs/cowork-conversaciones-largas.md, «Memoria
 * larga»): its runs by root_run_id (migration 20261001220000, indexed), the branch this turn continues walked in memory, and the
 * events of that branch in chunks. Best effort for the context: without it a turn reads its history as before.
 */

type Scope = { userId: string; organizationId: string };
type Run = { id: string; root_run_id?: string | null; parent_run_id?: string | null };
/** A read of cowork_run_events being narrowed: the filters this module uses, typed loosely (the columns are built at run time). */
export type CoworkEventQuery = PromiseLike<{ data: unknown; error: unknown }> & {
  eq(column: string, value: unknown): CoworkEventQuery;
  in(column: string, values: readonly unknown[]): CoworkEventQuery;
};

/** Ids per read: a hundred uuids keep the request line short. */
const CHUNK = 100;

function chunks<T>(items: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size));
  return out;
}

/** The runs of a conversation, newest first (the ones a long conversation needs are the latest). */
async function conversationRuns(client: SupabaseClient, scope: Scope, rootId: string): Promise<CoworkRecallRun[]> {
  const { data, error } = await client.from('cowork_runs').select('id,parent_run_id,message,status,created_at,depth')
    .eq('user_id', scope.userId).eq('organization_id', scope.organizationId).eq('root_run_id', rootId)
    .order('created_at', { ascending: false }).limit(COWORK_RECALL_LIMITS.runs);
  if (error) throw new Error('Conversation runs unavailable');
  return ((data || []) as Array<Record<string, unknown>>).map(row => ({
    id: String(row.id), parentId: typeof row.parent_run_id === 'string' ? row.parent_run_id : null, message: String(row.message ?? ''),
    status: String(row.status ?? ''), createdAt: typeof row.created_at === 'string' ? row.created_at : null, depth: Number(row.depth) || 0,
  }));
}

/** The events of these runs that `filter` keeps, in their order (run by run as given, then by sequence). */
export async function coworkEventsIn<T extends Record<string, unknown>>(client: SupabaseClient, scope: Scope, runIds: string[], fields: string,
  filter: (query: CoworkEventQuery) => CoworkEventQuery): Promise<T[]> {
  if (!runIds.length) return [];
  const columns: string = `run_id,sequence,${fields}`;
  const events = () => client.from('cowork_run_events').select(columns) as unknown as CoworkEventQuery;
  const reads = await Promise.all(chunks(runIds).map(ids => filter(events()
    .eq('user_id', scope.userId).eq('organization_id', scope.organizationId).in('run_id', ids))));
  const rows: T[] = [];
  for (const read of reads as Array<{ data: unknown; error: unknown }>) {
    if (read.error) throw new Error('Conversation events unavailable');
    rows.push(...((read.data || []) as T[]));
  }
  const order = new Map(runIds.map((id, index) => [id, index]));
  return rows.sort((a, b) => (order.get(String(a.run_id)) ?? 0) - (order.get(String(b.run_id)) ?? 0) || Number(a.sequence) - Number(b.sequence));
}

/**
 * This run and every run it continues, newest first, up to the first message of the conversation (or as far back as the conversation's
 * latest runs reach). What a batch checks its people against: anyone the conversation saw, however long ago.
 */
export async function coworkBranchRunIds(client: SupabaseClient, scope: Scope, runId: string): Promise<string[]> {
  const run = await client.from('cowork_runs').select('id,root_run_id').eq('id', runId)
    .eq('user_id', scope.userId).eq('organization_id', scope.organizationId).maybeSingle();
  if (run.error || !run.data) throw new Error('Conversation runs unavailable');
  const row = run.data as { id: string; root_run_id?: string | null };
  const branch = coworkBranch(await conversationRuns(client, scope, row.root_run_id || row.id), runId);
  return branch.length ? branch.map(item => item.id).reverse() : [runId];
}

/** Which of these people of a search are among the person's contacts now («apollo:…» → saved contact id). */
async function savedByProvider(client: SupabaseClient, scope: Scope, providerIds: string[]) {
  const saved = new Map<string, string>();
  const keys = [...new Set(providerIds.filter(id => id.startsWith('apollo:')).map(id => id.slice(7)))];
  if (!keys.length) return saved;
  const reads = await Promise.all(chunks(keys).flatMap(ids => ['apollo_id', 'source_provider_id'].map(column => client.from('leads')
    .select('id,apollo_id,source_provider_id').eq('organization_id', scope.organizationId).eq('user_id', scope.userId).in(column, ids)
    .order('created_at', { ascending: true }))));
  for (const read of reads as Array<{ data: unknown; error: unknown }>) {
    if (read.error) throw new Error('Saved contacts unavailable');
    for (const lead of (read.data || []) as Array<{ id: string; apollo_id?: string | null; source_provider_id?: string | null }>) {
      for (const key of [lead.apollo_id, lead.source_provider_id]) if (key && !saved.has(`apollo:${key}`)) saved.set(`apollo:${key}`, lead.id);
    }
  }
  return saved;
}

export type CoworkLoadedRecall = {
  /** What the decision context carries (threadRecall), or null when the conversation has nothing beyond history. */
  context: CoworkThreadRecall | null;
  /** The searches of the conversation as the checks of a proposal read them (coworkWithRecallArchive). */
  archive: Array<{ runId: string; observations: unknown[] }>;
  /** The runs of the branch, newest first, and whether they reach the first message. */
  branch: { runIds: string[]; complete: boolean };
};

const ACTION_OUTCOME: Record<string, string> = { 'effect.completed': 'ejecutada', 'effect.failed': 'falló' };

/**
 * Everything of the conversation behind `run` that history does not carry whole: the earlier turns condensed, every external search
 * with its people (and who of them is saved now), and the emails written before history. `historyRunIds` are the turns history
 * carries; `historyTitles` the titles of the emails it shows. Null for the first turn of a conversation.
 */
export async function loadCoworkThreadRecall(client: SupabaseClient, scope: Scope, run: Run,
  history: { runIds: string[]; emailTitles?: string[] }): Promise<CoworkLoadedRecall | null> {
  const parentId = run.parent_run_id || null;
  if (!parentId) return null;
  const runs = await conversationRuns(client, scope, run.root_run_id || parentId);
  const branch = coworkBranch(runs, parentId);
  if (!branch.length) return null;
  const branchIds = branch.map(item => item.id);
  const inHistory = new Set(history.runIds);
  const older = branch.filter(item => !inHistory.has(item.id));
  const olderIds = older.map(item => item.id);
  type Row = Record<string, unknown> & { run_id: string };
  const [searchRows, answers, effects, saves] = await Promise.all([
    coworkEventsIn<Row>(client, scope, branchIds, 'payload', query => query.eq('kind', 'tool.completed').eq('payload->>action', 'prospecting.search')),
    coworkEventsIn<Row>(client, scope, olderIds, 'reply:payload->>reply,document:payload->document->>title,blocks:payload->blocks',
      query => query.eq('kind', 'run.completed')),
    coworkEventsIn<Row>(client, scope, olderIds, 'kind,effect:payload->>kind,label:payload->>label', query => query.in('kind', ['effect.completed', 'effect.failed'])),
    coworkEventsIn<Row>(client, scope, olderIds, 'name:payload->>name,company:payload->>company', query => query.eq('kind', 'contact.saved')),
  ]);
  const byId = new Map(branch.map(item => [item.id, item]));
  // What the person asked in the turn of each search: the message of that run, or of the turn an automatic step continued.
  const askedFor = (runId: string) => {
    for (let index = branchIds.indexOf(runId); index >= 0; index--) if (branch[index].depth <= 0) return branch[index].message;
    return byId.get(runId)?.message ?? '';
  };
  const entries: CoworkRecallSearchEntry[] = searchRows.map(row => ({ runId: row.run_id, at: byId.get(row.run_id)?.createdAt ?? null,
    asked: askedFor(row.run_id), payload: row.payload }));
  const providerIds = entries.flatMap(entry => {
    const items = ((entry.payload as { result?: { items?: unknown } } | null)?.result?.items);
    return Array.isArray(items) ? items.flatMap(item => (typeof (item as { id?: unknown })?.id === 'string' ? [(item as { id: string }).id] : [])) : [];
  });
  const saved = await savedByProvider(client, scope, providerIds).catch(() => new Map<string, string>());
  const searches = coworkThreadSearches(entries, { saved, inHistory });
  const searchNumbers = new Map<string, number[]>();
  for (const search of searches) searchNumbers.set(search.runId, [...(searchNumbers.get(search.runId) ?? []), search.n]);
  // The latest answer of each earlier turn.
  const answer = new Map<string, Row>();
  for (const row of answers) answer.set(row.run_id, row);
  const actions = new Map<string, string[]>();
  const did = (runId: string, line: string) => actions.set(runId, [...(actions.get(runId) ?? []), line]);
  for (const row of effects) did(row.run_id, `${String(row.label || row.effect || 'Acción')} (${ACTION_OUTCOME[String(row.kind)] ?? 'ejecutada'})`);
  for (const row of saves) {
    const who = [row.name, row.company].filter(value => typeof value === 'string' && value).join(' · ');
    did(row.run_id, `Guardaste desde el panel a ${who || 'un contacto'}`);
  }
  const turns = older.map(item => {
    const reply = answer.get(item.id);
    return {
      runId: item.id, at: item.createdAt, message: item.message, automatic: item.depth > 0, status: item.status,
      reply: typeof reply?.reply === 'string' ? reply.reply : null, document: typeof reply?.document === 'string' ? reply.document : null,
      blocks: Array.isArray(reply?.blocks) ? reply.blocks as unknown[] : [],
      actions: actions.get(item.id) ?? [], searches: searchNumbers.get(item.id) ?? [],
    };
  });
  const earlier = coworkEarlierTurns(turns);
  const emails = coworkEarlierEmails(turns, new Set(history.emailTitles ?? []));
  return {
    context: coworkThreadRecallContext({ earlierTurns: earlier.turns, earlierTurnsOmitted: earlier.omitted, searches, emails }),
    archive: coworkRecallArchive(entries),
    branch: { runIds: [...branchIds].reverse(), complete: branch[0].parentId === null },
  };
}

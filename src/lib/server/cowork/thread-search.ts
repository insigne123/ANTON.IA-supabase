import type { AuthContext } from '@/lib/server/auth-utils';

/** How far back a search reads: the runs the list shows and some more, so a search costs as little as opening Cowork. */
const SEARCH_RUNS = 300;
export const COWORK_SEARCH_MIN = 3;

export type CoworkThreadMatch = { rootId: string; snippet: string };

/** The words around what was found, so the list can show where it is. */
export function coworkSearchSnippet(text: string, term: string, room = 48) {
  const clean = text.replace(/\s+/g, ' ').trim();
  const at = clean.toLocaleLowerCase('es').indexOf(term.toLocaleLowerCase('es'));
  if (at < 0) return clean.slice(0, room * 2);
  const start = Math.max(0, at - room), end = Math.min(clean.length, at + term.length + room);
  return `${start > 0 ? '…' : ''}${clean.slice(start, end).trim()}${end < clean.length ? '…' : ''}`;
}

/**
 * Conversations whose messages or answers say `term` (COW-09): until now the list only filtered by name. Reads the person's own
 * recent runs and the answers of those runs (RLS: own rows, with Cowork access), one match per conversation, the newest first.
 */
export async function searchCoworkThreads(auth: AuthContext, term: string, { hiddenRootIds = [] }: { hiddenRootIds?: string[] } = {}): Promise<CoworkThreadMatch[]> {
  const query = term.replace(/\s+/g, ' ').trim().slice(0, 80);
  if (query.length < COWORK_SEARCH_MIN) return [];
  const { data: runs, error } = await auth.supabase.from('cowork_runs').select('id,root_run_id,message,created_at')
    .eq('user_id', auth.user.id).eq('organization_id', auth.organizationId).order('created_at', { ascending: false }).limit(SEARCH_RUNS);
  if (error) throw error;
  const rows = (runs || []) as Array<{ id: string; root_run_id: string | null; message: string | null }>;
  const rootOf = new Map(rows.map(run => [run.id, run.root_run_id || run.id]));
  const hidden = new Set(hiddenRootIds);
  const matches = new Map<string, string>();
  const needle = query.toLocaleLowerCase('es');
  const add = (runId: string, text: string) => {
    const rootId = rootOf.get(runId);
    if (rootId && !hidden.has(rootId) && !matches.has(rootId)) matches.set(rootId, coworkSearchSnippet(text, query));
  };
  // What the person asked: in the runs already read, newest first.
  for (const run of rows) if ((run.message || '').toLocaleLowerCase('es').includes(needle)) add(run.id, run.message || '');
  // What Cowork answered: the finished answers of those runs, by their index on run_id.
  const ids = rows.map(run => run.id);
  const escaped = query.replace(/[\\%_]/g, '\\$&');
  for (let index = 0; index < ids.length; index += 100) {
    const { data: answers, error: answerError } = await auth.supabase.from('cowork_run_events').select('run_id,reply:payload->>reply')
      .eq('user_id', auth.user.id).eq('organization_id', auth.organizationId).eq('kind', 'run.completed')
      .in('run_id', ids.slice(index, index + 100)).ilike('payload->>reply', `%${escaped}%`).limit(100);
    if (answerError) throw answerError;
    for (const answer of (answers || []) as Array<{ run_id: string; reply: string | null }>) add(answer.run_id, answer.reply || '');
  }
  // Newest conversation first, as the list.
  const order = new Map<string, number>();
  rows.forEach((run, index) => { const rootId = run.root_run_id || run.id; if (!order.has(rootId)) order.set(rootId, index); });
  return [...matches.entries()].sort((a, b) => (order.get(a[0]) ?? 0) - (order.get(b[0]) ?? 0)).slice(0, 50)
    .map(([rootId, snippet]) => ({ rootId, snippet }));
}

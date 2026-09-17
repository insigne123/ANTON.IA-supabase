import type { AuthContext } from '@/lib/server/auth-utils';
import { coworkThreadBudgets } from '@/lib/cowork/thread-budget';
import { getCoworkRun } from './runs';

/** Each lookup uses the caller's RLS client plus explicit organization/owner scope. */
export async function getCoworkThread(auth: AuthContext, id: string) {
  const current = await getCoworkRun(auth, id);
  if (!current) return null;
  const ancestors = [];
  const seen = new Set([id]);
  let cursor = current.run.parent_run_id as string | null;
  while (cursor && ancestors.length < 8) {
    if (seen.has(cursor)) throw new Error('Invalid thread ancestry');
    seen.add(cursor);
    const parent = await getCoworkRun(auth, cursor);
    // Fail closed rather than revealing a partially unauthorized thread.
    if (!parent) throw new Error('Thread context unavailable');
    ancestors.unshift(parent);
    cursor = parent.run.parent_run_id;
  }
  // Fase 1 (CW-06): surface the automatic-chain budget so the UI can explain
  // why a thread stopped chaining on its own.
  const budgets = coworkThreadBudgets(
    current.run.mode === 'autonomous' ? 'autonomous' : 'approval',
    process.env.COWORK_AUTONOMY_ENABLED === 'true');
  const depth = (current.run.depth as number) || 0;
  const budget = {
    depth, maxDepth: budgets.maxDepth,
    exhausted: current.events.some((event: { kind: string }) => event.kind === 'thread.budget_exhausted'),
  };
  return { ...current, ancestors, olderTurnsOmitted: Boolean(cursor), budget };
}

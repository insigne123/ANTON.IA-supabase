import { z } from 'zod';
import type { AuthContext } from '@/lib/server/auth-utils';
import { COWORK_FULL_LIST_MAX, queryCoworkLeads } from './lead-tools';
import { getCoworkRun } from './runs';

export class CoworkContactListRefused extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

/**
 * «Ver todos» (Plan 13): the whole list behind a search of your contacts that Cowork read cut at 20. The same query of that turn
 * (its recorded input) runs again on your own contacts, up to COWORK_FULL_LIST_MAX, with your session's client: it never reads
 * anyone else's, and the turn must be yours. Returns the rows as a read result, so the panel and the export treat them as the
 * turn's own.
 */
export async function loadCoworkFullContactList(auth: AuthContext, runId: string, sequence: number) {
  z.string().uuid().parse(runId);
  z.number().int().positive().parse(sequence);
  const state = await getCoworkRun(auth, runId);
  if (!state) throw new CoworkContactListRefused('Esa conversación ya no está disponible.', 404);
  const read = (state.events as Array<{ sequence: number; kind: string; payload: Record<string, unknown> }>)
    .find(event => event.sequence === sequence && event.kind === 'tool.completed' && event.payload?.action === 'leads.search');
  if (!read) throw new CoworkContactListRefused('Esa lista ya no está disponible.', 404);
  const input = typeof read.payload.input === 'string' ? read.payload.input : '';
  const result = await queryCoworkLeads(auth.supabase, { userId: auth.user.id, organizationId: auth.organizationId }, 'leads.search', input,
    { max: COWORK_FULL_LIST_MAX });
  return { action: 'leads.search' as const, input, result };
}

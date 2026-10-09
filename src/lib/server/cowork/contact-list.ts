import { z } from 'zod';
import type { AuthContext } from '@/lib/server/auth-utils';
import { COWORK_FULL_LIST_MAX, queryCoworkLeads } from './lead-tools';
import { getCoworkRun } from './runs';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { collectCoworkLeadRows } from '@/lib/cowork/lead-export';

export class CoworkContactListRefused extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

/**
 * «Ver todos» (Plan 13): the whole list behind a search of your contacts that Cowork read cut at 20. The same query of that turn
 * (its recorded input) runs again on your own contacts, up to COWORK_FULL_LIST_MAX, with your session's client: it never reads
 * anyone else's, and the turn must be yours. Returns the rows as a read result, so the panel and the export treat them as the
 * turn's own.
 */
export async function loadCoworkFullContactList(auth: AuthContext, runId: string, sequence: number,
  options: { storageClient?: Pick<AuthContext['supabase'], 'storage'> } = {}) {
  z.string().uuid().parse(runId);
  z.number().int().positive().parse(sequence);
  const state = await getCoworkRun(auth, runId);
  if (!state) throw new CoworkContactListRefused('Esa conversación ya no está disponible.', 404);
  const read = (state.events as Array<{ sequence: number; kind: string; payload: Record<string, unknown> }>)
    .find(event => event.sequence === sequence && event.kind === 'tool.completed' && event.payload?.action === 'leads.search');
  if (!read) throw new CoworkContactListRefused('Esa lista ya no está disponible.', 404);
  const input = typeof read.payload.input === 'string' ? read.payload.input : '';
  const key = `${auth.organizationId}/${auth.user.id}/${runId}/snapshots/contacts-${sequence}.json`;
  const bucket = (options.storageClient || getSupabaseAdminClient()).storage.from('cowork-artifacts');
  const decode = async (data: { arrayBuffer: () => Promise<ArrayBuffer> }) => {
    const bytes = Buffer.from(await data.arrayBuffer());
    if (bytes.length > 2 * 1024 * 1024) throw new Error('Snapshot exceeds budget');
    const frozen = JSON.parse(bytes.toString('utf8'));
    if (frozen.runId !== runId || frozen.sequence !== sequence || frozen.input !== input || frozen.result?.scope !== 'own_saved_contacts'
      || !Array.isArray(frozen.result.items) || collectCoworkLeadRows([{ action: 'leads.search', result: frozen.result }]).length !== frozen.result.items.length) throw new Error('Invalid contact snapshot');
    return { action: 'leads.search' as const, input, result: frozen.result, snapshot: { mode: 'frozen_after_expansion', observedAt: frozen.observedAt } };
  };
  const existing = await bucket.download(key);
  if (existing.data) return decode(existing.data);
  if (existing.error && !/not.?found|does not exist|missing/i.test(String(existing.error.message))) throw new Error('No se pudo recuperar la lista guardada.');
  const result = await queryCoworkLeads(auth.supabase, { userId: auth.user.id, organizationId: auth.organizationId }, 'leads.search', input,
    { max: COWORK_FULL_LIST_MAX });
  const frozen = { runId, sequence, input, result, observedAt: new Date().toISOString() };
  const stored = await bucket.upload(key, Buffer.from(JSON.stringify(frozen)), { upsert: false, contentType: 'application/json' });
  if (stored.error) {
    // Another request may have won publication: reuse its exact snapshot, not this fresh query.
    const winner = await bucket.download(key);
    if (!winner.data) throw new Error('No se pudo conservar la lista completa para descargarla.');
    return decode(winner.data);
  }
  return { action: 'leads.search' as const, input, result, snapshot: { mode: 'frozen_after_expansion', observedAt: frozen.observedAt } };
}

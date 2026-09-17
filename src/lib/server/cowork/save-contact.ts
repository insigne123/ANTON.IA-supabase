import { z } from 'zod';
import type { AuthContext } from '@/lib/server/auth-utils';
import { deterministicMessagingUuid } from '@/lib/messaging-contracts';
import { getCoworkRun } from './runs';
import { collectCoworkLeadRows } from '@/lib/cowork/lead-export';

export const coworkSaveContactSchema = z.object({ providerId: z.string().regex(/^apollo:[A-Za-z0-9_-]{1,200}$/) }).strict();

/** Insert only; retries never overwrite an existing contact or change its owner. */
export async function saveCoworkContact(auth: AuthContext, runId: string, input: unknown) {
  const { providerId } = coworkSaveContactSchema.parse(input);
  const state = await getCoworkRun(auth, runId);
  // Effects execute while the proposing run waits for approval; the persisted
  // observation check below remains the real guard against invented targets.
  if (!state || (state.run.status !== 'completed' && state.run.status !== 'waiting_approval')) throw new Error('COWORK_CONTACT_NOT_OBSERVED');
  const observed = collectCoworkLeadRows(state.events.filter((event: { kind: string }) => event.kind === 'tool.completed')
    .map((event: { payload: unknown }) => event.payload)).find(row => row.id === providerId);
  if (!observed) throw new Error('COWORK_CONTACT_NOT_OBSERVED');
  const apolloId = providerId.slice(7);
  const fields = 'id,name,title,company,email,status,industry,location';
  const existing = await auth.supabase.from('leads').select(fields)
    .eq('organization_id', auth.organizationId).eq('user_id', auth.user.id).eq('apollo_id', apolloId)
    .order('created_at', { ascending: true }).limit(1).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return { lead: existing.data, reused: true };
  const id = deterministicMessagingUuid(`cowork-apollo:${auth.organizationId}:${auth.user.id}:${apolloId}`);
  const result = await auth.supabase.from('leads').upsert({
    id, user_id: auth.user.id, organization_id: auth.organizationId,
    apollo_id: apolloId, source_provider: 'apollo', source_provider_id: apolloId,
    name: String(observed.name || 'Contacto sin nombre'), company: String(observed.company || ''),
    title: String(observed.title || ''), industry: observed.industry || null, location: observed.location || null,
    linkedin_url: observed.linkedin_url || null, company_website: observed.company_website || null,
    company_linkedin: observed.company_linkedin || null,
    email: null,
  }, { onConflict: 'id', ignoreDuplicates: true });
  if (result.error) throw result.error;
  const saved = await auth.supabase.from('leads').select(fields).eq('id', id)
    .eq('user_id', auth.user.id).eq('organization_id', auth.organizationId).single();
  if (saved.error || !saved.data) throw new Error('COWORK_CONTACT_SAVE_NOT_CONFIRMED');
  return { lead: saved.data, reused: false };
}

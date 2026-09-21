import { randomUUID } from 'node:crypto';
import { v5 as uuidv5 } from 'uuid';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

type Scope = { organizationId: string; userId: string };
export function extensionSendId(scope: Scope, profileUrl: string, message: string) {
  return uuidv5(JSON.stringify([scope.organizationId, scope.userId, profileUrl.toLowerCase(), message.trim()]), uuidv5.URL);
}
export async function claimExtensionSend(scope: Scope, lead: { id: string; linkedin_url: string }, message: string, db = getSupabaseAdminClient()) {
  const id = extensionSendId(scope, lead.linkedin_url, message);
  const claimToken = randomUUID();
  const { data, error } = await db.from('extension_linkedin_sends').upsert({
    id, organization_id: scope.organizationId, user_id: scope.userId, lead_id: lead.id,
    profile_url: lead.linkedin_url, message: message.trim(), claim_token: claimToken,
  }, { onConflict: 'id', ignoreDuplicates: true }).select('id,status');
  if (error) throw error;
  if (data?.length) return { id, claimed: true, claimToken, status: 'pending' };
  const prior = await db.from('extension_linkedin_sends').select('id,status').eq('id', id)
    .eq('organization_id', scope.organizationId).eq('user_id', scope.userId).single();
  if (prior.error) throw prior.error;
  return { id, claimed: false, status: prior.data.status };
}
export async function finishExtensionSend(scope: Scope, input: { id: string; claimToken: string; status: 'confirmed' | 'uncertain' | 'not_sent'; eventId?: string; threadUrl?: string; error?: string }, db = getSupabaseAdminClient()) {
  const { data, error } = await db.from('extension_linkedin_sends').update({
    status: input.status, event_id: input.eventId || null, thread_url: input.threadUrl || null,
    error: input.error || null, updated_at: new Date().toISOString(),
  }).eq('id', input.id).eq('organization_id', scope.organizationId).eq('user_id', scope.userId)
    .eq('claim_token', input.claimToken).eq('status', 'pending').select('id,status');
  if (error) throw error;
  if (data?.length) return data[0];
  const prior = await db.from('extension_linkedin_sends').select('id,status').eq('id', input.id)
    .eq('organization_id', scope.organizationId).eq('user_id', scope.userId).eq('claim_token', input.claimToken).single();
  if (prior.error || prior.data.status !== input.status) throw new Error('EXTENSION_SEND_RESULT_CONFLICT');
  return prior.data;
}

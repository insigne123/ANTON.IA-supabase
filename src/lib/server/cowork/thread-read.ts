import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { coworkReplyThread, type ThreadRow } from '@/lib/cowork/reply-thread';

type Scope = { userId: string; organizationId: string };

const COLUMNS = 'id,lead_id,name,email,company,role,provider,subject,sent_at,status,delivery_status,message_id,thread_id,conversation_id,'
  + 'replied_at,reply_intent,reply_sentiment,reply_summary,reply_subject,reply_preview,reply_snippet,last_reply_text,reply_confidence,conversation_outbound_at';

/** One conversation of this person, with what the contact answered, to draft the reply from. Only the person's own sends: a colleague's
 * conversation is theirs to answer, and the text of a stranger's reply is not something to copy into another person's run. */
export async function readCoworkReplyThread(client: SupabaseClient, scope: Scope, value: string,
  suppressed?: (email: string) => Promise<boolean>, nowMs = Date.now()) {
  const contactedId = z.string().uuid().parse(value);
  const { data, error } = await client.from('contacted_leads').select(COLUMNS)
    .eq('organization_id', scope.organizationId).eq('user_id', scope.userId).eq('id', contactedId).maybeSingle();
  if (error) throw new Error('No se pudo consultar la conversación.');
  if (!data) {
    return { scope: 'own_reply_thread' as const, available: false as const,
      reason: 'Esa conversación no es tuya o ya no existe: solo se leen los envíos propios.' };
  }
  const thread = coworkReplyThread(data as unknown as ThreadRow, nowMs);
  // Someone who unsubscribed after writing is not written to, however the intent was classified.
  let suppressedNow: boolean | null = null;
  if (suppressed && thread.email) {
    try { suppressedNow = await suppressed(thread.email); } catch { suppressedNow = null; }
  }
  return { ...thread, available: true as const, suppressed: suppressedNow,
    ...(suppressedNow ? { advice: 'unsubscribe_do_not_write' as const } : {}) };
}

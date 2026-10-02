import {
  conversationCloseOption,
  conversationCloseRefusal,
  type ConversationCloseOutcome,
  type ConversationTeamLock,
} from '@/lib/conversation-close';

/** A refusal the person can act on, with its HTTP status (the route answers with it). */
export class ConversationCloseError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = 'ConversationCloseError'; }
}

type Client = { from: (table: string) => any; rpc: (fn: string, args: Record<string, unknown>) => any };
type Scope = { userId: string; organizationId: string };

/** The team thread of a recipient, when the organization works as a team. Read with the person's own client (RLS). */
export async function readConversationTeamLock(client: Client, scope: Scope, email: string): Promise<ConversationTeamLock & { threadId: string | null }> {
  const org = await client.from('organizations').select('collaboration_v1_enabled').eq('id', scope.organizationId).maybeSingle();
  if (org.error) throw org.error;
  if (!org.data?.collaboration_v1_enabled) return { enabled: false, status: null, mine: false, threadId: null };
  const recipient = String(email || '').trim().toLowerCase();
  if (!recipient) return { enabled: true, status: null, mine: false, threadId: null };
  const thread = await client.from('organization_contact_threads').select('id,status,opened_by_user_id')
    .eq('organization_id', scope.organizationId).eq('channel', 'email').eq('recipient_key', recipient).maybeSingle();
  if (thread.error) throw thread.error;
  if (!thread.data) return { enabled: true, status: null, mine: false, threadId: null };
  return { enabled: true, status: thread.data.status, mine: thread.data.opened_by_user_id === scope.userId, threadId: thread.data.id };
}

/**
 * Closes a conversation of the person's own (Plan 5, PR-9a), in order:
 * 1. the team thread, when there is an active one: the database decides who may contact the person next and refuses
 *    what this person may not do;
 * 2. the conversation leaves «Por responder» (conversation_resolved_at, as «Marcar resuelto» did);
 * 3. «No interesado» stops this account's follow-ups to that address;
 * 4. the pipeline stage the person chose. A failure here does not undo the close; the result says so.
 */
export async function closeContactedConversation(client: Client, scope: Scope, input: { contactedId: string; outcome: ConversationCloseOutcome; observedAt: number }) {
  const option = conversationCloseOption(input.outcome);
  const row = await client.from('contacted_leads').select('id,lead_id,email')
    .eq('id', input.contactedId).eq('organization_id', scope.organizationId).eq('user_id', scope.userId).maybeSingle();
  if (row.error) throw row.error;
  if (!row.data) throw new ConversationCloseError('No puedes cerrar esta conversación', 403);

  const lock = await readConversationTeamLock(client, scope, row.data.email);
  let team: { status: string | null; changed: boolean } = { status: lock.status, changed: false };
  if (lock.threadId && lock.status === 'active') {
    const closed = await client.rpc('close_organization_contact_thread_v1', { p_contact_thread_id: lock.threadId, p_outcome: input.outcome });
    if (closed.error) {
      const refusal = conversationCloseRefusal(closed.error);
      if (refusal) throw new ConversationCloseError(refusal.message, refusal.status);
      throw closed.error;
    }
    team = { status: String(closed.data?.status || lock.status), changed: true };
  }

  const resolved = await client.from('contacted_leads').update({ conversation_resolved_at: new Date(input.observedAt).toISOString() })
    .eq('id', input.contactedId).eq('organization_id', scope.organizationId).eq('user_id', scope.userId).select('id').maybeSingle();
  if (resolved.error) throw resolved.error;

  if (option.doNotContact && row.data.email) {
    const stopped = await client.from('contacted_leads').update({
      campaign_followup_allowed: false,
      campaign_followup_reason: 'not_interested',
      evaluation_status: 'do_not_contact',
      last_update_at: new Date().toISOString(),
    }).eq('organization_id', scope.organizationId).eq('user_id', scope.userId).eq('email', row.data.email);
    if (stopped.error) throw stopped.error;
  }

  let stage: string | null = null;
  let stageSaved = true;
  if (option.stage && row.data.lead_id) {
    try {
      const leadId = String(row.data.lead_id);
      const existing = await client.from('unified_crm_data').select('id').eq('organization_id', scope.organizationId)
        .in('id', [`lead_saved|${leadId}`, `lead_enriched|${leadId}`]).limit(2);
      if (existing.error) throw existing.error;
      const saved = await client.from('leads').select('id').eq('id', leadId).maybeSingle();
      const gid = existing.data?.[0]?.id || (saved.data ? `lead_saved|${leadId}` : `lead_enriched|${leadId}`);
      const written = await client.from('unified_crm_data').upsert({ id: gid, organization_id: scope.organizationId, stage: option.stage, updated_at: new Date().toISOString() });
      if (written.error) throw written.error;
      stage = option.stage;
    } catch (error) {
      console.error('[conversation-close] stage not saved', error);
      stageSaved = false;
    }
  }
  return { outcome: input.outcome, team, stage, stageSaved };
}

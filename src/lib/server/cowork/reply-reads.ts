import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  accountConflicts, buildMeetingChain, selectAccountMembers, selectStalledInterested,
  type AccountMemberRow, type ChainEventRow,
} from '@/lib/reply-followup';

type Scope = { userId: string; organizationId: string };

export type MailboxCoverage = {
  gmail: { windowDays: number; windowComplete: boolean; lastCompletedAt: string | null; lastError: string | null } | null;
  outlook: { windowDays: number; windowComplete: boolean; lastCompletedAt: string | null; lastError: string | null } | null;
};

/** Durable sweep state per mailbox. Missing table (migration lag) degrades to
 * unknown coverage instead of failing the read. */
export async function readMailboxCoverage(client: SupabaseClient, scope: Scope): Promise<MailboxCoverage> {
  const empty: MailboxCoverage = { gmail: null, outlook: null };
  try {
    const { data, error } = await client.from('cowork_mailbox_sweep_state')
      .select('provider,window_days,page_token,last_completed_at,last_error')
      .eq('organization_id', scope.organizationId).eq('user_id', scope.userId).limit(2);
    if (error || !Array.isArray(data)) return empty;
    const pick = (provider: 'gmail' | 'outlook') => {
      const row = (data as Array<{ provider?: string; window_days?: number; page_token?: string | null; last_completed_at?: string | null; last_error?: string | null }>)
        .find((item) => item.provider === provider);
      if (!row) return null;
      return {
        windowDays: Number(row.window_days || 30),
        windowComplete: Boolean(row.last_completed_at && !row.page_token),
        lastCompletedAt: row.last_completed_at || null,
        lastError: row.last_error || null,
      };
    };
    return { gmail: pick('gmail'), outlook: pick('outlook') };
  } catch {
    return empty;
  }
}

function attentionAction(row: { delivery_status?: string | null; bounce_category?: string | null; reply_intent?: string | null; replied_at?: string | null }): string {
  if (!row.replied_at && !row.delivery_status) return 'classify_reply';
  if (row.reply_intent === 'auto_reply') return 'info_only';
  switch (row.bounce_category) {
    case 'mailbox_not_found': case 'domain_error': case 'left_company': return 'do_not_contact_fix_email';
    case 'mailbox_full': case 'temporary_failure': return 'retry_later';
    case 'policy_block': return 'review_deliverability';
    default: return row.delivery_status === 'bounced' ? 'do_not_contact_fix_email' : 'review_needed';
  }
}

/** 6.1 + 6.2 Bounces, blocks and unclassified replies with a recommended action.
 * Auto replies ride along as information only so they never inflate the count. */
export async function readRepliesAttention(client: SupabaseClient, scope: Scope) {
  const base = 'id,lead_id,name,email,company,provider,sent_at,replied_at,reply_intent,delivery_status,bounce_category,bounce_reason,evaluation_status';
  const [failures, unclassified, automatic] = await Promise.all([
    client.from('contacted_leads').select(base).eq('organization_id', scope.organizationId)
      .in('delivery_status', ['bounced', 'soft_bounced']).order('last_event_at', { ascending: false }).limit(20),
    client.from('contacted_leads').select(base).eq('organization_id', scope.organizationId)
      .not('replied_at', 'is', null).is('reply_intent', null).order('replied_at', { ascending: false }).limit(20),
    client.from('contacted_leads').select(base).eq('organization_id', scope.organizationId)
      .eq('reply_intent', 'auto_reply').order('replied_at', { ascending: false }).limit(10),
  ]);
  const failed = [failures, unclassified, automatic].find((result) => result.error)?.error;
  if (failed) throw new Error('No se pudieron consultar las respuestas pendientes.');
  const shape = (row: Record<string, unknown>, group: string) => ({ ...row, group, action: attentionAction(row as never) });
  const coverage = await readMailboxCoverage(client, scope);
  return {
    scope: 'organization_replies',
    failures: ((failures.data as unknown[]) || []).map((row) => shape(row as Record<string, unknown>, 'bounce_or_block')),
    unclassified: ((unclassified.data as unknown[]) || []).map((row) => shape(row as Record<string, unknown>, 'unclassified')),
    automatic: ((automatic.data as unknown[]) || []).map((row) => shape(row as Record<string, unknown>, 'auto_reply_info')),
    truncated: ((failures.data as unknown[]) || []).length >= 20 || ((unclassified.data as unknown[]) || []).length >= 20,
    coverage,
    limitation: 'Registros de la app con cobertura de buzón declarada aparte; un pendiente se confirma en el hilo, no en esta lista.',
  };
}

/** 6.4 Interested replies with no follow-up action after 48 hours. */
export async function readRepliesStalled(client: SupabaseClient, scope: Scope) {
  const { data, error } = await client.from('contacted_leads')
    .select('id,lead_id,name,email,company,replied_at,reply_intent,conversation_outbound_at,data')
    .eq('organization_id', scope.organizationId)
    .in('reply_intent', ['positive', 'meeting_request'])
    .not('replied_at', 'is', null)
    .order('replied_at', { ascending: true }).limit(100);
  if (error) throw new Error('No se pudieron consultar los interesados sin seguimiento.');
  const stalled = selectStalledInterested((data as AccountMemberRow[]) || []);
  const coverage = await readMailboxCoverage(client, scope);
  return {
    scope: 'organization_replies', items: stalled.slice(0, 20), returned: Math.min(stalled.length, 20),
    total: stalled.length, truncated: stalled.length > 20, coverage,
    rule: 'Interés humano sin envío posterior ni compromiso abierto tras 48 horas.',
  };
}

/** 6.5 From one contact to every thread and person at the same company. */
export async function readContactedAccount(client: SupabaseClient, scope: Scope, value: string) {
  const leadId = z.string().uuid().parse(value);
  const anchorRes = await client.from('contacted_leads')
    .select('id,lead_id,company').eq('organization_id', scope.organizationId).eq('lead_id', leadId).limit(1);
  if (anchorRes.error) throw new Error('No se pudo leer la cuenta.');
  const anchor = (anchorRes.data as Array<{ id: string; lead_id: string; company: string | null }>)?.[0] || null;
  if (!anchor?.company) {
    return { scope: 'organization_account', anchor, members: [], returned: 0, conflicts: [], coverage: await readMailboxCoverage(client, scope), limitation: 'El contacto no tiene empresa registrada; no hay cuenta que reconstruir.' };
  }
  const membersRes = await client.from('contacted_leads')
    .select('id,lead_id,name,email,company,user_id,status,sent_at,replied_at,reply_intent,delivery_status,evaluation_status,last_event_type,last_event_at')
    .eq('organization_id', scope.organizationId).order('sent_at', { ascending: false }).limit(500);
  if (membersRes.error) throw new Error('No se pudo leer la cuenta.');
  const members = selectAccountMembers((membersRes.data as AccountMemberRow[]) || [], anchor.company);
  const coverage = await readMailboxCoverage(client, scope);
  return {
    scope: 'organization_account', anchor: { contactedId: anchor.id, leadId: anchor.lead_id, company: anchor.company },
    members: members.slice(0, 50), returned: Math.min(members.length, 50), total: members.length,
    truncated: members.length > 50, conflicts: accountConflicts(members), coverage,
    limitation: 'Coincidencia exacta de empresa normalizada; la cobertura de buzón se declara aparte.',
  };
}

/** 6.6 Verifiable chain per thread: outbound -> inbound events -> commitment -> confirmation. */
export async function readMeetingChain(client: SupabaseClient, scope: Scope, value: string) {
  const leadId = z.string().uuid().parse(value);
  const contactedRes = await client.from('contacted_leads')
    .select('id,lead_id,name,email,company,provider,sent_at,message_id,thread_key,data')
    .eq('organization_id', scope.organizationId).eq('lead_id', leadId)
    .order('sent_at', { ascending: false }).limit(15);
  if (contactedRes.error) throw new Error('No se pudo leer la cadena de la reunión.');
  const contacts = (contactedRes.data as Array<{ id: string }>) || [];
  let events: Array<ChainEventRow & { contacted_id?: string }> = [];
  if (contacts.length) {
    const eventsRes = await client.from('email_events')
      .select('contacted_id,event_type,event_at,thread_key,message_id,inbound_event_key,meta')
      .eq('organization_id', scope.organizationId).in('contacted_id', contacts.map((row) => row.id))
      .order('event_at', { ascending: true }).limit(100);
    if (eventsRes.error) throw new Error('No se pudo leer la cadena de la reunión.');
    events = (eventsRes.data as Array<ChainEventRow & { contacted_id?: string }>) || [];
  }
  const chains = contacts.map((contact) => ({
    contactedId: contact.id,
    ...buildMeetingChain({ contact: contact as never, events: events.filter((event) => event.contacted_id === contact.id) }),
  }));
  const coverage = await readMailboxCoverage(client, scope);
  return { scope: 'organization_account', leadId, chains, coverage,
    limitation: 'Solo los eslabones con identificador y fecha son verificables; el resto se marca parcial o sin verificar.' };
}

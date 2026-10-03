import type { SupabaseClient } from '@supabase/supabase-js';

import { countUniqueReplyContacts } from '@/lib/antonia-reply-metrics';

export type HomeCampaignProgress = { id: string; name: string; total: number; sent: number };

export type HomeSummary = {
  contacted: number;
  replied: number;
  enrichedLeads: number;
  /** Legacy campaigns still active plus the approved campaigns of «Campañas». */
  activeCampaigns: number;
  campaigns: HomeCampaignProgress[];
};

const PAGE_SIZE = 1000;
const MAX_ROWS = 20000;
/** The reply intents hasReplySignal counts (src/lib/antonia-reply-metrics.ts). */
const REPLY_INTENTS = ['meeting_request', 'positive', 'negative', 'unsubscribe', 'auto_reply', 'neutral', 'delivery_failure'];
const SENT_STATUSES = new Set(['sent', 'completed', 'delivered']);

type Page<T> = { data: T[] | null; error: { message: string } | null };

/** Reads every page of a query (`build` returns a fresh, filtered query), up to MAX_ROWS. */
async function readAll<T>(build: () => { range: (from: number, to: number) => PromiseLike<Page<T>> }): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE_SIZE) {
    const { data, error } = await build().range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return rows;
}

function exactCount(result: { count: number | null; error: { message: string } | null }) {
  if (result.error) throw new Error(result.error.message);
  return result.count || 0;
}

/**
 * The numbers of «Hoy», counted where the data lives: exact counts instead of downloading whole tables (which stopped at
 * 1,000 rows), replies read only from the rows that carry a reply signal, and the approved campaigns of «Campañas»
 * counted with the legacy ones. `client` is the signed-in person's client, so RLS decides what each person sees.
 */
export async function loadHomeSummary(client: SupabaseClient, { organizationId, userId }: { organizationId: string; userId: string }): Promise<HomeSummary> {
  const [contacted, enriched, legacyActive, approved, replyContacts, replyResponses] = await Promise.all([
    client.from('contacted_leads').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId),
    client.from('enriched_leads').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId),
    client.from('campaigns').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId).eq('status', 'active'),
    client.from('bulk_campaigns').select('id, definition, recipients, approved_at')
      .eq('organization_id', organizationId).eq('user_id', userId).eq('status', 'approved')
      .order('approved_at', { ascending: false }).limit(20),
    readAll<{ id: string; lead_id: string | null; email: string | null; replied_at: string | null; reply_intent: string | null; last_reply_text: string | null }>(() =>
      client.from('contacted_leads').select('id, lead_id, email, replied_at, reply_intent, last_reply_text')
        .eq('organization_id', organizationId)
        .or(`replied_at.not.is.null,last_reply_text.not.is.null,reply_intent.in.(${REPLY_INTENTS.join(',')})`)
        .order('id', { ascending: true }) as never),
    readAll<{ contacted_id: string | null; lead_id: string | null; type: string | null }>(() =>
      client.from('lead_responses').select('contacted_id, lead_id, type')
        .eq('organization_id', organizationId).eq('type', 'reply')
        .order('contacted_id', { ascending: true }) as never),
  ]);

  if (approved.error) throw new Error(approved.error.message);
  const approvedRows = (approved.data || []) as Array<{ id: string; definition?: { name?: unknown } | null; recipients?: unknown }>;
  const campaigns = await campaignProgress(client, organizationId, userId, approvedRows.slice(0, 3));

  return {
    contacted: exactCount(contacted),
    replied: countUniqueReplyContacts(replyContacts, replyResponses),
    enrichedLeads: exactCount(enriched),
    activeCampaigns: exactCount(legacyActive) + approvedRows.length,
    campaigns,
  };
}

/** How far each approved campaign got: its scheduled messages and the ones already sent (outbound_dispatches). */
async function campaignProgress(
  client: SupabaseClient,
  organizationId: string,
  userId: string,
  rows: Array<{ id: string; definition?: { name?: unknown } | null; recipients?: unknown }>,
): Promise<HomeCampaignProgress[]> {
  const drafts = new Map<string, string[]>();
  for (const row of rows) {
    const recipients = Array.isArray(row.recipients) ? row.recipients as Array<{ messages?: Array<{ draftId?: unknown }> }> : [];
    drafts.set(row.id, recipients.flatMap((recipient) => (recipient.messages || []).map((message) => String(message.draftId || '')).filter(Boolean)));
  }
  const allDrafts = [...drafts.values()].flat();
  let sentDrafts = new Set<string>();
  if (allDrafts.length) {
    const { data, error } = await client.from('outbound_dispatches').select('draft_id, status')
      .eq('organization_id', organizationId).eq('user_id', userId).in('draft_id', allDrafts).limit(PAGE_SIZE);
    if (error) throw new Error(error.message);
    sentDrafts = new Set(((data || []) as Array<{ draft_id: string; status: string }>)
      .filter((row) => SENT_STATUSES.has(String(row.status || '').toLowerCase())).map((row) => row.draft_id));
  }
  return rows.map((row) => {
    const ids = drafts.get(row.id) || [];
    const name = typeof row.definition?.name === 'string' && row.definition.name.trim() ? row.definition.name.trim() : 'Campaña sin título';
    return { id: row.id, name, total: ids.length, sent: ids.filter((id) => sentDrafts.has(id)).length };
  });
}

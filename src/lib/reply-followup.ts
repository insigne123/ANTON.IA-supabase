/** Pure stage-6 builders: stalled-interest selection, account grouping and the
 * verifiable message-to-meeting chain. No I/O; readers supply rows. */

export const HUMAN_REPLY_INTENTS = ['positive', 'meeting_request'] as const;
export const NON_HUMAN_REPLY_INTENTS = ['auto_reply', 'delivery_failure'] as const;
/** A human reply with no follow-up action for this long needs attention. */
export const STALLED_AFTER_MS = 48 * 60 * 60 * 1000;

export type ContactedFollowupRow = {
  id: string;
  lead_id?: string | null;
  name?: string | null;
  email?: string | null;
  company?: string | null;
  sent_at?: string | null;
  replied_at?: string | null;
  reply_intent?: string | null;
  conversation_outbound_at?: string | null;
  data?: { commitment?: { id?: string; kind?: string; title?: string; dueAt?: string; completedAt?: string | null } | null } | null;
};

export type StalledItem = {
  contactedId: string; leadId: string | null; name: string | null; email: string | null;
  replyIntent: string; repliedAt: string; daysWaiting: number;
};

function hasOpenCommitment(row: ContactedFollowupRow) {
  const commitment = row.data?.commitment;
  return Boolean(commitment?.id && !commitment.completedAt);
}

/** Interested replies with no outbound after the reply and no open commitment. */
export function selectStalledInterested(rows: ContactedFollowupRow[], nowMs = Date.now()): StalledItem[] {
  const items: StalledItem[] = [];
  for (const row of rows) {
    const repliedAtMs = row.replied_at ? Date.parse(row.replied_at) : NaN;
    if (!row.replied_at || Number.isNaN(repliedAtMs)) continue;
    if (!(HUMAN_REPLY_INTENTS as readonly string[]).includes(String(row.reply_intent || ''))) continue;
    if (nowMs - repliedAtMs < STALLED_AFTER_MS) continue;
    const outboundAtMs = row.conversation_outbound_at ? Date.parse(row.conversation_outbound_at) : NaN;
    if (Number.isFinite(outboundAtMs) && outboundAtMs > repliedAtMs) continue;
    if (hasOpenCommitment(row)) continue;
    items.push({
      contactedId: row.id, leadId: row.lead_id || null, name: row.name || null, email: row.email || null,
      replyIntent: String(row.reply_intent), repliedAt: row.replied_at,
      daysWaiting: Math.floor((nowMs - repliedAtMs) / (24 * 60 * 60 * 1000)),
    });
  }
  return items.sort((a, b) => Date.parse(a.repliedAt) - Date.parse(b.repliedAt));
}

/** Company key shared with list review: exact normalized match only, never fuzzy. */
export function normalizeAccountCompany(value?: string | null) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export type AccountMemberRow = ContactedFollowupRow & {
  user_id?: string | null; status?: string | null; last_event_type?: string | null;
  last_event_at?: string | null; evaluation_status?: string | null;
};

export function selectAccountMembers(rows: AccountMemberRow[], company: string): AccountMemberRow[] {
  const key = normalizeAccountCompany(company);
  if (!key) return [];
  return rows.filter((row) => normalizeAccountCompany(row.company) === key);
}

export function accountConflicts(members: AccountMemberRow[]): string[] {
  const conflicts: string[] = [];
  const owners = [...new Set(members.map((member) => member.user_id).filter(Boolean))];
  if (owners.length > 1) conflicts.push('multiple_owners');
  if (members.some((member) => member.evaluation_status === 'do_not_contact')) conflicts.push('do_not_contact_present');
  if (members.some((member) => member.replied_at) && members.some((member) => !member.replied_at)) conflicts.push('mixed_replied_pending');
  return conflicts;
}

export type ChainEventRow = {
  event_type?: string | null; event_at?: string | null; thread_key?: string | null;
  message_id?: string | null; inbound_event_key?: string | null;
  meta?: { subject?: string | null; preview?: string | null } | null;
};

export type ChainLink = { kind: string; at: string | null; source: string; id: string | null; note: string | null };

/** Verifiable chain: outbound -> inbound events -> commitment -> completion.
 * Every link carries its id and timestamp; missing links are explicit. */
export function buildMeetingChain(input: {
  contact: ContactedFollowupRow & { message_id?: string | null; thread_key?: string | null; provider?: string | null };
  events: ChainEventRow[];
}): { links: ChainLink[]; verdict: 'complete' | 'partial' | 'unverified' } {
  const links: ChainLink[] = [];
  if (input.contact.sent_at) {
    links.push({ kind: 'outbound', at: input.contact.sent_at, source: `contacted_leads:${input.contact.provider || 'unknown'}`, id: input.contact.message_id || input.contact.id, note: input.contact.thread_key || null });
  }
  const ordered = [...input.events]
    .filter((event) => event.event_at && Number.isFinite(Date.parse(event.event_at)))
    .sort((a, b) => Date.parse(a.event_at!) - Date.parse(b.event_at!));
  for (const event of ordered) {
    links.push({ kind: event.event_type === 'bounce' ? 'bounce' : 'inbound', at: event.event_at!, source: 'email_events', id: event.inbound_event_key || event.message_id || null, note: event.meta?.preview || event.meta?.subject || null });
  }
  const commitment = input.contact.data?.commitment;
  if (commitment?.id) {
    const origin = (commitment as { origin?: { replyEventKey?: string; threadKey?: string; derivedAt?: string } | null }).origin;
    const eventKeys = new Set(ordered.map((event) => event.inbound_event_key).filter(Boolean));
    const originVerified = Boolean(origin?.replyEventKey && eventKeys.has(origin.replyEventKey));
    links.push({ kind: 'commitment', at: (commitment as { dueAt?: string }).dueAt || null, source: originVerified ? 'contacted_leads:verified_origin' : 'contacted_leads:unverified_origin', id: commitment.id, note: (commitment as { title?: string }).title || (commitment as { kind?: string }).kind || null });
    if ((commitment as { completedAt?: string | null }).completedAt) {
      links.push({ kind: 'meeting_confirmed', at: (commitment as { completedAt?: string | null }).completedAt ?? null, source: originVerified ? 'contacted_leads:verified_origin' : 'contacted_leads:unverified_origin', id: commitment.id, note: null });
    }
  }
  const hasOutbound = links.some((link) => link.kind === 'outbound');
  const hasInbound = links.some((link) => link.kind === 'inbound');
  const confirmed = links.some((link) => link.kind === 'meeting_confirmed' && link.source === 'contacted_leads:verified_origin');
  const verdict = confirmed && hasOutbound && hasInbound ? 'complete' : hasOutbound || hasInbound ? 'partial' : 'unverified';
  return { links, verdict };
}

import { conversationTurn, type ObservedMessage } from './commercial-facts';

type ContactRecord = { id: string; sent_at?: string | null; replied_at?: string | null;
  reply_intent?: string | null; delivery_status?: string | null; bounced_at?: string | null };

/** This projection knows the application records, not mailbox synchronization.
 * Never promote a fresh DB query to evidence of a complete, current mailbox. */
export function contactRecordEvidence(rows: ContactRecord[], truncated: boolean, now: string) {
  const messages: ObservedMessage[] = [];
  for (const row of rows) {
    if (row.sent_at) messages.push({ id: `${row.id}:out`, direction: 'outbound', at: row.sent_at,
      kind: 'human', confirmed: !row.bounced_at && !['failed', 'bounced', 'pending', 'unknown'].includes(row.delivery_status || '') });
    if (row.replied_at) messages.push({ id: `${row.id}:in`, direction: 'inbound', at: row.replied_at,
      kind: row.reply_intent === 'auto_reply' ? 'auto_reply' : row.reply_intent === 'delivery_failure' ? 'bounce' : 'human',
      confirmed: Boolean(row.reply_intent) });
  }
  const unknownReply = rows.some(row => row.replied_at && !row.reply_intent);
  const observedTurn = unknownReply ? { status: 'unknown' as const, reason: 'unclassified_reply' }
    : conversationTurn(messages, { coverageComplete: !truncated, observedAt: now, now, maxAgeMs: 0 });
  return {
    source: 'application_contact_records' as const,
    queriedAt: now,
    mailboxSyncedAt: null,
    mailboxCoverageComplete: false,
    recordsTruncated: truncated,
    observedTurn,
    turn: { status: 'unknown' as const, reason: 'mailbox_coverage_unverified' },
    pendingStatus: 'needs_verification' as const,
    limitation: 'Estos registros no incluyen necesariamente respuestas enviadas fuera de la app. No confirman un pendiente actual ni una reunión agendada.',
  };
}

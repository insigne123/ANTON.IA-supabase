import { collectCoworkLeadRows } from '@/lib/cowork/lead-export';

/** The saved contacts a thread has already looked at: what leads.search and leads.get returned, and the people of a list review.
 * A batch only takes people from here, so nobody enters one that nobody saw. */
export function observedCoworkLeadIds(events: Array<{ kind: string; payload: unknown }>): Set<string> {
  const ids = new Set<string>();
  for (const event of events) {
    if (event.kind !== 'tool.completed' || !event.payload || typeof event.payload !== 'object') continue;
    const payload = event.payload as Record<string, unknown>;
    if (payload.action === 'lists.review_batch' || payload.action === 'lists.review_contact') {
      const result = payload.result as { items?: Array<{ leadId?: string }> } | null;
      for (const item of result?.items || []) if (typeof item.leadId === 'string') ids.add(item.leadId);
    }
    for (const row of collectCoworkLeadRows([payload])) ids.add(row.id);
  }
  return ids;
}

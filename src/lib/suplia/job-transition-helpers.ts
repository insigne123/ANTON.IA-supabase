export const SUPLIA_ACTIONABLE_REPLY_INTENTS = [
  'interested',
  'meeting_request',
  'objection',
  'referral',
  'technical_question',
  'needs_human',
] as const;

export function buildSupliaThreadResponseStepKey(contactedId: unknown) {
  const clean = String(contactedId || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48);
  return `thread_response_${clean || 'unknown'}`;
}

export function findSupliaActionableReplyCandidate(classified: unknown) {
  const source = classified && typeof classified === 'object' ? classified as { results?: unknown } : {};
  const results = Array.isArray(source.results) ? source.results : [];

  return results.find((item: any) => {
    const intent = String(item?.classification?.intent || '').trim();
    if (!item?.contactedId) return false;
    return (SUPLIA_ACTIONABLE_REPLY_INTENTS as readonly string[]).includes(intent);
  }) || null;
}

/** Deterministic commercial facts. Never infers delivery, permissions or account
 * identity from prose. Callers must supply normalized, scoped observations. */
export type CommercialRule = { id: string; kind: 'commercial' | 'suppression';
  channels?: string[]; goals?: string[] };

export function applicableCommercialRules(rules: CommercialRule[], channel: string, goal: string) {
  return rules.filter(rule => rule.kind === 'suppression'
    || ((!rule.channels || rule.channels.includes(channel)) && (!rule.goals || rule.goals.includes(goal))));
}

export function commercialRate(numerator: number, denominator: number, unit: 'emails' | 'people') {
  if (![numerator, denominator].every(value => Number.isSafeInteger(value) && value >= 0) || numerator > denominator) {
    throw new Error('Invalid metric population');
  }
  return { numerator, denominator, denominatorUnit: unit, percent: denominator ? numerator / denominator * 100 : null };
}

export function normalizeCompanyName(value: string) {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

export function exactCompanyMatch(left: string, right: string) {
  const normalized = normalizeCompanyName(left);
  return normalized.length > 0 && normalized === normalizeCompanyName(right);
}

export function titleContainsTerm(title: string, term: string) {
  const normalize = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const needle = normalize(term.trim());
  if (!needle) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?:$|[^\\p{L}\\p{N}])`, 'u').test(normalize(title));
}

export type ObservedMessage = { id: string; direction: 'inbound' | 'outbound'; at: string;
  kind: 'human' | 'auto_reply' | 'bounce'; confirmed: boolean };
export function conversationTurn(messages: ObservedMessage[], options: {
  coverageComplete: boolean; observedAt: string; now: string; maxAgeMs: number;
}) {
  const now = Date.parse(options.now), observed = Date.parse(options.observedAt);
  if (!Number.isFinite(now) || !Number.isFinite(observed) || !Number.isFinite(options.maxAgeMs) || options.maxAgeMs < 0) {
    throw new Error('Invalid observation clock');
  }
  if (!options.coverageComplete) return { status: 'unknown' as const, reason: 'partial_history' };
  if (observed > now || now - observed > options.maxAgeMs) return { status: 'unknown' as const, reason: 'stale_observation' };
  if (messages.some(message => !Number.isFinite(Date.parse(message.at)) || Date.parse(message.at) > now)) {
    return { status: 'unknown' as const, reason: 'invalid_message_clock' };
  }
  if (messages.some(message => message.direction === 'outbound' && !message.confirmed)) {
    return { status: 'unknown' as const, reason: 'uncertain_outbound' };
  }
  const human = messages.filter(message => message.kind === 'human' && message.confirmed)
    .sort((a,b) => Date.parse(a.at) - Date.parse(b.at));
  const last = human.at(-1);
  if (!last) return { status: 'unknown' as const, reason: 'no_human_messages' };
  if (human.some(message => message.direction !== last.direction && Date.parse(message.at) === Date.parse(last.at))) {
    return { status: 'unknown' as const, reason: 'ambiguous_message_order' };
  }
  return { status: last.direction === 'inbound' ? 'our_turn' as const : 'their_turn' as const,
    lastMessageId: last.id, lastMessageAt: last.at, elapsedHours: (now-Date.parse(last.at))/3600000 };
}

export function observedActionCounts(actions: Array<{ id: string; status: 'confirmed' | 'failed' | 'held' | 'uncertain' }>) {
  if (new Set(actions.map(action => action.id)).size !== actions.length) throw new Error('Duplicate action identity');
  return actions.reduce((counts, action) => { counts[action.status]++; return counts; },
    { confirmed: 0, failed: 0, held: 0, uncertain: 0 });
}

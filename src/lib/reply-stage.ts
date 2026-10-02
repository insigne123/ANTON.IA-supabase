import type { PipelineStage } from '@/lib/crm-types';
import type { ReplyClassification } from '@/lib/reply-classifier';

/** Where Jev reads that an interested reply leaves the deal (Plan 6, PR-B). */
export type ReplyDeal = 'negotiation' | 'won';

/**
 * The pipeline stage a prospect's reply proposes (Plan 6, PR-B). It is a suggestion the person confirms (Plan 5, PR-10a), never a
 * move: a meeting request proposes «Reunión», interest «Interesado», a refusal or an opt-out «Perdido»; and when Jev reads that an
 * interested reply asks for a proposal, a price or a contract, «Negociación», or that it confirms the purchase, «Ganado». Automatic
 * and neutral replies propose nothing, and a bounce is the tracking webhook's. `event` names the reason the pipeline shows.
 */
export function replyStageSuggestion(intent: ReplyClassification['intent'], deal?: ReplyDeal | null): { stage: PipelineStage; event: string } | null {
  const interested = intent === 'positive' || intent === 'meeting_request';
  if (interested && deal === 'won') return { stage: 'closed_won', event: 'reply_won' };
  if (interested && deal === 'negotiation') return { stage: 'negotiation', event: 'reply_negotiation' };
  if (intent === 'meeting_request') return { stage: 'meeting', event: 'meeting_request' };
  if (intent === 'positive') return { stage: 'engaged', event: 'positive' };
  if (intent === 'negative') return { stage: 'closed_lost', event: 'not_interested' };
  if (intent === 'unsubscribe') return { stage: 'closed_lost', event: 'unsubscribe' };
  return null;
}

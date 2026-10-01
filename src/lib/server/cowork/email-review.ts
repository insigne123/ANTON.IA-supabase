import type { SupabaseClient } from '@supabase/supabase-js';
import { askJev } from '@/lib/server/jev';
import type { CoworkUserContext } from '@/lib/cowork/decision-context';
import {
  coworkEmailReviewIssues, coworkEmailReviewProbabilities, coworkEmailReviewQuestions, coworkEmailReviewState, type CoworkEmailReviewInput,
} from '@/lib/cowork/email-review';
import { loadCoworkUserContext } from './user-context';

/**
 * Jev reads an email before the person approves it (docs/cowork-jev-correos.md). COWORK_EMAIL_REVIEW decides what happens with what it finds:
 * off (the default: Jev is not asked), shadow (Jev is asked and only the probabilities are logged, to measure it with real emails before
 * it shows anything) or on (what it finds is shown on the approval card). It never blocks an approval and it fails open: without the key,
 * on a timeout or on an answer it cannot read, the card simply has no review. The text of the email never reaches a log.
 */
export type CoworkEmailReviewMode = 'off' | 'shadow' | 'on';

export function coworkEmailReviewMode(env: Record<string, string | undefined> = process.env): CoworkEmailReviewMode {
  const value = env.COWORK_EMAIL_REVIEW?.trim().toLowerCase();
  return value === 'on' || value === 'shadow' ? value : 'off';
}

/** Well under what a person waits for a card, and about twice Jev's p95 (194 ms). */
export const COWORK_EMAIL_REVIEW_TIMEOUT_MS = 1_500;

export type CoworkEmailReview = { checked: boolean; issues: Array<{ id: string; text: string }> };

export function coworkEmailReviewSeller(context: CoworkUserContext | null): CoworkEmailReviewInput['seller'] {
  return { name: context?.fullName ?? null, company: context?.companyName ?? null, offer: context?.offer ?? null,
    ...(context?.services?.length ? { services: context.services } : {}), ...(context?.proofPoints?.length ? { proofPoints: context.proofPoints } : {}) };
}

export async function reviewCoworkEmail(input: CoworkEmailReviewInput, options: {
  mode?: CoworkEmailReviewMode; ask?: typeof askJev; log?: (line: string) => void;
} = {}): Promise<CoworkEmailReview | null> {
  const mode = options.mode ?? coworkEmailReviewMode();
  if (mode === 'off' || !input.draft.body.trim()) return null;
  const hasConversation = Boolean(input.conversation?.theirLastMessage.trim());
  const result = await (options.ask ?? askJev)({
    state: coworkEmailReviewState(input), questions: coworkEmailReviewQuestions(hasConversation), timeoutMs: COWORK_EMAIL_REVIEW_TIMEOUT_MS,
  });
  const probabilities = coworkEmailReviewProbabilities(result.answers);
  (options.log ?? console.info)(`[cowork.email_review] ${JSON.stringify({ mode, status: result.status, durationMs: result.durationMs, costUsd: result.costUsd, conversation: hasConversation, probabilities })}`);
  if (mode === 'shadow') return null;
  return result.status === 'ok' && result.answers ? { checked: true, issues: coworkEmailReviewIssues(result.answers) } : { checked: false, issues: [] };
}

/** The seller's side of the state, read once for this person (own profile and the organization's offer). */
export async function loadCoworkEmailReviewSeller(client: SupabaseClient, scope: { userId: string; organizationId: string }) {
  return coworkEmailReviewSeller(await loadCoworkUserContext(client, scope, { memories: false }));
}

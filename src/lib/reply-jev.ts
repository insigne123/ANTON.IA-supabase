import type { JevAnswer, JevQuestion } from '@/lib/server/jev';
import type { ReplyClassification } from '@/lib/reply-classifier';
import type { ReplyDeal } from '@/lib/reply-stage';

/**
 * Jev (TypeSafe) as a second reader of what a prospect's reply means (docs/cowork-jev.md). Pure: the question Jev is asked, what
 * its answer becomes in the app and how sure it has to be for the app to take its word. The engine is chosen by
 * REPLY_CLASSIFIER_ENGINE, and without the variable nothing changes: the model reads every reply, as before.
 *
 *   llm        the model classifies (default).
 *   shadow     the model classifies and Jev answers next to it; only whether they agree is logged. Nothing it says is used.
 *   jev-first  Jev classifies when it is sure; otherwise (or without a key, on a timeout or an error) the model does.
 */

export const REPLY_ENGINES = ['llm', 'shadow', 'jev-first'] as const;
export type ReplyEngine = typeof REPLY_ENGINES[number];

export function replyEngine(env: Record<string, string | undefined> = process.env): ReplyEngine {
  const value = String(env.REPLY_CLASSIFIER_ENGINE || '').trim().toLowerCase();
  return (REPLY_ENGINES as readonly string[]).includes(value) ? value as ReplyEngine : 'llm';
}

/** One question with the seven things a reply can mean. The instructions are in English (Jev reads it best); the reply stays as written. */
export const REPLY_JEV_QUESTION: JevQuestion = {
  type: 'choice',
  instructions: 'What does this reply from a sales prospect (to a cold B2B email) mean for the sender?',
  criteria: {
    meeting_request: 'Asks for or accepts a meeting, a call or a demo, or asks for availability to meet.',
    positive: 'Shows interest without setting a meeting: asks for price or a quote, refers the sender to a colleague, or will share it with their team.',
    negative: 'Not interested: declines, already has a provider or its own tools, or rejects on price.',
    unsubscribe: 'Asks not to be contacted again or to be removed from the list.',
    auto_reply: 'An automatic reply: out of office, vacation, medical leave or an unmonitored mailbox.',
    neutral: 'A question about the product, or asks to be contacted later, without showing interest or declining.',
    delivery_failure: 'A bounce: the message could not be delivered to the address.',
  },
};

/** How sure Jev has to be for the app to take its word (jev-first). In the calibration (43 replies written for the test) it was
 * right 97 % of the time from 0.9 up, and its mistakes sat between 0.54 and 0.64 apart from one ambiguous sample. Below it, the
 * model reads the reply. */
export const JEV_REPLY_MIN_CONFIDENCE = 0.9;

type JevReplyIntent = 'meeting_request' | 'positive' | 'negative' | 'unsubscribe' | 'auto_reply' | 'neutral' | 'delivery_failure';

/** What each answer means for the campaign, with the same rules the model is given (classify-reply.ts): interest or a request stops
 * the automatic follow-ups for a person to take over, a refusal stops them, and an automatic or neutral reply lets them go on.
 * Jev writes no text, so the summary is one fixed sentence per intent. */
const MEANING: Record<Exclude<JevReplyIntent, 'delivery_failure'>, Pick<ReplyClassification, 'sentiment' | 'shouldContinue' | 'summary'>> = {
  meeting_request: { sentiment: 'positive', shouldContinue: false, summary: 'Pidió o aceptó una reunión' },
  positive: { sentiment: 'positive', shouldContinue: false, summary: 'Mostró interés' },
  negative: { sentiment: 'negative', shouldContinue: false, summary: 'No está interesado' },
  unsubscribe: { sentiment: 'negative', shouldContinue: false, summary: 'Pidió no recibir más correos' },
  auto_reply: { sentiment: 'neutral', shouldContinue: true, summary: 'Respuesta automática' },
  neutral: { sentiment: 'neutral', shouldContinue: true, summary: 'Respuesta sin interés ni rechazo claro' },
};

/** A bounce is never decided by reading a reply: detectDeliveryFailure finds them from the mail system's own message, and taking
 * a real reply for a bounce would hide it (a bounce clears the reply). Jev keeps the option so a bounce text has somewhere to go,
 * and the shadow mode logs it, but the app does not act on it. */
const NEVER_DECIDES = new Set<JevReplyIntent>(['delivery_failure']);

/** What Jev picked and how sure it was, for any answer it gave: what the shadow mode compares. */
export function jevReplyRead(answer: JevAnswer | undefined): { intent: JevReplyIntent | null; confidence: number | null } {
  const known = Object.prototype.hasOwnProperty.call(MEANING, answer?.type === 'choice' ? answer.choice : '') || (answer?.type === 'choice' && NEVER_DECIDES.has(answer.choice as JevReplyIntent));
  if (answer?.type !== 'choice' || !known) return { intent: null, confidence: null };
  return { intent: answer.choice as JevReplyIntent, confidence: answer.confidence };
}

/** The classification Jev's answer stands for, or null when the app is not to take its word: no answer, an option that does not
 * exist, or less certainty than `minConfidence`. */
export function jevReplyClassification(answer: JevAnswer | undefined, minConfidence = JEV_REPLY_MIN_CONFIDENCE): ReplyClassification | null {
  const { intent, confidence } = jevReplyRead(answer);
  if (!intent || NEVER_DECIDES.has(intent) || confidence === null || confidence < minConfidence) return null;
  return { intent, confidence, reason: 'jev', ...MEANING[intent as keyof typeof MEANING] };
}

/**
 * Plan 6, PR-B: where an interested reply leaves the deal, for the pipeline. It only proposes a stage the person confirms, so a
 * mistake costs one click; still, the app takes Jev's word only from JEV_DEAL_MIN_CONFIDENCE up (scripts/calibrate-reply-deal-jev.ts).
 */
export const REPLY_JEV_DEAL_QUESTION: JevQuestion = {
  type: 'choice',
  instructions: 'An interested sales prospect replied to a cold B2B email. Where does this reply leave the deal?',
  criteria: {
    negotiation: 'Asks for a formal proposal, a quote, detailed pricing, a contract or commercial terms in order to move forward.',
    won: 'Confirms the purchase: accepts the proposal or the price, says to go ahead or to start, asks to sign, for the invoice or how to pay.',
    none: 'Neither: shows interest, asks for a meeting, a call or a demo, asks a general question about the product, or anything else.',
  },
};

export const JEV_DEAL_MIN_CONFIDENCE = 0.8;

/** The deal stage Jev's answer stands for, or null: no answer, «none», an unknown option or less certainty than the floor. */
export function jevReplyDeal(answer: JevAnswer | undefined, minConfidence = JEV_DEAL_MIN_CONFIDENCE): ReplyDeal | null {
  if (answer?.type !== 'choice' || (answer.choice !== 'negotiation' && answer.choice !== 'won')) return null;
  return answer.confidence >= minConfidence ? answer.choice : null;
}

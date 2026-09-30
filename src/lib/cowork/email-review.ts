import type { JevAnswer, JevQuestion } from '@/lib/server/jev';

/**
 * Jev as a last reader of an email before the person approves it (plan 30 sep, «Jev revisa correos antes de enviar»; operations C4, C5 and
 * D5 of the AXIS bank). It reads the exact text that would go out next to what the other person wrote and what the seller offers, and
 * answers three yes/no questions in about 0.2 s. It never blocks anything: what it finds is shown on the approval card as things to
 * look at, and the person decides. The questions are in English (Jev's best language); the state stays in Spanish.
 */

export const COWORK_EMAIL_REVIEW_QUESTIONS = {
  contradicts_thread: { type: 'noul', instructions: 'The draft reply contradicts what the other person wrote in the conversation: it proposes a day or time they did not offer, answers the opposite of what they asked, treats interest as a rejection or a rejection as interest, or keeps writing after they asked not to be written to.' },
  invents_commitment: { type: 'noul', instructions: 'The draft states a price, an amount, a discount, a delivery time, a feature, a client or a guarantee that is not present in what the seller offers (the offer and proof points) or in the conversation.' },
  ignores_question: { type: 'noul', instructions: 'The other person asked a direct question in their message and the draft does not answer it or say how and when it will be answered.' },
} satisfies Record<string, JevQuestion>;

export type CoworkEmailReviewId = keyof typeof COWORK_EMAIL_REVIEW_QUESTIONS;
export const COWORK_EMAIL_REVIEW_IDS = Object.keys(COWORK_EMAIL_REVIEW_QUESTIONS) as CoworkEmailReviewId[];

/** What each question means for the person, in the words the card shows. */
export const COWORK_EMAIL_REVIEW_PROBLEMS: Record<CoworkEmailReviewId, string> = {
  contradicts_thread: 'Parece contradecir lo que escribió la persona: un día u horario que no ofreció, lo contrario de lo que pidió, o seguir escribiendo tras una baja.',
  invents_commitment: 'Afirma algo que no está en tu oferta ni en la conversación: un precio, un plazo, un descuento, una función o un cliente.',
  ignores_question: 'No responde lo que la persona preguntó.',
};

/** Without a conversation there is nothing to contradict or to answer: a first email is only checked against the offer. */
export const COWORK_EMAIL_REVIEW_FIRST_CONTACT: readonly CoworkEmailReviewId[] = ['invents_commitment'];

/**
 * Probability at or above which a question counts as found. Calibrated on the made-up set of scripts/fixtures/cowork-email-review-set.ts
 * (docs/cowork-jev-correos.md, 35 replies): «contradicts_thread» and «invents_commitment» separate the defective replies from the fine
 * ones perfectly (AUC 1.0) and at 0.8 flag none of the fine ones (they keep 90 % and 100 % of the defective ones). «ignores_question»
 * (AUC 0.95) flags three fine replies at 0.8 and only a threshold of 0.98 clears them, which catches none: it has no threshold, so it
 * is asked to keep measuring it and never shown.
 */
export const COWORK_EMAIL_REVIEW_THRESHOLDS: Partial<Record<CoworkEmailReviewId, number>> = { contradicts_thread: 0.8, invents_commitment: 0.8 };

export type CoworkEmailReviewInput = {
  seller: { name: string | null; company: string | null; offer: string | null; services?: string[]; proofPoints?: string[] };
  /** What the other person wrote last, when the email answers someone; absent for a first email. */
  conversation?: { with: string | null; theirLastMessage: string; ourEarlierSubject?: string | null } | null;
  draft: { subject: string | null; body: string };
};

/** The state Jev reads: English keys so it reads the structure, Spanish text. */
export function coworkEmailReviewState(input: CoworkEmailReviewInput) {
  return {
    seller: input.seller,
    ...(input.conversation ? { conversation: input.conversation } : {}),
    draftReply: { subject: input.draft.subject, body: input.draft.body.slice(0, 4_000) },
  };
}

export function coworkEmailReviewQuestions(hasConversation: boolean) {
  const ids = hasConversation ? COWORK_EMAIL_REVIEW_IDS : COWORK_EMAIL_REVIEW_FIRST_CONTACT;
  return Object.fromEntries(ids.map(id => [id, COWORK_EMAIL_REVIEW_QUESTIONS[id]])) as Record<string, JevQuestion>;
}

export function coworkEmailReviewProbabilities(answers: Record<string, JevAnswer> | null) {
  return Object.fromEntries(COWORK_EMAIL_REVIEW_IDS.map(id => {
    const answer = answers?.[id];
    return [id, answer?.type === 'noul' ? answer.noul : null];
  })) as Record<CoworkEmailReviewId, number | null>;
}

/** What Jev found, as the lines the card shows; empty when it found nothing (or did not answer: the card never claims a review then). */
export function coworkEmailReviewIssues(answers: Record<string, JevAnswer> | null, thresholds: Partial<Record<CoworkEmailReviewId, number>> = COWORK_EMAIL_REVIEW_THRESHOLDS) {
  const probabilities = coworkEmailReviewProbabilities(answers);
  return COWORK_EMAIL_REVIEW_IDS.flatMap(id => {
    const value = probabilities[id];
    const threshold = thresholds[id];
    return value !== null && threshold !== undefined && value >= threshold ? [{ id, text: COWORK_EMAIL_REVIEW_PROBLEMS[id] }] : [];
  });
}

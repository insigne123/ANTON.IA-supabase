import { classifyReplyFlow } from '@/ai/flows/classify-reply';
import { isHardNegativeReply } from '@/lib/reply-intent-rules';
import { isExplicitOptOut, newReplyText } from '@/lib/reply-text';
import { askJev, type JevResult } from '@/lib/server/jev';
import { jevReplyClassification, jevReplyRead, replyEngine, REPLY_JEV_QUESTION, type ReplyEngine } from '@/lib/reply-jev';

export type ReplyClassification = {
  intent: 'meeting_request' | 'positive' | 'negative' | 'unsubscribe' | 'auto_reply' | 'neutral' | 'unknown' | 'delivery_failure';
  sentiment: 'positive' | 'negative' | 'neutral';
  shouldContinue: boolean;
  confidence: number;
  summary?: string;
  reason?: string;
};

function stripHtml(input: string) {
  return input
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function heuristicClassify(text: string): ReplyClassification {
  const t = text.toLowerCase();

  const isUnsub = isExplicitOptOut(text);
  if (isUnsub) {
    return { intent: 'unsubscribe', sentiment: 'negative', shouldContinue: false, confidence: 0.8, summary: 'Requested to unsubscribe', reason: 'unsubscribe' };
  }

  const isMeeting = /reunion|meet|meeting|call|llamada|agenda|agendar|calendly|zoom|teams|disponibilidad|schedule/i.test(t);
  if (isMeeting) {
    return { intent: 'meeting_request', sentiment: 'positive', shouldContinue: false, confidence: 0.75, summary: 'Asked to schedule a meeting', reason: 'meeting_request' };
  }

  const isNegative = isHardNegativeReply(t);
  if (isNegative) {
    return { intent: 'negative', sentiment: 'negative', shouldContinue: false, confidence: 0.7, summary: 'Not interested', reason: 'negative' };
  }

  const isAuto = /auto[-\s]?reply|respuesta automatica|out of office|fuera de oficina|vacaciones/i.test(t);
  if (isAuto) {
    return { intent: 'auto_reply', sentiment: 'neutral', shouldContinue: true, confidence: 0.7, summary: 'Auto reply / out of office', reason: 'auto_reply' };
  }

  const isPositive = /interesado|interesante|me interesa|hablemos|conversemos|info|informacion|mas detalles|cuentame|sounds good|let's talk/i.test(t);
  if (isPositive) {
    return { intent: 'positive', sentiment: 'positive', shouldContinue: false, confidence: 0.6, summary: 'Interested reply', reason: 'positive' };
  }

  return { intent: 'neutral', sentiment: 'neutral', shouldContinue: true, confidence: 0.4, summary: 'Neutral reply', reason: 'neutral' };
}

/** Guard-rail: si la respuesta trae rechazo explícito, nunca continuar (vale para quien la lea, el modelo o Jev). */
function withHardNegativeGuard(cleaned: string, result: ReplyClassification): ReplyClassification {
  if (isHardNegativeReply(cleaned) && result.intent !== 'unsubscribe' && result.intent !== 'negative') {
    return {
      intent: 'negative',
      sentiment: 'negative',
      shouldContinue: false,
      confidence: Math.max(0.85, Number(result.confidence || 0)),
      summary: 'Not interested',
      reason: 'hard_negative_override',
    };
  }
  return result;
}

export type ClassifyReplyOptions = {
  /** Who reads the reply (docs/cowork-jev.md); REPLY_CLASSIFIER_ENGINE by default, and the model when it is not set. */
  engine?: ReplyEngine;
  env?: Record<string, string | undefined>;
  /** Replaceable for tests. */
  llm?: (input: { text: string; language: string }) => Promise<unknown>;
  askJev?: typeof askJev;
};

async function classifyWithModel(cleaned: string, options: ClassifyReplyOptions): Promise<ReplyClassification> {
  try {
    const out = await (options.llm ?? classifyReplyFlow)({ text: cleaned, language: 'es' });
    return withHardNegativeGuard(cleaned, out as ReplyClassification);
  } catch (e) {
    return heuristicClassify(cleaned);
  }
}

/** Jev's answer to the reply, or null if asking failed in a way the client did not already absorb. */
async function askJevAboutReply(cleaned: string, options: ClassifyReplyOptions): Promise<JevResult | null> {
  try {
    return await (options.askJev ?? askJev)({ state: { reply: cleaned }, questions: { intent: REPLY_JEV_QUESTION }, env: options.env });
  } catch {
    return null;
  }
}

/** The shadow mode leaves one line per reply with whether Jev and the model agree. Never the reply, its summary or the key. */
function logJevShadow(model: ReplyClassification, jev: JevResult | null) {
  const answer = jev?.answers?.intent;
  const read = jevReplyRead(answer);
  console.info('[reply-classifier] jev shadow', JSON.stringify({
    model: model.intent, jev: read.intent, agree: read.intent === model.intent, trusted: jevReplyClassification(answer) !== null,
    confidence: read.confidence, status: jev?.status ?? 'error', ms: jev?.durationMs ?? null, costUsd: jev?.costUsd ?? null,
  }));
}

export async function classifyReply(raw: string, options: ClassifyReplyOptions = {}): Promise<ReplyClassification> {
  const cleaned = newReplyText(raw).slice(0, 3000);
  if (isExplicitOptOut(cleaned)) {
    return { intent: 'unsubscribe', sentiment: 'negative', shouldContinue: false, confidence: 1, summary: 'Solicitó no recibir más correos comerciales', reason: 'explicit_opt_out' };
  }
  if (!cleaned) {
    return { intent: 'unknown', sentiment: 'neutral', shouldContinue: false, confidence: 0.2, summary: 'Empty reply', reason: 'empty' };
  }

  const engine = options.engine ?? replyEngine(options.env);
  if (engine === 'jev-first') {
    // Jev decides when it is sure; without a key, on a timeout, an error or less certainty, the model reads the reply as always.
    const decided = jevReplyClassification((await askJevAboutReply(cleaned, options))?.answers?.intent);
    if (decided) return withHardNegativeGuard(cleaned, decided);
  }
  const shadow = engine === 'shadow' ? askJevAboutReply(cleaned, options) : null;
  const result = await classifyWithModel(cleaned, options);
  if (shadow) logJevShadow(result, await shadow);
  return result;
}

export function extractReplyPreview(raw: string) {
  const cleaned = stripHtml(String(raw || '')).trim();
  return cleaned.slice(0, 180);
}

import { classifyReplyFlow } from '@/ai/flows/classify-reply';

export type ReplyClassification = {
  intent: 'meeting_request' | 'positive' | 'negative' | 'unsubscribe' | 'auto_reply' | 'neutral' | 'unknown';
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

  const isUnsub = /unsubscribe|darse de baja|darte de baja|remove me|no me contacten|no me escriban|stop emailing|stop sending/i.test(t);
  if (isUnsub) {
    return { intent: 'unsubscribe', sentiment: 'negative', shouldContinue: false, confidence: 0.8, summary: 'Requested to unsubscribe', reason: 'unsubscribe' };
  }

  const isMeeting = /reunion|meet|meeting|call|llamada|agenda|agendar|calendly|zoom|teams|disponibilidad|schedule/i.test(t);
  if (isMeeting) {
    return { intent: 'meeting_request', sentiment: 'positive', shouldContinue: false, confidence: 0.75, summary: 'Asked to schedule a meeting', reason: 'meeting_request' };
  }

  const isNegative = /no estoy interesado|no me interesa|no gracias|no, gracias|no deseo|no quiero|no por ahora|no seguimos|no continuar|no contactarme|not interested|do not contact/i.test(t);
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

export async function classifyReply(raw: string): Promise<ReplyClassification> {
  const cleaned = stripHtml(String(raw || '')).slice(0, 3000);
  if (!cleaned) {
    return { intent: 'unknown', sentiment: 'neutral', shouldContinue: false, confidence: 0.2, summary: 'Empty reply', reason: 'empty' };
  }

  try {
    const out = await classifyReplyFlow({ text: cleaned, language: 'es' });
    return out as ReplyClassification;
  } catch (e) {
    return heuristicClassify(cleaned);
  }
}

export function extractReplyPreview(raw: string) {
  const cleaned = stripHtml(String(raw || '')).trim();
  return cleaned.slice(0, 180);
}

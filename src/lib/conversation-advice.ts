import type { ReplyClassification } from './reply-classifier';

export type ConversationAdvice = {
  action: 'reply' | 'meeting' | 'wait' | 'close' | 'blocked' | 'review';
  title: string; reason: string; confidence: number; replyId: string; generatedAt: string;
};

/** The model classifies evidence; this policy decides the bounded next action.
 * It cannot send, reactivate a sequence or invent a meeting/date. */
export function conversationAdvice(input: ReplyClassification, replyId: string, now = new Date().toISOString()): ConversationAdvice {
  const base = { confidence: Number.isFinite(input.confidence) ? input.confidence : 0, replyId, generatedAt: now };
  if (input.intent === 'unsubscribe') return { ...base, action: 'blocked', title: 'No volver a contactar', reason: 'Solicitó dejar de recibir correos. Mantén detenidos los seguimientos.' };
  if (input.intent === 'delivery_failure') return { ...base, action: 'blocked', title: 'Comprobar dirección', reason: 'Se detectó un problema de entrega. No reintentar automáticamente.' };
  if (base.confidence < 0.75 || input.intent === 'unknown') return { ...base, action: 'review', title: 'Revisar la respuesta', reason: 'La interpretación es incierta. Lee el mensaje antes de elegir el siguiente paso.' };
  const reason = input.summary?.slice(0, 500) || 'Basado en la última respuesta registrada.';
  switch (input.intent) {
    case 'meeting_request': return { ...base, action: 'meeting', title: 'Coordinar una reunión', reason };
    case 'positive': return { ...base, action: 'reply', title: 'Responder al interés', reason };
    case 'negative': return { ...base, action: 'close', title: 'Cerrar esta gestión', reason: 'Mostró desinterés. Conserva el historial y evita insistir con la secuencia actual.' };
    case 'auto_reply': return { ...base, action: 'wait', title: 'Esperar y revisar más adelante', reason: 'Es una respuesta automática. Confirma una fecha antes de crear un recordatorio; no se reactivan envíos.' };
    default: return { ...base, action: 'review', title: 'Elegir el próximo compromiso', reason };
  }
}

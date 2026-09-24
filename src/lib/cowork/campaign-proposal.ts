import { z } from 'zod';
import { AudienceCriteriaSchema } from '@/lib/bulk-campaigns';

/** Nulls from model output mean "not specified", never a value: coerce them to
 * undefined so documented defaults apply instead of failing the proposal. */
function nullsToUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(nullsToUndefined);
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => [key, item === null ? undefined : nullsToUndefined(item)]));
  }
  return value;
}

/** Fase 2D/4: bounded campaign definition the model may propose. Tighter than the
 * app schema (25 recipients, 7 messages) because every line of copy and every
 * recipient passes human review before anything exists. Seven messages cover
 * the canonical seven-touch cadence (days 1/3/7/11/16/23/38). */
export const coworkCampaignDraftSchema = z.object({
  name: z.string().trim().min(1).max(120),
  objective: z.preprocess(value => value ?? undefined, z.string().trim().max(500).default('')),
  criteria: z.preprocess(nullsToUndefined, AudienceCriteriaSchema),
  emails: z.array(z.string().trim().email().max(320).transform(value => value.toLowerCase())).min(1).max(25),
  messages: z.array(z.object({
    subject: z.string().trim().min(1).max(300),
    body: z.string().trim().min(1).max(12000),
    delayDays: z.number().int().min(0).max(90),
  }).strict()).min(1).max(7),
  provider: z.enum(['google', 'outlook']),
}).strict().superRefine((value, context) => {
  if (new Set(value.emails).size !== value.emails.length) {
    context.addIssue({ code: 'custom', path: ['emails'], message: 'Hay destinatarios duplicados.' });
  }
  value.messages.forEach((message, index) => {
    if (value.emails.length > 1 && /^\s*(?:hola|estimad[oa])\s+[\p{L}]{2,}/iu.test(message.body)) {
      context.addIssue({ code: 'custom', path: ['messages', index, 'body'],
        message: 'Una campaña para varias personas no puede incluir el nombre fijo de una sola en el saludo. Usa un saludo neutro.' });
    }
    // A reviewed sequence must not promise to stop and then send again.
    // Reject explicit closing promises; never silently rewrite approved copy.
    const text = `${message.subject} ${message.body}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (index < value.messages.length - 1
      && /\b(?:ultim[oa] (?:vez|mensaje|contacto|correo|seguimiento)|cierro (?:el|este) hilo|no (?:vuelvo|volvere) a (?:escribir|insistir))\b/i.test(text)) {
      context.addIssue({ code: 'custom', path: ['messages', index, 'body'],
        message: 'Solo el último toque puede anunciar el cierre del hilo. Corrige la secuencia antes de proponerla.' });
    }
    if ((index === 0 && message.delayDays !== 0) || (index > 0 && message.delayDays < 1)) {
      context.addIssue({ code: 'custom', path: ['messages', index, 'delayDays'], message: 'El primer correo es inmediato; los seguimientos esperan al menos un día.' });
    }
  });
});
export type CoworkCampaignDraft = z.infer<typeof coworkCampaignDraftSchema>;

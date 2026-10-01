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

/** The campaign's variables, filled with each person's data (renderCampaignMessage). */
const VARIABLE = /\{\{\s*([^{}]+?)\s*\}\}/g;
const CAMPAIGN_VARIABLES = new Set(['nombre', 'empresa', 'cargo']);

/** A first email written for one recipient (from what is known of them, for example their research);
 * it replaces the template's first email for that person only (the definition's overrides). */
const coworkFirstEmailSchema = z.object({
  email: z.string().trim().email().max(320).transform(value => value.toLowerCase()),
  subject: z.string().trim().min(1).max(300),
  body: z.string().trim().min(1).max(12000),
}).strict();

/** Fase 2D/4: bounded campaign definition the model may propose. Tighter than the
 * app schema (25 recipients, 7 messages) because every line of copy and every
 * recipient passes human review before anything exists. Seven messages cover
 * the canonical seven-touch cadence (days 1/3/7/11/16/23/38). The follow-ups are
 * one template for everyone, with {{nombre}}, {{empresa}} and {{cargo}}; the
 * first email can be written for each person (firstEmails). */
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
  firstEmails: z.preprocess(value => value ?? undefined, z.array(coworkFirstEmailSchema).max(25).default([])),
}).strict().superRefine((value, context) => {
  if (new Set(value.emails).size !== value.emails.length) {
    context.addIssue({ code: 'custom', path: ['emails'], message: 'Hay destinatarios duplicados.' });
  }
  const recipients = new Set(value.emails);
  const own = new Set<string>();
  value.firstEmails.forEach((item, index) => {
    if (!recipients.has(item.email)) {
      context.addIssue({ code: 'custom', path: ['firstEmails', index, 'email'], message: `${item.email} no está entre los destinatarios: cada primer correo propio va a uno de ellos.` });
    } else if (own.has(item.email)) {
      context.addIssue({ code: 'custom', path: ['firstEmails', index, 'email'], message: `Hay dos primeros correos para ${item.email}.` });
    }
    own.add(item.email);
  });
  const texts: Array<[Array<string | number>, string]> = [
    ...value.messages.flatMap((message, index): Array<[Array<string | number>, string]> => [[['messages', index, 'subject'], message.subject], [['messages', index, 'body'], message.body]]),
    ...value.firstEmails.flatMap((item, index): Array<[Array<string | number>, string]> => [[['firstEmails', index, 'subject'], item.subject], [['firstEmails', index, 'body'], item.body]]),
  ];
  for (const [path, text] of texts) {
    const unknown = [...text.matchAll(VARIABLE)].map(match => match[1]).find(name => !CAMPAIGN_VARIABLES.has(name));
    if (unknown !== undefined) {
      context.addIssue({ code: 'custom', path, message: `La variable {{${unknown}}} no existe: usa solo {{nombre}}, {{empresa}} o {{cargo}}.` });
    }
  }
  value.messages.forEach((message, index) => {
    if (value.emails.length > 1 && /^\s*(?:hola|estimad[oa])\s+[\p{L}]{2,}/iu.test(message.body)) {
      context.addIssue({ code: 'custom', path: ['messages', index, 'body'],
        message: 'Una campaña para varias personas no puede llevar el nombre fijo de una sola en el saludo. Usa «Hola {{nombre}},»: la campaña pone el nombre de pila de cada una.' });
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

import { z } from 'zod';
import { AudienceCriteriaSchema } from '@/lib/bulk-campaigns';

/** Fase 2D: bounded campaign definition the model may propose. Tighter than the
 * app schema (25 recipients, 3 messages) because every line of copy and every
 * recipient passes human review before anything exists. */
export const coworkCampaignDraftSchema = z.object({
  name: z.string().trim().min(1).max(120),
  objective: z.string().trim().max(500).default(''),
  criteria: AudienceCriteriaSchema,
  emails: z.array(z.string().trim().email().max(320).transform(value => value.toLowerCase())).min(1).max(25),
  messages: z.array(z.object({
    subject: z.string().trim().min(1).max(300),
    body: z.string().trim().min(1).max(12000),
    delayDays: z.number().int().min(0).max(90),
  }).strict()).min(1).max(3),
  provider: z.enum(['google', 'outlook']),
}).strict().superRefine((value, context) => {
  if (new Set(value.emails).size !== value.emails.length) {
    context.addIssue({ code: 'custom', path: ['emails'], message: 'Hay destinatarios duplicados.' });
  }
  value.messages.forEach((message, index) => {
    if ((index === 0 && message.delayDays !== 0) || (index > 0 && message.delayDays < 1)) {
      context.addIssue({ code: 'custom', path: ['messages', index, 'delayDays'], message: 'El primer correo es inmediato; los seguimientos esperan al menos un día.' });
    }
  });
});
export type CoworkCampaignDraft = z.infer<typeof coworkCampaignDraftSchema>;

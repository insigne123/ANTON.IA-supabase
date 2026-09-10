import { z } from 'zod';
import { AudienceCriteriaSchema, CampaignMessageSchema } from './bulk-campaigns';

const DraftMessageSchema = z.object({
  subject: z.string().max(300), body: z.string().max(12000),
  delayDays: z.number().int().min(0).max(90),
}).strict();

export const BulkAssistInputSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('audience'), description: z.string().trim().min(10).max(2000), criteria: AudienceCriteriaSchema }).strict(),
  z.object({
    mode: z.literal('message'), instruction: z.string().trim().min(5).max(2000),
    objective: z.string().trim().max(2000), current: DraftMessageSchema,
    relationship: z.enum(['never_contacted', 'previously_contacted']),
    sequenceContext: z.array(DraftMessageSchema).min(1).max(5).optional(),
    messageIndex: z.number().int().min(0).max(4).optional(),
    audience: z.string().trim().max(2000).optional(),
  }).strict(),
  z.object({
    mode: z.literal('sequence'), objective: z.string().trim().min(5, 'Describe el objetivo de la campaña.').max(2000),
    audience: z.string().trim().max(2000),
    relationship: z.enum(['never_contacted', 'previously_contacted']),
    followUpDelays: z.array(z.number().int().min(1).max(90)).max(4),
  }).strict(),
]);

export const CampaignSequenceProposalSchema = z.object({
  messages: z.array(CampaignMessageSchema).min(1).max(5),
}).strict();

/** The requested schedule, not model output, determines sequence length and delays. */
export function validateSequenceProposal(value: unknown, followUpDelays: number[]) {
  const parsed = CampaignSequenceProposalSchema.safeParse(value);
  if (!parsed.success || parsed.data.messages.length !== followUpDelays.length + 1) {
    throw Object.assign(new Error('La IA no devolvió la secuencia completa. Vuelve a intentarlo.'), { status: 502 });
  }
  return parsed.data.messages.map((message, index) => ({
    ...message, delayDays: index === 0 ? 0 : followUpDelays[index - 1],
  }));
}

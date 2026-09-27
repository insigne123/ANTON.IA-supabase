import { z } from 'zod';
import { CampaignInputSchema } from '@/lib/bulk-campaigns';

/** Editing the emails of a campaign proposal before approving it: the pure part,
 * shared by the server route and its tests. */

/** A refusal the person can act on (the proposal moved on, the text does not fit). */
export class CoworkCampaignEditRefused extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409) {
    super(message);
    this.name = 'CoworkCampaignEditRefused';
  }
}

export const coworkCampaignEditSchema = z.object({
  messages: z.array(z.object({
    subject: z.string().trim().min(1).max(300),
    body: z.string().trim().min(1).max(12000),
  }).strict()).min(1).max(7),
}).strict();

/** The staged definition with the person's subjects and bodies: same recipients,
 * number of emails and spacing. `changed` lists the emails that differ. */
export function coworkEditedCampaignDefinition(definition: unknown, edits: CoworkCampaignEdit) {
  const current = CampaignInputSchema.parse(definition);
  if (edits.length !== current.messages.length) {
    throw new CoworkCampaignEditRefused(`La campaña tiene ${current.messages.length} correos: edítalos sin agregar ni quitar.`, 400);
  }
  const next = CampaignInputSchema.parse({ ...current,
    messages: current.messages.map((message, index) => ({ ...message, subject: edits[index].subject, body: edits[index].body })) });
  const changed = next.messages.flatMap((message, index) =>
    message.subject !== current.messages[index].subject || message.body !== current.messages[index].body ? [index] : []);
  return { next, changed };
}

export type CoworkCampaignEdit = z.infer<typeof coworkCampaignEditSchema>['messages'];

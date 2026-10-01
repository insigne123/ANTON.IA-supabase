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

const emailText = { subject: z.string().trim().min(1).max(300), body: z.string().trim().min(1).max(12000) };

/** Either the emails of the sequence (the template, for everyone) or the first email of one person. */
export const coworkCampaignEditSchema = z.object({
  /** Version seen in the preview. Older clients without it must reload before saving. */
  expectedHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  messages: z.array(z.object(emailText).strict()).min(1).max(7).optional(),
  person: z.object({ email: z.string().trim().email().max(320).transform(value => value.toLowerCase()), ...emailText }).strict().optional(),
}).strict().refine(value => Boolean(value.messages) !== Boolean(value.person), 'Edita los correos de la secuencia o el de una persona, uno a la vez.');

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

/** The staged definition with one person's first email (an override at the first step): the template and the
 * other recipients stay as reviewed. `changed` is [0] when the text differs from what that person had. */
export function coworkEditedCampaignPerson(definition: unknown, person: CoworkCampaignPersonEdit) {
  const current = CampaignInputSchema.parse(definition);
  if (!current.emails.includes(person.email)) {
    throw new CoworkCampaignEditRefused(`${person.email} no está entre los destinatarios de esta campaña.`, 400);
  }
  const own = current.overrides.find(item => item.email === person.email && item.messageIndex === 0);
  const before = own ?? current.messages[0];
  if (before.subject === person.subject && before.body === person.body) return { next: current, changed: [] as number[] };
  const next = CampaignInputSchema.parse({ ...current, overrides: [
    ...current.overrides.filter(item => item.email !== person.email || item.messageIndex !== 0),
    { email: person.email, messageIndex: 0, subject: person.subject, body: person.body },
  ] });
  return { next, changed: [0] };
}

export type CoworkCampaignEdit = NonNullable<z.infer<typeof coworkCampaignEditSchema>['messages']>;
export type CoworkCampaignPersonEdit = NonNullable<z.infer<typeof coworkCampaignEditSchema>['person']>;

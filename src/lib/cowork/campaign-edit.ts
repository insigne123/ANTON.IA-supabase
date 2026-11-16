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

const recipient = z.string().trim().email().max(320).transform(value => value.toLowerCase());

/**
 * The emails of the sequence (the template, for everyone), the first email of one person, or every email of several people as the
 * app wrote them for each one (`personal`, 17 Nov 2026: docs/campanas-un-correo-por-persona.md).
 */
export const coworkCampaignEditSchema = z.object({
  /** Version seen in the preview. Older clients without it must reload before saving. */
  expectedHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  messages: z.array(z.object(emailText).strict()).min(1).max(7).optional(),
  person: z.object({ email: recipient, ...emailText }).strict().optional(),
  personal: z.array(z.object({ email: recipient, messages: z.array(z.object(emailText).strict()).min(1).max(7) }).strict()).min(1).max(25).optional(),
}).strict().refine(value => [value.messages, value.person, value.personal].filter(Boolean).length === 1, 'Edita los correos de la secuencia o los de una persona, uno a la vez.');

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

/**
 * The staged definition with the emails written for several people, one sequence each. Whoever had a first email of their own and
 * nothing else (written from their research, or by hand) keeps it: only their follow-ups come from here. `changed` lists the steps.
 */
export function coworkPersonalCampaignDefinition(definition: unknown, personal: CoworkCampaignPersonal) {
  const current = CampaignInputSchema.parse(definition);
  const steps = current.messages.length;
  let overrides = current.overrides;
  const changed = new Set<number>();
  for (const person of personal) {
    if (!current.emails.includes(person.email)) throw new CoworkCampaignEditRefused(`${person.email} no está entre los destinatarios de esta campaña.`, 400);
    if (person.messages.length !== steps) throw new CoworkCampaignEditRefused(`La campaña tiene ${steps} correos: cada persona lleva los mismos.`, 400);
    const mine = overrides.filter(item => item.email === person.email);
    const keepFirst = mine.some(item => item.messageIndex === 0) && mine.length < steps;
    const next = person.messages.map((message, messageIndex) => (keepFirst && messageIndex === 0
      ? mine.find(item => item.messageIndex === 0)!
      : { email: person.email, messageIndex, subject: message.subject, body: message.body }));
    next.forEach(item => {
      const before = mine.find(old => old.messageIndex === item.messageIndex);
      if (!before || before.subject !== item.subject || before.body !== item.body) changed.add(item.messageIndex);
    });
    overrides = [...overrides.filter(item => item.email !== person.email), ...next];
  }
  if (!changed.size) return { next: current, changed: [] as number[] };
  return { next: CampaignInputSchema.parse({ ...current, overrides }), changed: [...changed].sort((a, b) => a - b) };
}

export type CoworkCampaignPersonal = NonNullable<z.infer<typeof coworkCampaignEditSchema>['personal']>;
export type CoworkCampaignEdit = NonNullable<z.infer<typeof coworkCampaignEditSchema>['messages']>;
export type CoworkCampaignPersonEdit = NonNullable<z.infer<typeof coworkCampaignEditSchema>['person']>;

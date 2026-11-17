import { z } from 'zod';
import { AudienceCriteriaSchema, CampaignMessageSchema, type CampaignInput, type CampaignMessage } from '@/lib/bulk-campaigns';

/**
 * A campaign where every person gets emails written for them (17 Nov 2026). The owner, after the recommended contacts got their own
 * writer: «ese sistema sigue generando mails genéricos, que es justamente lo que no quiero; quiero que cada correo sea personalizado
 * y distinto, que se haga de cero».
 *
 * Until now a campaign was one text with {{nombre}}, {{empresa}} and {{cargo}}: a hundred people read the same email. The texts of
 * the campaign are now the guide (what is offered, what is asked, in which tone) and the server writes, for each recipient, the whole
 * sequence from what is known of them (src/lib/server/campaign-personal.ts). Each written email is kept as an edit of that person
 * (`overrides`), which the campaign already had for the ones corrected by hand: the review, the approval and the sending do not change.
 * A person the writer could not write for keeps the guide, and the review says so.
 */

/** People written in one request: each takes one or two calls to the model, all at once. */
export const PERSONALIZE_BATCH = 5;
/** Requests the page keeps open at a time. */
export const PERSONALIZE_PARALLEL = 3;

export const PersonalizeInputSchema = z.object({
  emails: z.array(z.string().trim().email().transform(value => value.toLowerCase())).min(1).max(PERSONALIZE_BATCH),
  objective: z.string().trim().max(2000),
  description: z.string().trim().max(2000).default(''),
  relationship: AudienceCriteriaSchema.shape.relationship,
  messages: z.array(CampaignMessageSchema).min(1).max(7),
  /** Where this batch starts in the campaign: each person opens with a different proof of the seller. */
  offset: z.number().int().min(0).max(1000).default(0),
}).strict();
export type PersonalizeInput = z.infer<typeof PersonalizeInputSchema>;

export type PersonalEmails = { email: string; messages: Array<{ subject: string; body: string }> };
export type PersonalizeResult = { written: PersonalEmails[]; failed: Array<{ email: string; reason: string }> };

type Definition = Pick<CampaignInput, 'emails' | 'messages'> & { overrides?: CampaignInput['overrides'] };

/** The day each email goes, counted from the first (day 1): a campaign keeps the days between one and the next. */
export function sequenceDays(messages: Array<Pick<CampaignMessage, 'delayDays'>>): number[] {
  let day = 1;
  return messages.map((message, index) => (index === 0 ? day : (day += Math.max(1, Math.round(Number(message.delayDays) || 1)))));
}

/** Who still reads the guide in some email: the people the writer has not written for, or could not. */
export function personalMissing(definition: Definition): string[] {
  const own = new Set((definition.overrides || []).map(override => `${override.email}:${override.messageIndex}`));
  return definition.emails.filter(email => definition.messages.some((_, index) => !own.has(`${email}:${index}`)));
}

/** The campaign with the emails just written: they replace whatever those people had. */
export function withPersonalEmails(definition: Definition, written: PersonalEmails[]): NonNullable<CampaignInput['overrides']> {
  const fresh = new Set(written.map(person => person.email));
  return [
    ...(definition.overrides || []).filter(override => !fresh.has(override.email)),
    ...written.flatMap(person => person.messages.slice(0, definition.messages.length)
      .map((message, messageIndex) => ({ email: person.email, messageIndex, subject: message.subject, body: message.body }))),
  ];
}

/**
 * The emails of each person that stay when the guide or the audience change: the ones of whoever is still chosen, in the emails
 * whose text did not change. A step that was rewritten or removed takes its emails with it, so they are written again.
 */
export function keptOverrides(previous: Definition, next: Pick<CampaignInput, 'emails' | 'messages'>): NonNullable<CampaignInput['overrides']> {
  const chosen = new Set(next.emails);
  const same = (index: number) => {
    const before = previous.messages[index];
    const after = next.messages[index];
    return Boolean(before && after && before.subject === after.subject && before.body === after.body);
  };
  return (previous.overrides || []).filter(override => chosen.has(override.email) && same(override.messageIndex));
}

/**
 * The emails in groups of a request, each with where it starts. Whoever already has a first email of their own (`alone`: Cowork wrote
 * it from their research, or the person did by hand) goes in a request of one, since that email is their guide and no one else's.
 */
export function personalBatches(emails: string[], alone: string[] = []): Array<{ emails: string[]; offset: number }> {
  const batches: Array<{ emails: string[]; offset: number }> = [];
  const shared = emails.filter(email => !alone.includes(email));
  for (let offset = 0; offset < shared.length; offset += PERSONALIZE_BATCH) batches.push({ emails: shared.slice(offset, offset + PERSONALIZE_BATCH), offset });
  emails.filter(email => alone.includes(email)).forEach((email, index) => batches.push({ emails: [email], offset: shared.length + index }));
  return batches;
}

/** How long writing takes, said before it starts: a request of five takes 20 to 60 s (measured on 12 real contacts, 17 Nov 2026), three at a time. */
export function personalEstimate(people: number): string {
  const seconds = Math.ceil(Math.ceil(people / PERSONALIZE_BATCH) / PERSONALIZE_PARALLEL) * 40;
  return seconds < 90 ? 'menos de un minuto' : `unos ${Math.round(seconds / 60)} minutos`;
}

type Writable = Pick<CampaignInput, 'objective' | 'description' | 'messages'> & { criteria: Pick<CampaignInput['criteria'], 'relationship'> };
export type PersonalRun = PersonalizeResult & {
  /** The person stopped it: whoever was not reached keeps the guide. */
  stopped: boolean;
  /** The day's limit was reached, in the server's words. */
  limit: string | null;
};

/**
 * Writes the emails of `emails`, a few requests at a time, and tries once more whoever failed. `send` is the request to the server;
 * it throws with `status` 429 when the day's limit is reached, and then nothing else is asked.
 */
export async function writePersonalEmails(input: {
  definition: Writable; emails: string[];
  send: (body: z.input<typeof PersonalizeInputSchema>) => Promise<PersonalizeResult>;
  onProgress?: (done: number, total: number) => void;
  stopped?: () => boolean;
  /** The first email some of them already have of their own: their follow-ups are written from it, not from the campaign's. */
  own?: Record<string, { subject: string; body: string }>;
}): Promise<PersonalRun> {
  const { definition } = input;
  const run: PersonalRun = { written: [], failed: [], stopped: false, limit: null };
  let done = 0;
  const pass = async (emails: string[], total: number) => {
    const queue = personalBatches(emails, Object.keys(input.own || {}));
    const failed: PersonalizeResult['failed'] = [];
    const worker = async () => {
      for (let batch = queue.shift(); batch; batch = queue.shift()) {
        if (run.limit) { failed.push(...batch.emails.map(email => ({ email, reason: run.limit! }))); continue; }
        if (input.stopped?.()) { run.stopped = true; return; }
        try {
          const first = batch.emails.length === 1 ? input.own?.[batch.emails[0]] : undefined;
          const result = await input.send({ emails: batch.emails, offset: batch.offset, objective: definition.objective, description: definition.description,
            relationship: definition.criteria.relationship,
            messages: first ? definition.messages.map((message, index) => (index === 0 ? { ...message, subject: first.subject, body: first.body } : message)) : definition.messages });
          const got = new Set([...result.written.map(person => person.email), ...result.failed.map(person => person.email)]);
          run.written.push(...result.written.filter(person => person.messages.length === definition.messages.length));
          failed.push(...result.failed, ...batch.emails.filter(email => !got.has(email)).map(email => ({ email, reason: 'No se pudieron escribir sus correos.' })));
        } catch (error) {
          const reason = error instanceof Error && error.message ? error.message : 'No se pudieron escribir sus correos.';
          if ((error as { status?: number })?.status === 429) run.limit = reason;
          failed.push(...batch.emails.map(email => ({ email, reason })));
        }
        done += batch.emails.length;
        input.onProgress?.(Math.min(done, total), total);
      }
    };
    await Promise.all(Array.from({ length: PERSONALIZE_PARALLEL }, worker));
    return failed;
  };
  input.onProgress?.(0, input.emails.length);
  const first = await pass(input.emails, input.emails.length);
  // One more try for whoever failed: a slow answer or a malformed one seldom repeats.
  const again = first.length && !run.limit && !run.stopped ? first.map(person => person.email) : [];
  if (again.length) done -= again.length;
  run.failed = again.length ? await pass(again, input.emails.length) : first;
  return run;
}

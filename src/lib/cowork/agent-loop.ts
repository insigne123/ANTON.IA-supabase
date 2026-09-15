import { z } from 'zod';
import { coworkDocumentSchema } from './contracts';

export const coworkDecisionSchema = z.object({
  action: z.enum(['leads.search', 'leads.get', 'crm.propose_note', 'answer']),
  query: z.string().max(120).nullable(),
  leadId: z.string().uuid().nullable(),
  note: z.string().trim().min(1).max(4000).nullable().optional(),
  answer: coworkDocumentSchema.nullable(),
}).strict();

export type CoworkReadAction = 'leads.search' | 'leads.get';
export type CoworkObservation = { action: CoworkReadAction; input: string; result: unknown };
type Decision = z.infer<typeof coworkDecisionSchema>;

/** Bounded read-only loop. Tool outputs are observations, never instructions. */
export async function runCoworkReadLoop(input: {
  message: string;
  signal: AbortSignal;
  authorize: () => Promise<void>;
  decide: (observations: CoworkObservation[], mustAnswer: boolean) => Promise<Decision>;
  execute: (action: CoworkReadAction, value: string) => Promise<unknown>;
  record: (observation: CoworkObservation) => Promise<void>;
  proposeNote?: (leadId: string, note: string) => Promise<void>;
}) {
  const observations: CoworkObservation[] = [];
  for (let turn = 0; turn < 4; turn++) {
    input.signal.throwIfAborted();
    await input.authorize();
    const decision = coworkDecisionSchema.parse(await input.decide(observations, turn === 3));
    input.signal.throwIfAborted();
    if (decision.action === 'answer') {
      if (!decision.answer) throw new Error('Missing final answer');
      return decision.answer;
    }
    if (decision.action === 'crm.propose_note') {
      if (!input.proposeNote || !decision.leadId || !decision.note) throw new Error('Invalid note proposal');
      const observed = observations.some(observation => {
        const result = observation.result as { items?: Array<{ id?: string }> } | null;
        return Array.isArray(result?.items) && result.items.some(item => item.id === decision.leadId);
      });
      if (!observed) throw new Error('Note target must be observed first');
      await input.authorize();
      input.signal.throwIfAborted();
      await input.proposeNote(decision.leadId, decision.note);
      return { reply: 'Revisa el cambio de nota antes de guardarlo.', document: null };
    }
    if (turn === 3) throw new Error('Cowork tool budget exhausted');
    const value = decision.action === 'leads.get' ? decision.leadId : decision.query;
    if (value === null) throw new Error('Missing tool argument');
    await input.authorize();
    input.signal.throwIfAborted();
    const result = await input.execute(decision.action, value);
    input.signal.throwIfAborted();
    const observation = { action: decision.action, input: value, result };
    await input.authorize();
    await input.record(observation);
    observations.push(observation);
  }
  throw new Error('Cowork did not produce a final answer');
}

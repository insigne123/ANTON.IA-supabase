// What a good turn looks like for the AXIS benchmark tests (cowork-axis-paquete.test.ts, cowork-axis-resto.test.ts): reads in rounds,
// then one answer with its cards and quick replies, played through the real loop with a scripted model. And the turn that does
// nothing: it answers without looking and hands the work back.
import { coworkDecisionSchema } from '../../src/lib/cowork/agent-loop';
import type { CorpusDecider } from './cowork-conversation-runner';

export type Read = { action: string; input: string };
export type Chip = { label: string; message: string };
export type Block = Record<string, unknown>;

export const parallel = (reads: Read[]) => coworkDecisionSchema.parse({ action: 'reads.parallel', query: null, leadId: null, answer: null, reads });
export const answer = (reply: string, suggestions: Chip[], blocks?: Block[]) =>
  coworkDecisionSchema.parse({ action: 'answer', query: null, leadId: null, answer: { reply, document: null, suggestions, ...(blocks ? { blocks } : {}) } });
export const yes = (message: string): Chip[] => [{ label: 'Sí, adelante', message }];
export const draft = (title: string, to: string, subject: string, body: string) => ({ type: 'email_draft', title, to: [to], subject, body });
export const table = (title: string, columns: string[], rows: string[][]) => ({ type: 'table', title, columns, rows });
export const read = (action: string, input = ''): Read => ({ action, input });

/** What a good turn does, kept with the decider so a test can degrade one thing and see which check notices. */
export type IdealSpec = { rounds: Read[][]; reply: string; suggestions: Chip[]; blocks?: Block[] };
export type IdealDecider = CorpusDecider & { spec: IdealSpec };

/** Reads in rounds (up to three at once, as the loop allows), then the answer. */
export const ideal = (rounds: Read[][], reply: string, suggestions: Chip[], blocks?: Block[]): IdealDecider => Object.assign(
  (async context => {
    let seen = 0;
    for (const round of rounds) {
      if (context.observations.length <= seen) return parallel(round);
      seen += round.length;
    }
    return answer(reply, suggestions, blocks);
  }) as CorpusDecider,
  { spec: { rounds, reply, suggestions, blocks } });

/** The same good turn with one thing made worse: the reply, the cards or the reads. */
export const degrade = (good: IdealDecider, change: { reply?: (text: string) => string; blocks?: (blocks: Block[]) => Block[]; rounds?: (rounds: Read[][]) => Read[][] }): CorpusDecider =>
  ideal(change.rounds ? change.rounds(good.spec.rounds) : good.spec.rounds, change.reply ? change.reply(good.spec.reply) : good.spec.reply, good.spec.suggestions,
    change.blocks ? change.blocks(good.spec.blocks ?? []) : good.spec.blocks);

/** A turn that does not look, does not say what it cannot do and hands the work back. */
export const naive: CorpusDecider = async () => answer('Puedo ayudarte con eso.\n¿Qué quieres hacer primero?', yes('Sí, adelante'));

/** The same reads as a good turn and then an answer that says nothing: looking is not enough. */
export const vacuous = (inner: CorpusDecider): CorpusDecider => async (context, meta) => {
  const decision = await inner(context, meta);
  return decision.action === 'answer' ? answer('Revisé los datos que pediste.\n¿Seguimos?', yes('Sí, adelante')) : decision;
};

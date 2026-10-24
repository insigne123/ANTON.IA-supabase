import { AuthError } from '@/lib/server/auth-utils';
import { validateOpportunityFacts, type DocumentChunk } from '@/lib/commercial-opportunities/expedient';
import { STEPS_AT_ONCE } from '@/lib/commercial-opportunities/model-policy';

type Facts = Parameters<typeof validateOpportunityFacts>[0];
/** A turn starts reading a group while this much of it has passed: the group still ends inside the route's five minutes. */
const READING_MS = 120_000;

/**
 * The documents of a report read in parts of four fragments, four parts at a time (OPP-18): one by one, a report of 26 parts took 15
 * to 21 minutes. Each part's facts go in the documents' order, whichever answered first, so the facts, and the report's step that
 * hashes them, are the same when a job resumes. A part that cannot be read (a malformed answer, or one already paid and unanswered) is
 * skipped and counted; anything else, a budget refusal or another process holding the job, stops it. `waiting`: the turn ran out.
 */
export async function readOpportunityParts(chunks: DocumentChunk[], readPart: (block: DocumentChunk[]) => Promise<{ facts: Facts; missing: string[] }>,
  options: { started: number; note: (read: number, block: DocumentChunk[]) => Promise<void>; now?: () => number }) {
  const now = options.now ?? Date.now;
  const facts: ReturnType<typeof validateOpportunityFacts> = [];
  const missing: string[] = [];
  let skipped = 0;
  for (let offset = 0; offset < chunks.length; offset += 4 * STEPS_AT_ONCE) {
    if (now() - options.started > READING_MS) return { waiting: true as const };
    const blocks = Array.from({ length: Math.min(STEPS_AT_ONCE, Math.ceil((chunks.length - offset) / 4)) },
      (_, index) => chunks.slice(offset + index * 4, offset + index * 4 + 4));
    await options.note(offset / 4, blocks[0]);
    const outcomes = await Promise.allSettled(blocks.map(readPart));
    for (const [index, outcome] of outcomes.entries()) {
      if (outcome.status === 'rejected') {
        const error = outcome.reason;
        if (!(error instanceof AuthError) || ![503, 409].includes(error.status) || /presupuesto|otro proceso/i.test(error.message)) throw error;
        skipped++; continue;
      }
      facts.push(...validateOpportunityFacts(outcome.value.facts, blocks[index])); missing.push(...outcome.value.missing);
    }
  }
  return { waiting: false as const, facts, missing, skipped };
}

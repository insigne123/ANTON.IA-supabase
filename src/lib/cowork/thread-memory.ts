import { z } from 'zod';

/**
 * The memory of a conversation (docs/cowork-conversaciones-largas.md). A turn sees only the last turns of its history, so what
 * was asked at the start (the offer in play, who is being looked for) used to get lost in long conversations. The coordinator
 * keeps a short structured summary with its final decision of each turn; the next turn reads it with the first request of the
 * conversation, which never leaves the context.
 */

const line = (max: number) => z.string().trim().min(1).max(max);

export const coworkThreadMemorySchema = z.object({
  /** The product or service in play in this conversation, as the person said it. */
  offer: line(400).nullable(),
  /** Who is being looked for: roles, sector, country, size. */
  audience: line(400).nullable(),
  /** The people of this work and how each one is (saved, with email, researched, contacted…). */
  people: z.array(z.object({
    leadId: z.string().uuid().nullable(),
    name: line(120),
    company: line(120).nullable(),
    status: line(200),
  }).strict()).max(25),
  /** What was decided (tone, channel, a contact to leave out…). */
  decisions: z.array(line(240)).max(10),
  /** What is still to be done. */
  pending: z.array(line(240)).max(8),
}).strict();
export type CoworkThreadMemory = z.infer<typeof coworkThreadMemorySchema>;

/** A stored memory, or null when there is none or it no longer reads as one. Never throws. */
export function readCoworkThreadMemory(value: unknown): CoworkThreadMemory | null {
  const parsed = coworkThreadMemorySchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

const MEMORY_INSTRUCTION = 'threadMemory resume toda la conversación, más allá de los últimos turnos de history: firstRequest es el primer pedido del usuario, '
  + 'y memory (si existe) trae la oferta en juego, a quién se busca, las personas de este trabajo con su estado, las decisiones y lo pendiente. '
  + 'Úsalo para no perder lo pedido al comienzo. Si el usuario dijo en esta conversación qué producto promociona, esa oferta manda sobre userContext.offer.';

/** What the decision context carries about the whole conversation: its first request and the latest memory. */
export function coworkThreadMemoryContext(input: { firstRequest: string | null; memory: CoworkThreadMemory | null }) {
  if (!input.firstRequest && !input.memory) return null;
  return {
    firstRequest: input.firstRequest ? input.firstRequest.slice(0, 1500) : null,
    memory: input.memory,
    instruction: MEMORY_INSTRUCTION,
  };
}

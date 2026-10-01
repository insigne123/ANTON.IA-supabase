import { createHash } from 'node:crypto';
import { APOLLO_PHONE_ENRICHMENT_CREDITS } from '@/lib/apollo-credit-costs';

/** What a phone reveal is pinned to (the server half is src/lib/server/cowork/enrich-phone.ts): the contact and a hash of who the card showed, so an
 * approval can only reveal the phone of the person the card named, at the cost it showed. Pure: no database, no provider. */

/** Credits one reveal costs, from the same table the rest of the app shows (apollo-credit-costs.ts). */
export const COWORK_PHONE_REVEAL_CREDITS = APOLLO_PHONE_ENRICHMENT_CREDITS;

/** Off unless the variable is exactly «true»: the switch that also stops a reveal already approved. */
export function coworkPhoneRevealEnabled(env: Record<string, string | undefined> = process.env) {
  return env.COWORK_PHONE_REVEAL_ENABLED === 'true';
}

export type CoworkPhoneWho = { name: string; company: string; linkedin: string; apolloId: string; cost: number };

/** The person as the card shows them: if any of it changes between the proposal and the approval, nothing is requested. */
export function hashCoworkPhoneReveal(runId: string, leadId: string, who: CoworkPhoneWho) {
  return createHash('sha256').update(JSON.stringify(['cowork|enrich-phone', runId, leadId, who.name, who.company, who.linkedin, who.apolloId, who.cost])).digest('hex');
}

const TARGET = /^enrichphone:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):([a-f0-9]{64})$/;
export function parseCoworkPhoneRevealTarget(targetId: string) {
  const match = TARGET.exec(String(targetId || ''));
  if (!match) throw new Error('La propuesta de teléfono no es válida.');
  return { leadId: match[1], hash: match[2] };
}
export const coworkPhoneRevealTarget = (leadId: string, hash: string) => `enrichphone:${leadId}:${hash}`;

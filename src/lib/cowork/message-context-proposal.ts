import { z } from 'zod';
import { canonicalSha256 } from '@/lib/messaging-contracts';

const termList = z.array(z.string().trim().min(1).max(120)).max(40);
const claimList = z.array(z.object({
  claim: z.string().trim().min(1).max(500),
  evidence: z.string().trim().min(1).max(500),
}).strict()).max(30);
const exampleList = z.array(z.object({
  label: z.string().trim().min(1).max(120),
  text: z.string().trim().min(1).max(2000),
}).strict()).max(10);

/** Commercial writing context for one organization. Approved by a human;
 * never inferred from a single conversation. Empty proposal is rejected. */
export const coworkMessageContextClearableFieldSchema = z.enum(['voiceExamples', 'prohibitedTerms', 'requiredTerms',
  'approvedClaims', 'trialOffer', 'defaultStyleProfileId', 'roleCta', 'verticalNotes']);
export type CoworkMessageContextClearableField = z.infer<typeof coworkMessageContextClearableFieldSchema>;

export const coworkMessageContextPatchSchema = z.object({
  clear: z.array(coworkMessageContextClearableFieldSchema).max(8).nullish(),
  voiceExamples: exampleList.nullish(),
  prohibitedTerms: termList.nullish(),
  requiredTerms: termList.nullish(),
  approvedClaims: claimList.nullish(),
  trialOffer: z.string().trim().min(1).max(2000).nullish(),
  defaultStyleProfileId: z.string().trim().min(1).max(200).nullish(),
  roleCta: z.object({
    decisionMaker: z.string().trim().min(1).max(500),
    user: z.string().trim().min(1).max(500),
    referrer: z.string().trim().min(1).max(500),
  }).strict().partial().nullish(),
  verticalNotes: z.array(z.object({
    sector: z.string().trim().min(1).max(120),
    note: z.string().trim().min(1).max(2000),
  }).strict()).max(20).nullish(),
}).strict().superRefine((value, context) => {
  const cleared = new Set(value.clear || []);
  const hasContent = (entry: unknown) => entry !== undefined && entry !== null
    && (typeof entry !== 'object' || Object.keys(entry).length > 0);
  for (const field of cleared) {
    // An empty list is equivalent to clearing, not a contradiction.
    if (hasContent((value as Record<string, unknown>)[field])) {
      context.addIssue({ code: 'custom', message: `El campo ${field} no puede cambiarse y borrarse a la vez.` });
    }
  }
  const { clear: _clear, ...rest } = value;
  void _clear;
  if (!cleared.size && !Object.values(rest).some(entry => entry !== undefined && entry !== null
    && (typeof entry !== 'object' || Object.keys(entry).length > 0))) {
    context.addIssue({ code: 'custom', message: 'La propuesta no cambia ningún campo.' });
  }
});
export type CoworkMessageContextPatch = z.infer<typeof coworkMessageContextPatchSchema>;

export function hashCoworkMessageContextPatch(patch: CoworkMessageContextPatch) {
  return canonicalSha256({ kind: 'message_context_update', patch });
}

/** Hash of the exact normalized values that are previewed, stored and
 * executed. Reviewing one representation while applying another is refused. */
export function hashCoworkStoredMessageContextPatch(patch: Record<string, unknown>) {
  return canonicalSha256({ kind: 'message_context_update', stored: patch });
}

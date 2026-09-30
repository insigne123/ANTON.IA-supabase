import { z } from 'zod';
import { canonicalSha256 } from '@/lib/messaging-contracts';

/** Commercial identity and a channel-specific signature for human review.
 * Signature markup is sanitized on the server before it is staged. */
export const coworkProfilePatchSchema = z.object({
  name: z.string().trim().max(200).optional(),
  role: z.string().trim().max(200).optional(),
  companyName: z.string().trim().max(200).optional(),
  sector: z.string().trim().max(200).optional(),
  website: z.string().trim().max(500).optional(),
  description: z.string().trim().max(2000).optional(),
  services: z.string().trim().max(2000).optional(),
  valueProposition: z.string().trim().max(2000).optional(),
  proofPoints: z.string().trim().max(2000).optional(),
  signature: z.object({ channel: z.enum(['gmail', 'outlook']),
    html: z.string().trim().min(1).max(12000), enabled: z.boolean(),
    separatorPlaintext: z.boolean().default(true),
  }).strict().optional(),
}).strict().superRefine((value, context) => {
  if (!Object.values(value).some(entry => (entry ?? '') !== '')) {
    context.addIssue({ code: 'custom', message: 'La propuesta no cambia ningún campo.' });
  }
});
export type CoworkProfilePatch = z.infer<typeof coworkProfilePatchSchema>;

const field = (max: number) => z.string().trim().max(max).nullable().optional();
/**
 * The patch as the model sends it. Strict structured output makes every field required, so a field the
 * person did not ask to change comes as null: null (or empty) means «leave it as it is». Without this,
 * a null failed the decision and the model learned to fill every field, signature included.
 */
export const coworkProfileDecisionSchema = z.object({
  name: field(200), role: field(200), companyName: field(200), sector: field(200), website: field(500),
  description: field(2000), services: field(2000), valueProposition: field(2000), proofPoints: field(2000),
  signature: z.object({ channel: z.enum(['gmail', 'outlook']),
    html: z.string().trim().max(12000), enabled: z.boolean(),
    separatorPlaintext: z.boolean().default(true),
  }).strict().nullable().optional(),
}).strict();

/** Only the fields that change: nulls and empty values are dropped. Null when nothing is left to change. */
export function coworkProfilePatchFromDecision(value: z.infer<typeof coworkProfileDecisionSchema> | null | undefined): CoworkProfilePatch | null {
  if (!value) return null;
  const changed = Object.fromEntries(Object.entries(value).filter(([key, entry]) => entry !== null && entry !== undefined
    && (typeof entry === 'string' ? entry.trim() !== '' : key !== 'signature' || Boolean((entry as { html?: string }).html?.trim()))));
  const parsed = coworkProfilePatchSchema.safeParse(changed);
  return parsed.success ? parsed.data : null;
}

/** Stable fingerprint pinned in the effect target (`profile:<hash>`). */
export function hashCoworkProfilePatch(patch: CoworkProfilePatch) {
  return canonicalSha256({ kind: 'profile_update', patch });
}

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

/** Stable fingerprint pinned in the effect target (`profile:<hash>`). */
export function hashCoworkProfilePatch(patch: CoworkProfilePatch) {
  return canonicalSha256({ kind: 'profile_update', patch });
}

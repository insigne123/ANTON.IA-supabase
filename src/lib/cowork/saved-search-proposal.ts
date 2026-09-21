import { z } from 'zod';
import { canonicalSha256 } from '@/lib/messaging-contracts';

const nameSchema = z.string().trim().min(1).max(160);

export const coworkSavedSearchCreateSchema = z.object({
  name: nameSchema,
  criteria: z.unknown(),
  isShared: z.boolean().default(false),
}).strict();
export type CoworkSavedSearchCreate = z.infer<typeof coworkSavedSearchCreateSchema>;

export const coworkSavedSearchUpdateSchema = z.object({
  id: z.string().uuid(),
  name: nameSchema.optional(),
  criteria: z.unknown().optional(),
  isShared: z.boolean().optional(),
}).strict().superRefine((value, context) => {
  if (value.name === undefined && value.criteria === undefined && value.isShared === undefined) {
    context.addIssue({ code: 'custom', message: 'La propuesta no cambia ningún campo.' });
  }
});
export type CoworkSavedSearchUpdate = z.infer<typeof coworkSavedSearchUpdateSchema>;

export const coworkSavedSearchDeleteSchema = z.object({ id: z.string().uuid() }).strict();
export type CoworkSavedSearchDelete = z.infer<typeof coworkSavedSearchDeleteSchema>;

/** Stable fingerprint pinned in the effect target
 * (`savedsearch:<create|update|delete>:<hash>`), including the reviewed delete snapshot. */
export function hashCoworkSavedSearchProposal(op: 'create' | 'update' | 'delete', payload: unknown) {
  return canonicalSha256({ kind: `saved_search_${op}`, payload });
}

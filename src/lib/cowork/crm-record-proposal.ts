import { z } from 'zod';
import { canonicalSha256 } from '@/lib/messaging-contracts';

const STAGES = ['inbox', 'qualified', 'contacted', 'engaged', 'meeting', 'negotiation', 'closed_won', 'closed_lost'] as const;

/** Sheet-level record change the model may submit for human review. Only the
 * commercial fields of the unified record; never collaboration assignment,
 * autopilot flags, tokens or other rows. Empty proposal is rejected. */
export const coworkCrmRecordPatchSchema = z.object({
  gid: z.string().trim().min(1).max(120)
    .regex(/^(lead_saved|lead_enriched)\|.+$/, 'La ficha debe observarse vía crm.record.'),
  stage: z.enum(STAGES).optional(),
  owner: z.string().trim().min(1).max(200).optional(),
  notes: z.string().trim().min(1).max(4000).optional(),
  nextAction: z.string().trim().min(1).max(500).optional(),
  nextActionType: z.string().trim().min(1).max(80).optional(),
  nextActionDueAt: z.string().trim().min(1).max(40).optional(),
  meetingLink: z.string().trim().min(1).max(500).optional(),
}).strict().superRefine((value, context) => {
  if (value.nextActionDueAt !== undefined && Number.isNaN(Date.parse(value.nextActionDueAt))) {
    context.addIssue({ code: 'custom', path: ['nextActionDueAt'], message: 'La fecha debe ser una fecha válida.' });
  }
  if (value.meetingLink !== undefined) {
    try {
      const url = new URL(value.meetingLink);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('bad protocol');
    } catch {
      context.addIssue({ code: 'custom', path: ['meetingLink'], message: 'El enlace debe ser http(s).' });
    }
  }
  const { gid: _gid, ...fields } = value;
  if (!Object.values(fields).some(entry => entry !== undefined)) {
    context.addIssue({ code: 'custom', message: 'La propuesta no cambia ningún campo.' });
  }
});
export type CoworkCrmRecordPatch = z.infer<typeof coworkCrmRecordPatchSchema>;

/** Stable fingerprint pinned in the effect target (`crmrecord:<hash>`). */
export function hashCoworkCrmRecordProposal(patch: CoworkCrmRecordPatch) {
  return canonicalSha256({ kind: 'crm_update_record', patch });
}

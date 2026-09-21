import { z } from 'zod';
import { EmailStyleSelectionSchema } from './outsourcing-email-style-presets';

export const ResearchSequenceRequestSchema = z.object({
  researchSnapshotId: z.string().uuid(),
  styleProfileId: EmailStyleSelectionSchema.nullable().default(null),
  instruction: z.string().trim().max(1_000).default(''),
}).strict();

export const ResearchSequenceViewSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['queued', 'running', 'retry_scheduled', 'completed', 'failed', 'review_required']),
  stage: z.enum(['brief', 'initial', 'follow_ups', 'editorial', 'done']),
  error: z.string().nullable(),
  retryAt: z.string().nullable(),
  // Echo of the preparation request so the UI can offer a new steered version.
  researchSnapshotId: z.string().uuid().nullable(),
  styleProfileId: z.string().nullable(),
  editorial: z.object({ passed: z.boolean(), issues: z.array(z.string()), versionIds: z.array(z.string()) }).nullable(),
  slots: z.array(z.object({
    index: z.number().int(), name: z.string(),
    status: z.enum(['queued', 'running', 'ready', 'error']),
    draftId: z.string().nullable(), versionId: z.string().nullable(),
    subject: z.string().nullable(), body: z.string().nullable(),
  })).length(4),
});
export type ResearchSequenceView = z.infer<typeof ResearchSequenceViewSchema>;

import { z } from 'zod';
import { EmailStyleSelectionSchema } from './outsourcing-email-style-presets';

export const ResearchSequenceRequestSchema = z.object({
  researchSnapshotId: z.string().uuid(),
  styleProfileId: EmailStyleSelectionSchema.nullable().default(null),
  instruction: z.string().trim().max(1_000).default(''),
  followUpCount: z.number().int().min(0).max(3).default(3),
  // Business days after the initial email when each follow-up becomes due.
  // Empty means the default cadence. Otherwise one day per follow-up, strictly increasing.
  offsets: z.array(z.number().int().min(1).max(30)).max(3).default([]),
}).strict().superRefine((value, context) => {
  if (value.offsets.length !== 0 && value.offsets.length !== value.followUpCount) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['offsets'],
      message: 'Sequence offsets must include one day per follow-up',
    });
  }
  value.offsets.forEach((day, index) => {
    if (index > 0 && day <= value.offsets[index - 1]!) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['offsets', index],
        message: 'Follow-up days must increase from one email to the next',
      });
    }
  });
});

export const ResearchSequenceViewSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['queued', 'running', 'retry_scheduled', 'completed', 'failed', 'review_required']),
  stage: z.enum(['brief', 'initial', 'follow_ups', 'editorial', 'done']),
  error: z.string().nullable(),
  retryAt: z.string().nullable(),
  // Echo of the preparation request so the UI can offer a new steered version.
  researchSnapshotId: z.string().uuid().nullable(),
  styleProfileId: z.string().nullable(),
  followUpCount: z.number().int().min(0).max(3),
  // Effective business-day offsets of each follow-up after the initial email.
  offsets: z.array(z.number().int()),
  editorial: z.object({ passed: z.boolean(), issues: z.array(z.string()), versionIds: z.array(z.string()) }).nullable(),
  slots: z.array(z.object({
    index: z.number().int(), name: z.string(),
    status: z.enum(['queued', 'running', 'ready', 'error']),
    draftId: z.string().nullable(), versionId: z.string().nullable(),
    subject: z.string().nullable(), body: z.string().nullable(),
  })).min(1).max(4),
});
export type ResearchSequenceView = z.infer<typeof ResearchSequenceViewSchema>;

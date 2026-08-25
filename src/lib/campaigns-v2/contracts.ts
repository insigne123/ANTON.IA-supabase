import { z } from 'zod';

import { MessagingApprovalV1Schema, MessagingDraftV1Schema } from '@/lib/messaging-contracts';

import { CampaignV2StepStateSchema } from './inbox-contracts';

export * from './inbox-contracts';

const UuidSchema = z.string().uuid();
const IsoDateTimeSchema = z.string().datetime({ offset: true });

export const CampaignV2DraftSummarySchema = z.object({
  draftId: UuidSchema,
  versionId: UuidSchema,
  subject: z.string().trim().min(1).max(998),
  body: z.string().trim().min(1).max(500_000),
  lifecycle: z.enum(['draft', 'ready', 'archived']),
  approval: MessagingApprovalV1Schema,
}).strict();
export type CampaignV2DraftSummary = z.infer<typeof CampaignV2DraftSummarySchema>;

export const CampaignV2DraftGenerationSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ready'), error: z.null() }).strict(),
  z.object({
    status: z.literal('error'),
    error: z.string().trim().min(1).max(2_000),
  }).strict(),
]);
export type CampaignV2DraftGeneration = z.infer<typeof CampaignV2DraftGenerationSchema>;

export const CampaignV2PlanStepSchema = z.object({
  id: UuidSchema,
  name: z.string().trim().min(1).max(120),
  kind: z.literal('follow_up'),
  offsetDays: z.number().int().min(1).max(365),
  state: CampaignV2StepStateSchema,
  dueAt: IsoDateTimeSchema.nullable(),
  nativeDraftId: UuidSchema.nullable(),
  draft: CampaignV2DraftSummarySchema.nullable(),
  draftGeneration: CampaignV2DraftGenerationSchema,
}).strict().superRefine((step, context) => {
  if (Boolean(step.nativeDraftId) !== Boolean(step.draft)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['draft'],
      message: 'Campaign follow-up draft summary must match the linked native draft',
    });
  }
  if (step.draft && step.draft.draftId !== step.nativeDraftId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['draft', 'draftId'],
      message: 'Campaign follow-up draft summary has the wrong draft id',
    });
  }
  if ((step.draftGeneration.status === 'ready') !== Boolean(step.draft)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['draftGeneration'],
      message: 'Campaign follow-up generation state must match the draft summary',
    });
  }
});
export type CampaignV2PlanStep = z.infer<typeof CampaignV2PlanStepSchema>;

export const FirstContactPlanSchema = z.object({
  campaignId: UuidSchema,
  campaignName: z.string().trim().min(1).max(300),
  lifecycleState: z.enum(['draft', 'active', 'completed', 'stopped', 'blocked']),
  enrollmentId: UuidSchema,
  enrollmentState: z.enum(['pending_initial_send', 'active', 'completed', 'stopped', 'blocked']),
  nextDueAt: IsoDateTimeSchema.nullable(),
  steps: z.array(CampaignV2PlanStepSchema).min(1).max(4),
}).strict();
export type FirstContactPlan = z.infer<typeof FirstContactPlanSchema>;

export const GetFirstContactPlanResponseSchema = z.object({
  enabled: z.boolean(),
  plan: FirstContactPlanSchema.nullable(),
}).strict();
export type GetFirstContactPlanResponse = z.infer<typeof GetFirstContactPlanResponseSchema>;

export const CreateFirstContactPlanBodySchema = z.object({
  draftId: UuidSchema,
  versionId: UuidSchema,
  styleProfileId: UuidSchema.nullable().optional(),
  sequenceInstruction: z.string().trim().min(1).max(1_000),
  steps: z.array(z.object({
    name: z.string().trim().min(1).max(120),
    offsetDays: z.number().int().min(1).max(365),
    instruction: z.string().trim().min(1).max(1_000),
  }).strict()).min(1).max(4),
}).strict();
export type CreateFirstContactPlanBody = z.infer<typeof CreateFirstContactPlanBodySchema>;

export const CreateFirstContactPlanResponseSchema = z.object({
  enabled: z.literal(true),
  plan: FirstContactPlanSchema,
}).strict();
export type CreateFirstContactPlanResponse = z.infer<typeof CreateFirstContactPlanResponseSchema>;

export const RetryFirstContactPlanStepBodySchema = z.object({
  draftId: UuidSchema,
  stepId: UuidSchema,
}).strict();
export type RetryFirstContactPlanStepBody = z.infer<typeof RetryFirstContactPlanStepBodySchema>;

export const RetryFirstContactPlanStepResponseSchema = CreateFirstContactPlanResponseSchema;
export type RetryFirstContactPlanStepResponse = z.infer<typeof RetryFirstContactPlanStepResponseSchema>;

export const CampaignV2DispatchStatusSchema = z.enum([
  'pending',
  'sending',
  'sent',
  'failed',
  'deferred',
  'unknown',
]);
export type CampaignV2DispatchStatus = z.infer<typeof CampaignV2DispatchStatusSchema>;

export const CampaignV2DispatchRetrySchema = z.object({
  retryable: z.literal(true),
  phase: z.enum(['pre_provider', 'provider_deferred']),
  code: z.string().trim().min(1).max(200).nullable(),
  retryAt: IsoDateTimeSchema.nullable(),
  retryAfterMs: z.number().int().nonnegative().nullable(),
}).strict();
export type CampaignV2DispatchRetry = z.infer<typeof CampaignV2DispatchRetrySchema>;

export const CampaignV2StepDispatchSchema = z.object({
  id: UuidSchema,
  status: CampaignV2DispatchStatusSchema,
  idempotencyKey: z.string().trim().min(1).max(200),
  provider: z.string().trim().min(1).max(100),
  providerMessageId: z.string().trim().min(1).max(2_000).nullable(),
  errorCode: z.string().trim().min(1).max(200).nullable(),
  errorMessage: z.string().trim().min(1).max(2_000).nullable(),
  retry: CampaignV2DispatchRetrySchema.nullable(),
}).strict();
export type CampaignV2StepDispatch = z.infer<typeof CampaignV2StepDispatchSchema>;

export const CampaignV2RecipientStepSendContextResponseSchema = z.object({
  stepId: UuidSchema,
  organizationId: UuidSchema,
  state: CampaignV2StepStateSchema,
  nativeDraftId: UuidSchema.nullable(),
  nativeVersionId: UuidSchema.nullable(),
  dispatch: CampaignV2StepDispatchSchema.nullable(),
}).strict().refine(
  (value) => Boolean(value.nativeDraftId) === Boolean(value.nativeVersionId),
  { message: 'Campaign recipient step draft and version must be present together' },
);
export type CampaignV2RecipientStepSendContextResponse = z.infer<typeof CampaignV2RecipientStepSendContextResponseSchema>;

export const PrepareCampaignV2DraftResponseSchema = z.object({
  draft: MessagingDraftV1Schema,
  composeUrl: z.string().trim().min(1).max(2_048),
}).strict();
export type PrepareCampaignV2DraftResponse = z.infer<typeof PrepareCampaignV2DraftResponseSchema>;

export const StoppedCampaignV2EnrollmentSchema = z.object({
  id: UuidSchema,
  campaignId: UuidSchema,
  status: z.literal('stopped'),
  stoppedAt: IsoDateTimeSchema,
  recipientName: z.string().trim().min(1).max(300).nullable(),
  recipientEmail: z.string().trim().email().max(320),
}).strict();
export type StoppedCampaignV2Enrollment = z.infer<typeof StoppedCampaignV2EnrollmentSchema>;

export const StopCampaignV2EnrollmentResponseSchema = StoppedCampaignV2EnrollmentSchema;
export type StopCampaignV2EnrollmentResponse = z.infer<typeof StopCampaignV2EnrollmentResponseSchema>;

export const CampaignV2DraftIdQuerySchema = z.object({
  draftId: UuidSchema,
}).strict();

import { z } from 'zod';

const UuidSchema = z.string().uuid();
const IsoDateTimeSchema = z.string().datetime({ offset: true });

export const CampaignV2StepStateSchema = z.enum([
  'pending_initial_send',
  'not_due',
  'ready_to_prepare',
  'drafting',
  'review_required',
  'approved',
  'dispatch_pending',
  'sending',
  'sent',
  'deferred',
  'failed',
  'unknown',
  'skipped',
  'blocked',
]);
export type CampaignV2StepState = z.infer<typeof CampaignV2StepStateSchema>;

export const CampaignV2NextActionSchema = z.enum(['prepare', 'review', 'send', 'resolve']);
export type CampaignV2NextAction = z.infer<typeof CampaignV2NextActionSchema>;

export const CampaignV2InboxItemSchema = z.object({
  stepId: UuidSchema,
  campaignId: UuidSchema,
  enrollmentId: UuidSchema,
  campaignName: z.string().trim().min(1).max(300),
  recipientName: z.string().trim().min(1).max(300).nullable(),
  recipientEmail: z.string().trim().email().max(320),
  stepName: z.string().trim().min(1).max(120),
  state: CampaignV2StepStateSchema,
  dueAt: IsoDateTimeSchema.nullable(),
  nativeDraftId: UuidSchema.nullable(),
  composeUrl: z.string().trim().min(1).max(2_048).nullable(),
  nextAction: CampaignV2NextActionSchema,
}).strict();
export type CampaignV2InboxItem = z.infer<typeof CampaignV2InboxItemSchema>;

export const CampaignV2InboxSummarySchema = z.object({
  scope: z.literal('page'),
  displayed: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
  attention: z.number().int().nonnegative(),
  campaigns: z.number().int().nonnegative(),
}).strict();
export type CampaignV2InboxSummary = z.infer<typeof CampaignV2InboxSummarySchema>;

export const CampaignV2InboxPageSchema = z.object({
  limit: z.number().int().min(1).max(100),
  returned: z.number().int().nonnegative().max(100),
  hasMore: z.boolean(),
  nextCursor: z.string().trim().min(1).max(512).nullable(),
}).strict().superRefine((value, context) => {
  if (value.hasMore !== Boolean(value.nextCursor)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Campaign inbox hasMore and nextCursor must agree',
      path: ['nextCursor'],
    });
  }
  if (value.returned > value.limit || (value.hasMore && value.returned !== value.limit)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Campaign inbox page size must agree with its limit',
      path: ['returned'],
    });
  }
});
export type CampaignV2InboxPage = z.infer<typeof CampaignV2InboxPageSchema>;

export const CampaignV2InboxResponseSchema = z.object({
  enabled: z.boolean(),
  items: z.array(CampaignV2InboxItemSchema),
  page: CampaignV2InboxPageSchema,
  summary: CampaignV2InboxSummarySchema,
}).strict().superRefine((value, context) => {
  if (value.page.returned !== value.items.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Campaign inbox returned count must match its items',
      path: ['page', 'returned'],
    });
  }
  if (value.summary.displayed !== value.items.length
    || value.summary.pending + value.summary.attention !== value.items.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Campaign inbox page summary must match its items',
      path: ['summary'],
    });
  }
  const attention = value.items.filter((item) => (
    item.state === 'deferred'
    || item.state === 'failed'
    || item.state === 'unknown'
    || item.state === 'blocked'
  )).length;
  if (value.summary.attention !== attention || value.summary.pending !== value.items.length - attention) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Campaign inbox page state counts must match its items',
      path: ['summary'],
    });
  }
  if (value.summary.campaigns !== new Set(value.items.map((item) => item.campaignId)).size) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Campaign inbox campaign count must match its items',
      path: ['summary', 'campaigns'],
    });
  }
  if (!value.enabled && (value.items.length > 0 || value.page.hasMore)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'A disabled campaign inbox must be empty',
      path: ['enabled'],
    });
  }
});
export type CampaignV2InboxResponse = z.infer<typeof CampaignV2InboxResponseSchema>;

export const CampaignV2InboxQuerySchema = z.object({
  cursor: z.string().trim().min(1).max(512).optional(),
}).strict();
export type CampaignV2InboxQuery = z.infer<typeof CampaignV2InboxQuerySchema>;

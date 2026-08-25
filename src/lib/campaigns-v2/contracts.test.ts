import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CampaignV2InboxResponseSchema,
  CampaignV2RecipientStepSendContextResponseSchema,
  CampaignV2StepStateSchema,
  CreateFirstContactPlanBodySchema,
  FirstContactPlanSchema,
  GetFirstContactPlanResponseSchema,
} from './contracts';

test('Campaign V2 contracts expose every required recipient step state', () => {
  assert.deepEqual(CampaignV2StepStateSchema.options, [
    'pending_initial_send', 'not_due', 'ready_to_prepare', 'drafting',
    'review_required', 'approved', 'dispatch_pending', 'sending', 'sent',
    'deferred', 'failed', 'unknown', 'skipped', 'blocked',
  ]);
});

test('first-contact plan input is strict and bounds delays and instructions', () => {
  const valid = {
    draftId: '10000000-0000-4000-8000-000000000001',
    versionId: '20000000-0000-4000-8000-000000000001',
    styleProfileId: null,
    sequenceInstruction: 'Haz avanzar la conversación sin repetir argumentos.',
    steps: [{ name: 'Recordatorio', offsetDays: 3, instruction: 'Retoma el valor principal sin repetir el correo.' }],
  };
  assert.equal(CreateFirstContactPlanBodySchema.safeParse(valid).success, true);
  assert.equal(CreateFirstContactPlanBodySchema.safeParse({ ...valid, extra: true }).success, false);
  assert.equal(CreateFirstContactPlanBodySchema.safeParse({ ...valid, steps: [{ ...valid.steps[0], offsetDays: 0 }] }).success, false);
  assert.equal(CreateFirstContactPlanBodySchema.safeParse({ ...valid, steps: [{ ...valid.steps[0], instruction: 'x'.repeat(1_001) }] }).success, false);
  assert.equal(CreateFirstContactPlanBodySchema.safeParse({ ...valid, sequenceInstruction: '' }).success, false);
  assert.equal(CreateFirstContactPlanBodySchema.safeParse({ ...valid, sequenceInstruction: 'x'.repeat(1_001) }).success, false);
  const { sequenceInstruction: _sequenceInstruction, ...withoutSequenceInstruction } = valid;
  assert.equal(CreateFirstContactPlanBodySchema.safeParse(withoutSequenceInstruction).success, false);
  assert.equal(CreateFirstContactPlanBodySchema.safeParse({ ...valid, steps: [] }).success, false);
  assert.equal(CreateFirstContactPlanBodySchema.safeParse({ ...valid, steps: Array(5).fill(valid.steps[0]) }).success, false);
  assert.equal(CreateFirstContactPlanBodySchema.safeParse({
    ...valid,
    styleProfileId: '30000000-0000-4000-8000-000000000001',
  }).success, true);
});

test('first-contact plan steps expose strict current draft summaries and generation failures', () => {
  const base = {
    campaignId: '10000000-0000-4000-8000-000000000001',
    campaignName: 'Seguimiento a Ada',
    lifecycleState: 'draft',
    enrollmentId: '20000000-0000-4000-8000-000000000001',
    enrollmentState: 'pending_initial_send',
    nextDueAt: null,
  };
  const readyStep = {
    id: '30000000-0000-4000-8000-000000000001',
    name: 'Seguimiento 1',
    kind: 'follow_up',
    offsetDays: 3,
    state: 'not_due',
    dueAt: null,
    nativeDraftId: '40000000-0000-4000-8000-000000000001',
    draft: {
      draftId: '40000000-0000-4000-8000-000000000001',
      versionId: '50000000-0000-4000-8000-000000000001',
      subject: 'Una idea adicional',
      body: 'Hola Ada, este es un seguimiento breve.',
      lifecycle: 'draft',
      approval: { status: 'pending', decidedBy: null, decidedAt: null, reason: null },
    },
    draftGeneration: { status: 'ready', error: null },
  };
  const failedStep = {
    ...readyStep,
    id: '30000000-0000-4000-8000-000000000002',
    nativeDraftId: null,
    draft: null,
    draftGeneration: { status: 'error', error: 'OpenAI no está disponible.' },
  };

  assert.equal(FirstContactPlanSchema.safeParse({ ...base, steps: [readyStep, failedStep] }).success, true);
  assert.equal(FirstContactPlanSchema.safeParse({
    ...base,
    steps: [{ ...readyStep, draftGeneration: { status: 'error', error: 'falló' } }],
  }).success, false);
  assert.equal(FirstContactPlanSchema.safeParse({
    ...base,
    steps: [{ ...readyStep, draft: { ...readyStep.draft, extra: true } }],
  }).success, false);
});

test('disabled read responses remain explicit and empty', () => {
  assert.deepEqual(GetFirstContactPlanResponseSchema.parse({ enabled: false, plan: null }), {
    enabled: false,
    plan: null,
  });
  assert.equal(CampaignV2InboxResponseSchema.safeParse({
    enabled: false,
    items: [],
    page: { limit: 50, returned: 0, hasMore: false, nextCursor: null },
    summary: { scope: 'page', displayed: 0, pending: 0, attention: 0, campaigns: 0 },
  }).success, true);
});

test('inbox pages require a complete cursor contract and a truthful page-scoped summary', () => {
  const pendingItem = {
    stepId: '10000000-0000-4000-8000-000000000001',
    campaignId: '20000000-0000-4000-8000-000000000001',
    enrollmentId: '30000000-0000-4000-8000-000000000001',
    campaignName: 'Campaña norte',
    recipientName: 'Ana Soto',
    recipientEmail: 'ana@example.com',
    stepName: 'Seguimiento 1',
    state: 'review_required',
    dueAt: '2026-08-26T12:00:00.000Z',
    nativeDraftId: '40000000-0000-4000-8000-000000000001',
    composeUrl: '/contact/compose?draftId=40000000-0000-4000-8000-000000000001',
    nextAction: 'review',
  };
  const validPage = {
    enabled: true,
    items: [pendingItem],
    page: { limit: 1, returned: 1, hasMore: true, nextCursor: 'opaque-cursor' },
    summary: { scope: 'page', displayed: 1, pending: 1, attention: 0, campaigns: 1 },
  };

  assert.equal(CampaignV2InboxResponseSchema.safeParse(validPage).success, true);
  assert.equal(CampaignV2InboxResponseSchema.safeParse({
    ...validPage,
    page: { ...validPage.page, nextCursor: null },
  }).success, false);
  assert.equal(CampaignV2InboxResponseSchema.safeParse({
    ...validPage,
    page: { ...validPage.page, limit: 2 },
  }).success, false);
  assert.equal(CampaignV2InboxResponseSchema.safeParse({
    ...validPage,
    summary: { ...validPage.summary, scope: 'loaded' },
  }).success, false);
  assert.equal(CampaignV2InboxResponseSchema.safeParse({
    ...validPage,
    summary: { ...validPage.summary, pending: 0, attention: 1 },
  }).success, false);
  assert.equal(CampaignV2InboxResponseSchema.safeParse({
    enabled: false,
    items: [],
    truncated: false,
    summary: { pending: 0, attention: 0, campaigns: 0 },
  }).success, false);
});

test('recipient step send context requires a paired draft version and explicit durable retry metadata', () => {
  const base = {
    stepId: '10000000-0000-4000-8000-000000000001',
    organizationId: '50000000-0000-4000-8000-000000000001',
    state: 'deferred',
    nativeDraftId: '20000000-0000-4000-8000-000000000001',
    nativeVersionId: '30000000-0000-4000-8000-000000000001',
    dispatch: {
      id: '40000000-0000-4000-8000-000000000001',
      status: 'deferred',
      idempotencyKey: 'campaign-v2-step:operation',
      provider: 'gmail',
      providerMessageId: null,
      errorCode: 'daily_quota_exceeded',
      errorMessage: 'Daily quota exceeded.',
      retry: {
        retryable: true,
        phase: 'provider_deferred',
        code: 'daily_quota_exceeded',
        retryAt: '2026-08-26T00:00:00.000Z',
        retryAfterMs: null,
      },
    },
  };

  assert.equal(CampaignV2RecipientStepSendContextResponseSchema.safeParse(base).success, true);
  assert.equal(CampaignV2RecipientStepSendContextResponseSchema.safeParse({ ...base, nativeVersionId: null }).success, false);
  assert.equal(CampaignV2RecipientStepSendContextResponseSchema.safeParse({
    ...base,
    dispatch: { ...base.dispatch, retry: { ...base.dispatch.retry, retryable: false } },
  }).success, false);
});

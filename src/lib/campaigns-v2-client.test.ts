import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import type { CampaignV2RecipientStepSendContextResponse } from './campaigns-v2/contracts';
import {
  campaignV2DispatchReceipt,
  campaignV2SendAvailability,
  loadCampaignV2RecipientStepSendContext,
  resolveCampaignV2SendKey,
  saveFirstContactFollowUpPlan,
  stopFirstContactFollowUpPlan,
} from './campaigns-v2-client';

const deferredContext: CampaignV2RecipientStepSendContextResponse = {
  stepId: '10000000-0000-4000-8000-000000000001',
  organizationId: '50000000-0000-4000-8000-000000000001',
  state: 'deferred',
  nativeDraftId: '20000000-0000-4000-8000-000000000001',
  nativeVersionId: '30000000-0000-4000-8000-000000000001',
  dispatch: {
    id: '40000000-0000-4000-8000-000000000001',
    status: 'deferred',
    idempotencyKey: 'persisted-campaign-key',
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
const composeSource = readFileSync('src/app/(app)/contact/compose/page.tsx', 'utf8');

test('loads the authoritative recipient step send context without caching', async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl = '';
  let requestCache: RequestCache | undefined;
  globalThis.fetch = async (input, init) => {
    requestUrl = String(input);
    requestCache = init?.cache;
    return new Response(JSON.stringify(deferredContext), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const result = await loadCampaignV2RecipientStepSendContext(deferredContext.stepId);
    assert.equal(requestUrl, `/api/campaigns/v2/recipient-steps/${deferredContext.stepId}/send-context`);
    assert.equal(requestCache, 'no-store');
    assert.equal(result.dispatch?.idempotencyKey, 'persisted-campaign-key');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('safe recovery uses the persisted key and never creates a new one when a dispatch exists', () => {
  let generated = 0;
  const key = resolveCampaignV2SendKey(deferredContext, () => {
    generated += 1;
    return 'new-key';
  });

  assert.deepEqual(campaignV2SendAvailability(deferredContext), {
    kind: 'safe_retry',
    idempotencyKey: 'persisted-campaign-key',
    provider: 'gmail',
  });
  assert.equal(key, 'persisted-campaign-key');
  assert.equal(generated, 0);
  assert.equal(campaignV2DispatchReceipt(deferredContext.dispatch!).dispatchId, deferredContext.dispatch!.id);
});

test('treats a durable pending dispatch as a safe same-key retry', () => {
  let generated = 0;
  const context: CampaignV2RecipientStepSendContextResponse = {
    ...deferredContext,
    state: 'dispatch_pending',
    dispatch: { ...deferredContext.dispatch!, status: 'pending', retry: null },
  };

  assert.deepEqual(campaignV2SendAvailability(context), {
    kind: 'safe_retry',
    idempotencyKey: 'persisted-campaign-key',
    provider: 'gmail',
  });
  assert.equal(resolveCampaignV2SendKey(context, () => { generated += 1; return 'new-key'; }), 'persisted-campaign-key');
  assert.equal(generated, 0);
});

test('blocks sending, unknown, failed, and sent dispatches while keeping deferred retry requirements', () => {
  for (const status of ['sending', 'unknown', 'failed', 'sent'] as const) {
    let generated = 0;
    const context: CampaignV2RecipientStepSendContextResponse = {
      ...deferredContext,
      state: status,
      dispatch: { ...deferredContext.dispatch!, status },
    };
    assert.equal(campaignV2SendAvailability(context).kind, 'blocked', status);
    assert.equal(resolveCampaignV2SendKey(context, () => { generated += 1; return 'new-key'; }), null);
    assert.equal(generated, 0, status);
  }

  const nonRetryableDeferred: CampaignV2RecipientStepSendContextResponse = {
    ...deferredContext,
    dispatch: { ...deferredContext.dispatch!, retry: null },
  };
  assert.equal(campaignV2SendAvailability(nonRetryableDeferred).kind, 'blocked');

  const stoppedPending: CampaignV2RecipientStepSendContextResponse = {
    ...deferredContext,
    state: 'skipped',
    dispatch: { ...deferredContext.dispatch!, status: 'pending', retry: null },
  };
  const stoppedDeferred: CampaignV2RecipientStepSendContextResponse = {
    ...deferredContext,
    state: 'skipped',
  };
  assert.equal(campaignV2SendAvailability(stoppedPending).kind, 'blocked');
  assert.equal(campaignV2SendAvailability(stoppedDeferred).kind, 'blocked');
});

test('creates a new key only for a dispatchable step with no dispatch', () => {
  let generated = 0;
  const context: CampaignV2RecipientStepSendContextResponse = {
    ...deferredContext,
    state: 'approved',
    dispatch: null,
  };
  assert.equal(resolveCampaignV2SendKey(context, () => `new-key-${++generated}`), 'new-key-1');
  assert.equal(generated, 1);
});

test('compose fails closed while Campaign V2 context is loading or unavailable', () => {
  assert.match(composeSource, /loadCampaignV2RecipientStepSendContext\(campaignStepId/);
  assert.match(composeSource, /nativeDraftLoading \|\| leadLoading \|\| campaignSendContextLoading/);
  assert.match(composeSource, /const loadError = campaignSendContextError/);
  assert.match(composeSource, /resolveCampaignV2SendKey\(campaignSendContext, createNewKey\)/);
  assert.match(composeSource, /sendReceipt\.status === 'deferred'[\s\S]+sendReceipt\.retry\?\.retryable === true[\s\S]+sendReceipt\.status === 'pending'/);
  assert.match(composeSource, /El proveedor no fue invocado\. Puedes retomar de forma segura/);
});

test('stops a first-contact plan through the existing enrollment endpoint', async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl = '';
  let requestMethod = '';
  globalThis.fetch = async (input, init) => {
    requestUrl = String(input);
    requestMethod = String(init?.method || 'GET');
    return new Response(JSON.stringify({
      id: '20000000-0000-4000-8000-000000000001',
      campaignId: '10000000-0000-4000-8000-000000000001',
      status: 'stopped',
      stoppedAt: '2026-08-25T12:00:00.000Z',
      recipientName: 'Ada',
      recipientEmail: 'ada@example.com',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const result = await stopFirstContactFollowUpPlan({
      campaignId: '10000000-0000-4000-8000-000000000001',
      enrollmentId: '20000000-0000-4000-8000-000000000001',
    });
    assert.equal(requestUrl, '/api/campaigns/v2/10000000-0000-4000-8000-000000000001/enrollments/20000000-0000-4000-8000-000000000001/stop');
    assert.equal(requestMethod, 'POST');
    assert.equal(result.status, 'stopped');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('saves sequence guidance and style while preserving generated draft summaries', async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: any = null;
  const plan = {
    campaignId: '10000000-0000-4000-8000-000000000001',
    campaignName: 'Seguimiento a Ada',
    lifecycleState: 'draft',
    enrollmentId: '20000000-0000-4000-8000-000000000001',
    enrollmentState: 'pending_initial_send',
    nextDueAt: null,
    steps: [{
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
        subject: 'Seguimiento breve',
        body: 'Hola Ada, retomo esta conversación.',
        lifecycle: 'draft',
        approval: { status: 'pending', decidedBy: null, decidedAt: null, reason: null },
      },
      draftGeneration: { status: 'ready', error: null },
    }],
  };
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body || '{}'));
    return new Response(JSON.stringify({ enabled: true, plan }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const result = await saveFirstContactFollowUpPlan({
      draftId: '60000000-0000-4000-8000-000000000001',
      versionId: '70000000-0000-4000-8000-000000000001',
      styleProfileId: null,
      sequenceInstruction: 'Avanza sin repetir el contacto inicial.',
      steps: [{ name: 'Seguimiento 1', offsetDays: 3, instruction: 'Sé breve.' }],
    });
    assert.equal(requestBody.styleProfileId, null);
    assert.equal(requestBody.sequenceInstruction, 'Avanza sin repetir el contacto inicial.');
    assert.equal(result.plan?.steps[0].draft?.approval.status, 'pending');
    assert.equal(result.plan?.steps[0].draftGeneration.status, 'ready');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

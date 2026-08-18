import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createMessagingSendMetadataV1,
  type MessagingDraftV1,
  type MessagingSendMetadataV1,
} from '../messaging-contracts';
import {
  dispatchOutboundMessage,
  OutboundDispatchConflictError,
  OutboundPreProviderDeferredError,
  reconcileUnknownOutboundDispatch,
  type OutboundDispatch,
  type OutboundDispatchRepository,
  type OutboundDispatchStatus,
  type OutboundMessageProvider,
} from './outbound-dispatch';

const ids = {
  draft: '10000000-0000-4000-8000-000000000001',
  version: '20000000-0000-4000-8000-000000000001',
  organization: '30000000-0000-4000-8000-000000000001',
  user: '40000000-0000-4000-8000-000000000001',
};
const now = () => '2026-08-13T09:30:00.000Z';

function readyDraft(subject = 'A precise subject'): MessagingDraftV1 {
  return {
    schemaVersion: 1,
    draftId: ids.draft,
    versionId: ids.version,
    organizationId: ids.organization,
    userId: ids.user,
    researchSnapshotId: null,
    revision: 1,
    parentVersionId: null,
    lifecycle: 'ready',
    channel: 'email',
    recipient: {
      leadRef: 'lead-1',
      displayName: 'Ada Lovelace',
      email: 'ada@example.com',
      linkedinUrl: null,
    },
    content: { subject, text: 'A useful message body.', html: null },
    approval: {
      status: 'approved',
      decidedBy: ids.user,
      decidedAt: '2026-08-13T09:20:00.000Z',
      reason: null,
    },
    preflight: {
      status: 'passed',
      checkedAt: '2026-08-13T09:25:00.000Z',
      errors: [],
      warnings: [],
    },
    createdAt: '2026-08-13T09:00:00.000Z',
  };
}

function metadataFor(draft: MessagingDraftV1, key = 'send:lead-1:revision-1') {
  return createMessagingSendMetadataV1(draft, {
    idempotencyKey: key,
    provider: 'fake-provider',
    requestedAt: now(),
  });
}

class MemoryDispatchRepository implements OutboundDispatchRepository {
  readonly records = new Map<string, OutboundDispatch>();
  failMarkSent = false;
  failReleaseQuota = false;
  releasedQuota = 0;
  private sequence = 0;

  async createPending(metadata: MessagingSendMetadataV1) {
    const key = `${metadata.organizationId}:${metadata.idempotencyKey}`;
    const existing = this.records.get(key);
    if (existing) return { created: false, dispatch: existing };

    const dispatch: OutboundDispatch = {
      id: `dispatch-${++this.sequence}`,
      organizationId: metadata.organizationId,
      userId: metadata.userId,
      draftId: metadata.draftId,
      versionId: metadata.versionId,
      idempotencyKey: metadata.idempotencyKey,
      contentHash: metadata.contentHash,
      channel: metadata.channel,
      provider: metadata.provider,
      status: 'pending',
      metadata,
      providerMessageId: null,
      providerResponse: null,
      errorCode: null,
      errorMessage: null,
      createdAt: metadata.requestedAt,
      updatedAt: metadata.requestedAt,
      startedAt: null,
      completedAt: null,
      attemptCount: 0,
    };
    this.records.set(key, dispatch);
    return { created: true, dispatch };
  }

  async markSending(
    dispatchId: string,
    input: { startedAt: string; expectedAttemptCount: number },
  ) {
    const dispatch = await this.findById(dispatchId);
    if (!dispatch) throw new Error('missing dispatch');
    if (
      !['pending', 'deferred'].includes(dispatch.status)
      || (dispatch.attemptCount || 0) !== input.expectedAttemptCount
    ) {
      return { claimed: false, dispatch };
    }
    return {
      claimed: true,
      dispatch: this.patch(dispatchId, ['pending', 'deferred'], {
        status: 'sending',
        startedAt: input.startedAt,
        completedAt: null,
        providerMessageId: null,
        providerResponse: null,
        errorCode: null,
        errorMessage: null,
        updatedAt: input.startedAt,
        attemptCount: input.expectedAttemptCount + 1,
      }),
    };
  }

  async markSent(
    dispatchId: string,
    input: { providerMessageId: string; providerResponse?: Record<string, unknown> | null; completedAt: string },
  ) {
    if (this.failMarkSent) throw new Error('database acknowledgement lost');
    return this.patch(dispatchId, ['sending'], {
      status: 'sent',
      providerMessageId: input.providerMessageId,
      providerResponse: input.providerResponse ?? null,
      completedAt: input.completedAt,
      updatedAt: input.completedAt,
    });
  }

  async markFailed(
    dispatchId: string,
    input: {
      errorCode?: string | null;
      errorMessage: string;
      providerResponse?: Record<string, unknown> | null;
      completedAt: string;
    },
  ) {
    return this.patch(dispatchId, ['sending'], {
      status: 'failed',
      errorCode: input.errorCode ?? null,
      errorMessage: input.errorMessage,
      providerResponse: input.providerResponse ?? null,
      completedAt: input.completedAt,
      updatedAt: input.completedAt,
    });
  }

  async markDeferred(
    dispatchId: string,
    input: {
      errorCode?: string | null;
      errorMessage: string;
      providerResponse?: Record<string, unknown> | null;
      completedAt: string;
    },
  ) {
    return this.patch(dispatchId, ['sending'], {
      status: 'deferred',
      providerMessageId: null,
      errorCode: input.errorCode ?? null,
      errorMessage: input.errorMessage,
      providerResponse: input.providerResponse ?? null,
      completedAt: input.completedAt,
      updatedAt: input.completedAt,
    });
  }

  async markUnknown(
    dispatchId: string,
    input: {
      errorCode?: string | null;
      errorMessage: string;
      providerMessageId?: string | null;
      providerResponse?: Record<string, unknown> | null;
      completedAt: string;
    },
  ) {
    return this.patch(dispatchId, ['pending', 'sending', 'deferred', 'unknown'], {
      status: 'unknown',
      errorCode: input.errorCode ?? null,
      errorMessage: input.errorMessage,
      providerMessageId: input.providerMessageId ?? null,
      providerResponse: input.providerResponse ?? null,
      completedAt: input.completedAt,
      updatedAt: input.completedAt,
    });
  }

  async findById(dispatchId: string) {
    return [...this.records.values()].find((record) => record.id === dispatchId) ?? null;
  }

  async findByIdempotencyKey(organizationId: string, idempotencyKey: string) {
    return this.records.get(`${organizationId}:${idempotencyKey}`) ?? null;
  }

  async releaseQuotaReservation() {
    if (this.failReleaseQuota) throw new Error('quota release unavailable');
    this.releasedQuota += 1;
  }

  seed(metadata: MessagingSendMetadataV1, status: OutboundDispatchStatus) {
    return this.createPending(metadata).then(({ dispatch }) => {
      dispatch.status = status;
      if (status !== 'pending') dispatch.attemptCount = 1;
      return dispatch;
    });
  }

  private patch(
    dispatchId: string,
    allowed: OutboundDispatchStatus[],
    patch: Partial<OutboundDispatch>,
  ) {
    const dispatch = [...this.records.values()].find((record) => record.id === dispatchId);
    if (!dispatch) throw new Error('missing dispatch');
    if (!allowed.includes(dispatch.status)) return dispatch;
    Object.assign(dispatch, patch);
    return dispatch;
  }
}

function countingProvider(
  result: Awaited<ReturnType<OutboundMessageProvider['send']>> = {
    outcome: 'accepted',
    providerMessageId: 'provider-message-1',
  },
) {
  let calls = 0;
  return {
    provider: {
      async send() {
        calls += 1;
        return result;
      },
    } satisfies OutboundMessageProvider,
    calls: () => calls,
  };
}

test('a duplicate key makes one provider call and replays the sent dispatch', async () => {
  const repository = new MemoryDispatchRepository();
  const provider = countingProvider();
  const draft = readyDraft();
  const metadata = metadataFor(draft);

  const first = await dispatchOutboundMessage({ draft, metadata, provider: provider.provider }, { repository, now });
  const duplicate = await dispatchOutboundMessage({ draft, metadata, provider: provider.provider }, { repository, now });

  assert.equal(provider.calls(), 1);
  assert.equal(first.status, 'sent');
  assert.equal(duplicate.status, 'sent');
  assert.equal(duplicate.replayed, true);
  assert.ok(duplicate.dispatch);
  assert.equal(duplicate.dispatch.providerMessageId, 'provider-message-1');
});

test('concurrent duplicate observes sending and cannot invoke the provider', async () => {
  const repository = new MemoryDispatchRepository();
  const draft = readyDraft();
  const metadata = metadataFor(draft);
  let calls = 0;
  let releaseProvider!: () => void;
  const held = new Promise<void>((resolve) => { releaseProvider = resolve; });
  const provider: OutboundMessageProvider = {
    async send() {
      calls += 1;
      await held;
      return { outcome: 'accepted', providerMessageId: 'provider-message-1' };
    },
  };

  const firstPromise = dispatchOutboundMessage({ draft, metadata, provider }, { repository, now });
  await Promise.resolve();
  await Promise.resolve();
  const duplicate = await dispatchOutboundMessage({ draft, metadata, provider }, { repository, now });
  releaseProvider();
  const first = await firstPromise;

  assert.equal(calls, 1);
  assert.equal(duplicate.status, 'sending');
  assert.equal(duplicate.replayed, true);
  assert.equal(first.status, 'sent');
});

test('the same idempotency key with changed content is a conflict', async () => {
  const repository = new MemoryDispatchRepository();
  const provider = countingProvider();
  const original = readyDraft();
  const changed = readyDraft('Changed content under the same key');

  await dispatchOutboundMessage({
    draft: original,
    metadata: metadataFor(original),
    provider: provider.provider,
  }, { repository, now });

  await assert.rejects(() => dispatchOutboundMessage({
    draft: changed,
    metadata: metadataFor(changed),
    provider: provider.provider,
  }, { repository, now }), OutboundDispatchConflictError);
  assert.equal(provider.calls(), 1);
});

test('confirmed provider rejection is failed and is never resent', async () => {
  const repository = new MemoryDispatchRepository();
  const provider = countingProvider({ outcome: 'rejected', code: 'invalid_recipient', message: 'Recipient rejected' });
  const draft = readyDraft();
  const metadata = metadataFor(draft);

  const first = await dispatchOutboundMessage({ draft, metadata, provider: provider.provider }, { repository, now });
  const replay = await dispatchOutboundMessage({ draft, metadata, provider: provider.provider }, { repository, now });

  assert.equal(first.status, 'failed');
  assert.ok(first.dispatch);
  assert.equal(first.dispatch.errorCode, 'invalid_recipient');
  assert.equal(replay.status, 'failed');
  assert.equal(provider.calls(), 1);
  assert.equal(repository.releasedQuota, 2);
});

test('daily quota rejection defers the dispatch and releases its reservation', async () => {
  const repository = new MemoryDispatchRepository();
  const provider = countingProvider({
    outcome: 'deferred',
    code: 'daily_quota_exceeded',
    message: 'Daily quota exceeded',
  });
  const draft = readyDraft();
  const metadata = metadataFor(draft, 'key:quota-deferred');

  const result = await dispatchOutboundMessage({ draft, metadata, provider: provider.provider }, { repository, now });

  assert.equal(result.status, 'deferred');
  assert.equal(result.dispatch.errorCode, 'daily_quota_exceeded');
  assert.equal(result.dispatch.attemptCount, 1);
  assert.equal(provider.calls(), 1);
  assert.equal(repository.releasedQuota, 1);
});

test('the same key can send after a quota-deferred day resets', async () => {
  const repository = new MemoryDispatchRepository();
  const draft = readyDraft();
  const metadata = metadataFor(draft, 'key:quota-next-day');
  let calls = 0;
  let currentTime = '2026-08-13T23:59:00.000Z';
  const provider: OutboundMessageProvider = {
    async send() {
      calls += 1;
      if (currentTime.startsWith('2026-08-13')) {
        return { outcome: 'deferred', code: 'daily_quota_exceeded', message: 'Daily quota exceeded' };
      }
      return { outcome: 'accepted', providerMessageId: 'provider-message-next-day' };
    },
  };

  const first = await dispatchOutboundMessage({ draft, metadata, provider }, { repository, now: () => currentTime });
  currentTime = '2026-08-14T00:01:00.000Z';
  const retry = await dispatchOutboundMessage({ draft, metadata, provider }, { repository, now: () => currentTime });

  assert.equal(first.status, 'deferred');
  assert.equal(retry.status, 'sent');
  assert.equal(retry.replayed, false);
  assert.equal(retry.dispatch.attemptCount, 2);
  assert.equal(retry.dispatch.errorCode, null);
  assert.equal(retry.dispatch.errorMessage, null);
  assert.equal(calls, 2);
});

test('quota RPC failure before provider invocation defers, releases, and permits a same-key retry', async () => {
  const repository = new MemoryDispatchRepository();
  const draft = readyDraft();
  const metadata = metadataFor(draft, 'key:quota-rpc-unavailable');
  let quotaAttempts = 0;
  let providerNetworkCalls = 0;
  const provider: OutboundMessageProvider = {
    async send() {
      quotaAttempts += 1;
      if (quotaAttempts === 1) {
        try {
          throw new Error('quota RPC response was lost');
        } catch (error) {
          throw new OutboundPreProviderDeferredError(
            'Contact quota could not be reserved. The provider was not invoked.',
            { code: 'quota_reservation_unavailable', retryAfterMs: 15_000, cause: error },
          );
        }
      }
      providerNetworkCalls += 1;
      return { outcome: 'accepted', providerMessageId: 'provider-message-after-quota-retry' };
    },
  };

  const first = await dispatchOutboundMessage({ draft, metadata, provider }, { repository, now });

  assert.equal(first.status, 'deferred');
  assert.equal(first.dispatch.status, 'deferred');
  assert.equal(first.dispatch.errorCode, 'quota_reservation_unavailable');
  assert.notEqual(first.dispatch.errorCode, 'provider_outcome_unknown');
  assert.deepEqual(first.retry, {
    retryable: true,
    phase: 'pre_provider',
    code: 'quota_reservation_unavailable',
    retryAt: '2026-08-13T09:30:15.000Z',
    retryAfterMs: 15_000,
  });
  assert.equal(providerNetworkCalls, 0);
  assert.equal(repository.releasedQuota, 1);

  const retry = await dispatchOutboundMessage({ draft, metadata, provider }, { repository, now });

  assert.equal(retry.status, 'sent');
  assert.equal(retry.replayed, false);
  assert.equal(retry.dispatch.attemptCount, 2);
  assert.equal(retry.dispatch.errorCode, null);
  assert.equal(quotaAttempts, 2);
  assert.equal(providerNetworkCalls, 1);
  assert.equal(repository.releasedQuota, 1);
});

test('concurrent retries of a deferred dispatch make one later provider call', async () => {
  const repository = new MemoryDispatchRepository();
  const draft = readyDraft();
  const metadata = metadataFor(draft, 'key:quota-concurrent-retry');
  const deferredProvider = countingProvider({
    outcome: 'deferred',
    code: 'daily_quota_exceeded',
    message: 'Daily quota exceeded',
  });
  await dispatchOutboundMessage({ draft, metadata, provider: deferredProvider.provider }, { repository, now });

  let retryCalls = 0;
  let releaseProvider!: () => void;
  const held = new Promise<void>((resolve) => { releaseProvider = resolve; });
  const retryProvider: OutboundMessageProvider = {
    async send() {
      retryCalls += 1;
      await held;
      return { outcome: 'accepted', providerMessageId: 'provider-message-retry' };
    },
  };

  const firstRetryPromise = dispatchOutboundMessage({ draft, metadata, provider: retryProvider }, { repository, now });
  await Promise.resolve();
  await Promise.resolve();
  const concurrentRetry = await dispatchOutboundMessage({ draft, metadata, provider: retryProvider }, { repository, now });
  releaseProvider();
  const firstRetry = await firstRetryPromise;

  assert.equal(retryCalls, 1);
  assert.equal(concurrentRetry.status, 'sending');
  assert.equal(concurrentRetry.replayed, true);
  assert.equal(firstRetry.status, 'sent');
});

test('quota release failure preserves a confirmed failed send result and is reported', async () => {
  const repository = new MemoryDispatchRepository();
  repository.failReleaseQuota = true;
  const provider = countingProvider({ outcome: 'rejected', code: 'invalid_recipient', message: 'Recipient rejected' });
  const draft = readyDraft();
  const metadata = metadataFor(draft, 'key:release-failure');
  const originalConsoleError = console.error;
  const reports: unknown[][] = [];
  console.error = (...args: unknown[]) => { reports.push(args); };

  try {
    const result = await dispatchOutboundMessage({ draft, metadata, provider: provider.provider }, { repository, now });
    assert.equal(result.status, 'failed');
    assert.equal(result.dispatch.errorCode, 'invalid_recipient');
    assert.equal(provider.calls(), 1);
    assert.equal(reports.length, 1);
    assert.match(String(reports[0][0]), /failed to release quota reservation/);
  } finally {
    console.error = originalConsoleError;
  }
});

test('network ambiguity becomes unknown and is never resent', async () => {
  const repository = new MemoryDispatchRepository();
  let calls = 0;
  const provider: OutboundMessageProvider = {
    async send() {
      calls += 1;
      throw new Error('socket timed out after request write');
    },
  };
  const draft = readyDraft();
  const metadata = metadataFor(draft);

  const first = await dispatchOutboundMessage({ draft, metadata, provider }, { repository, now });
  const replay = await dispatchOutboundMessage({ draft, metadata, provider }, { repository, now });

  assert.equal(first.status, 'unknown');
  assert.equal(first.dispatch.errorCode, 'provider_outcome_unknown');
  assert.equal(first.retry, undefined);
  assert.equal(replay.status, 'unknown');
  assert.equal(calls, 1);
  assert.equal(repository.releasedQuota, 0);
});

test('lost sent persistence acknowledgement becomes unknown without another provider call', async () => {
  const repository = new MemoryDispatchRepository();
  repository.failMarkSent = true;
  const provider = countingProvider();
  const draft = readyDraft();
  const metadata = metadataFor(draft);

  const result = await dispatchOutboundMessage({ draft, metadata, provider: provider.provider }, { repository, now });
  const replay = await dispatchOutboundMessage({ draft, metadata, provider: provider.provider }, { repository, now });

  assert.equal(result.status, 'unknown');
  assert.equal(replay.status, 'unknown');
  assert.equal(provider.calls(), 1);
});

test('an accepted response without a provider message ID is unknown and is never resent', async () => {
  const repository = new MemoryDispatchRepository();
  const provider = countingProvider({ outcome: 'accepted', providerMessageId: '   ' });
  const draft = readyDraft();
  const metadata = metadataFor(draft);

  const first = await dispatchOutboundMessage({ draft, metadata, provider: provider.provider }, { repository, now });
  const replay = await dispatchOutboundMessage({ draft, metadata, provider: provider.provider }, { repository, now });

  assert.equal(first.status, 'unknown');
  assert.ok(first.dispatch);
  assert.equal(first.dispatch.errorCode, 'invalid_provider_response');
  assert.equal(replay.status, 'unknown');
  assert.equal(provider.calls(), 1);
});

test('pending insert persistence ambiguity is unknown and never reaches the provider', async () => {
  const repository = new MemoryDispatchRepository();
  repository.createPending = async () => {
    throw new Error('connection lost while inserting pending dispatch');
  };
  const provider = countingProvider();
  const draft = readyDraft();
  const metadata = metadataFor(draft);

  const result = await dispatchOutboundMessage({ draft, metadata, provider: provider.provider }, { repository, now });

  assert.equal(result.status, 'unknown');
  assert.equal(result.dispatch.errorCode, 'persistence_ambiguity');
  assert.match(result.dispatch.id, /^unconfirmed:/);
  assert.equal(provider.calls(), 0);
});

test('pending, sending, and unknown duplicate states never call the provider', async () => {
  for (const status of ['pending', 'sending', 'unknown'] as const) {
    const repository = new MemoryDispatchRepository();
    const provider = countingProvider();
    const draft = readyDraft();
    const metadata = metadataFor(draft, `key:${status}`);
    await repository.seed(metadata, status);

    const result = await dispatchOutboundMessage({ draft, metadata, provider: provider.provider }, { repository, now });

    assert.equal(result.status, status);
    assert.equal(result.replayed, true);
    assert.equal(provider.calls(), 0);
  }
});

test('reconciliation promotes an unknown dispatch only with provider evidence', async () => {
  const repository = new MemoryDispatchRepository();
  const draft = readyDraft();
  const metadata = metadataFor(draft, 'key:reconcile-sent');
  const dispatch = await repository.seed(metadata, 'unknown');
  dispatch.reconciliationClaimedAt = now();
  const updates: any[] = [];
  const client = {
    from() {
      return {
        update(patch: any) {
          updates.push(patch);
          return {
            eq() { return this; },
            select() { return this; },
            async maybeSingle() {
              return {
                data: {
                  id: dispatch.id,
                  organization_id: dispatch.organizationId,
                  user_id: dispatch.userId,
                  draft_id: dispatch.draftId,
                  version_id: dispatch.versionId,
                  idempotency_key: dispatch.idempotencyKey,
                  content_hash: dispatch.contentHash,
                  channel: dispatch.channel,
                  provider: dispatch.provider,
                  status: patch.status,
                  metadata: dispatch.metadata,
                  provider_message_id: patch.provider_message_id,
                  provider_response: patch.provider_response,
                  error_code: patch.error_code,
                  error_message: patch.error_message,
                  created_at: dispatch.createdAt,
                  updated_at: patch.updated_at,
                  started_at: dispatch.startedAt,
                  completed_at: patch.completed_at,
                 reconciliation_attempt_count: patch.reconciliation_attempt_count,
                 last_reconciliation_at: patch.last_reconciliation_at,
                  reconciliation_claimed_at: patch.reconciliation_claimed_at,
                  reconciled_at: patch.reconciled_at,
                  reconciliation_details: patch.reconciliation_details,
                },
                error: null,
              };
            },
          };
        },
      };
    },
  } as any;

  const result = await reconcileUnknownOutboundDispatch(dispatch, {
    async reconcile() {
      return { outcome: 'sent', providerMessageId: 'provider-reconciled-1', details: { exactMatch: true } };
    },
  }, { client, now });

  assert.equal(result.reconciled, true);
  assert.equal(result.dispatch.status, 'sent');
  assert.equal(result.dispatch.providerMessageId, 'provider-reconciled-1');
  assert.equal(updates.length, 1);
});

test('unresolved reconciliation keeps unknown blocked from resend', async () => {
  const repository = new MemoryDispatchRepository();
  const draft = readyDraft();
  const metadata = metadataFor(draft, 'key:reconcile-unresolved');
  const dispatch = await repository.seed(metadata, 'unknown');
  dispatch.reconciliationClaimedAt = now();
  const client = {
    from() {
      return {
        update(patch: any) {
          return {
            eq() { return this; },
            select() { return this; },
            async maybeSingle() {
              return {
                data: {
                  id: dispatch.id,
                  organization_id: dispatch.organizationId,
                  user_id: dispatch.userId,
                  draft_id: dispatch.draftId,
                  version_id: dispatch.versionId,
                  idempotency_key: dispatch.idempotencyKey,
                  content_hash: dispatch.contentHash,
                  channel: dispatch.channel,
                  provider: dispatch.provider,
                  status: 'unknown',
                  metadata: dispatch.metadata,
                  provider_message_id: null,
                  provider_response: null,
                  error_code: dispatch.errorCode,
                  error_message: dispatch.errorMessage,
                  created_at: dispatch.createdAt,
                  updated_at: patch.updated_at,
                  started_at: dispatch.startedAt,
                  completed_at: dispatch.completedAt,
                 reconciliation_attempt_count: patch.reconciliation_attempt_count,
                 last_reconciliation_at: patch.last_reconciliation_at,
                  reconciliation_claimed_at: patch.reconciliation_claimed_at,
                  reconciled_at: null,
                  reconciliation_details: patch.reconciliation_details,
                },
                error: null,
              };
            },
          };
        },
      };
    },
  } as any;

  const result = await reconcileUnknownOutboundDispatch(dispatch, {
    async reconcile() { return { outcome: 'unresolved', details: { matchingSentMessages: 0 } }; },
  }, { client, now });

  assert.equal(result.reconciled, false);
  assert.equal(result.dispatch.status, 'unknown');
});

test('failed reconciliation releases quota only after guarded persistence succeeds', async () => {
  const repository = new MemoryDispatchRepository();
  const draft = readyDraft();
  const metadata = metadataFor(draft, 'key:reconcile-failed');
  const dispatch = await repository.seed(metadata, 'unknown');
  dispatch.reconciliationClaimedAt = now();
  const rpcCalls: string[] = [];
  const client = {
    from() {
      return {
        update(patch: any) {
          return {
            eq() { return this; },
            select() { return this; },
            async maybeSingle() {
              return {
                data: {
                  id: dispatch.id,
                  organization_id: dispatch.organizationId,
                  user_id: dispatch.userId,
                  draft_id: dispatch.draftId,
                  version_id: dispatch.versionId,
                  idempotency_key: dispatch.idempotencyKey,
                  content_hash: dispatch.contentHash,
                  channel: dispatch.channel,
                  provider: dispatch.provider,
                  status: patch.status,
                  metadata: dispatch.metadata,
                  provider_message_id: null,
                  provider_response: patch.provider_response,
                  error_code: patch.error_code,
                  error_message: patch.error_message,
                  created_at: dispatch.createdAt,
                  updated_at: patch.updated_at,
                  started_at: patch.started_at,
                  completed_at: patch.completed_at,
                  reconciliation_attempt_count: patch.reconciliation_attempt_count,
                  last_reconciliation_at: patch.last_reconciliation_at,
                  reconciliation_claimed_at: patch.reconciliation_claimed_at,
                  reconciled_at: patch.reconciled_at,
                  reconciliation_details: patch.reconciliation_details,
                },
                error: null,
              };
            },
          };
        },
      };
    },
    async rpc(name: string) {
      rpcCalls.push(name);
      return { data: true, error: null };
    },
  } as any;

  const result = await reconcileUnknownOutboundDispatch(dispatch, {
    async reconcile() {
      return { outcome: 'failed', code: 'not_delivered', message: 'Provider confirms no delivery' };
    },
  }, { client, now });

  assert.equal(result.reconciled, true);
  assert.equal(result.dispatch.status, 'failed');
  assert.deepEqual(rpcCalls, ['release_outbound_contact_quota_v1']);
});

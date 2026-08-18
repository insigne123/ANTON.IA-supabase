import assert from 'node:assert/strict';
import test from 'node:test';

import type { OutboundDispatch } from './outbound-dispatch';
import { repairReconciledSentDispatchHistory } from './outbound-reconciliation-history';

const dispatch: OutboundDispatch = {
  id: '10000000-0000-4000-8000-000000000001',
  organizationId: '40000000-0000-4000-8000-000000000001',
  userId: '50000000-0000-4000-8000-000000000001',
  draftId: '20000000-0000-4000-8000-000000000001',
  versionId: '30000000-0000-4000-8000-000000000001',
  idempotencyKey: 'manual:ada',
  contentHash: 'a'.repeat(64),
  channel: 'email',
  provider: 'gmail',
  status: 'sent',
  metadata: {
    schemaVersion: 1,
    organizationId: '40000000-0000-4000-8000-000000000001',
    userId: '50000000-0000-4000-8000-000000000001',
    draftId: '20000000-0000-4000-8000-000000000001',
    versionId: '30000000-0000-4000-8000-000000000001',
    revision: 1,
    channel: 'email',
    recipient: { leadRef: null, displayName: 'Ada', email: 'Ada@Example.com', linkedinUrl: null },
    contentHash: 'a'.repeat(64),
    idempotencyKey: 'manual:ada',
    provider: 'gmail',
    requestedAt: '2026-08-13T09:00:00.000Z',
  },
  providerMessageId: 'message-1',
  providerResponse: { id: 'message-1' },
  errorCode: null,
  errorMessage: null,
  createdAt: '2026-08-13T09:00:00.000Z',
  updatedAt: '2026-08-13T09:05:00.000Z',
  startedAt: '2026-08-13T09:00:00.000Z',
  completedAt: '2026-08-13T09:05:00.000Z',
  reconciledAt: '2026-08-13T09:06:00.000Z',
  reconciliationDetails: {},
};

test('history repair delegates the recipient write and bookkeeping to one RPC transaction', async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const admin = {
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      return {
        data: {
          repaired: true,
          finalized: true,
          contactedId: 'contacted-1',
          eventId: 'event-1',
          leadUpdated: true,
          campaignUpdated: false,
        },
        error: null,
      };
    },
  };

  const result = await repairReconciledSentDispatchHistory({
    admin,
    dispatch,
    draftVersion: { recipient: { email: 'ada@example.com' } },
  });

  assert.deepEqual(calls, [{
    name: 'repair_reconciled_sent_dispatch_history_v1',
    args: { p_dispatch_id: dispatch.id },
  }]);
  assert.deepEqual(result, {
    repaired: true,
    reason: undefined,
    finalized: true,
    contactedId: 'contacted-1',
    eventId: 'event-1',
    leadUpdated: true,
    campaignUpdated: false,
  });
});

test('deletion or global suppression wins as a finalized repair skip', async () => {
  for (const reason of ['dispatch_missing', 'globally_suppressed']) {
    const admin = {
      async rpc() {
        return { data: { repaired: false, finalized: true, reason }, error: null };
      },
    };
    const result = await repairReconciledSentDispatchHistory({ admin, dispatch, draftVersion: {} });
    assert.deepEqual(result, {
      repaired: false,
      reason,
      finalized: true,
      contactedId: undefined,
      eventId: undefined,
      leadUpdated: false,
      campaignUpdated: false,
    });
  }
});

test('metadata and immutable version recipient mismatch is rejected before repair', async () => {
  const admin = { rpc() { throw new Error('RPC must not run'); } };
  await assert.rejects(
    repairReconciledSentDispatchHistory({
      admin,
      dispatch,
      draftVersion: { recipient: { email: 'other@example.com' } },
    }),
    /Draft recipient does not match reconciled dispatch metadata/,
  );
});

test('failed or deferred dispatches never invoke the repair RPC', async () => {
  const admin = { rpc() { throw new Error('RPC must not run'); } };
  for (const status of ['failed', 'deferred'] as const) {
    const result = await repairReconciledSentDispatchHistory({
      admin,
      dispatch: { ...dispatch, status },
      draftVersion: {},
    });
    assert.deepEqual(result, { repaired: false, reason: 'not_reconciled_sent' });
  }
});

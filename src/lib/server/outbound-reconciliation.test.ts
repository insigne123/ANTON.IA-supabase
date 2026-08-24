import assert from 'node:assert/strict';
import test from 'node:test';

import { repairReconciledOutboundDispatchHistories } from './outbound-reconciliation';

type Row = Record<string, any>;

class Query implements PromiseLike<{ data: any; error: any }> {
  private readonly filters: Array<(row: Row) => boolean> = [];
  private updatePayload: Row | null = null;
  private limitCount: number | null = null;

  constructor(private readonly rows: Row[]) {}
  select() { return this; }
  order() { return this; }
  limit(value: number) { this.limitCount = value; return this; }
  eq(key: string, value: unknown) { this.filters.push((row) => row[key] === value); return this; }
  in(key: string, values: unknown[]) { this.filters.push((row) => values.includes(row[key])); return this; }
  not(key: string, operator: string, value: unknown) {
    if (operator === 'is' && value === null) this.filters.push((row) => row[key] !== null && row[key] !== undefined);
    return this;
  }
  update(payload: Row) { this.updatePayload = payload; return this; }
  async maybeSingle() {
    const matches = this.matches();
    if (this.updatePayload) matches.forEach((row) => Object.assign(row, structuredClone(this.updatePayload)));
    return { data: matches[0] || null, error: null };
  }
  then<TResult1 = { data: any; error: any }, TResult2 = never>(
    onfulfilled?: ((value: { data: any; error: any }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve({ data: this.matches(), error: null }).then(onfulfilled, onrejected);
  }
  private matches() {
    const rows = this.rows.filter((row) => this.filters.every((filter) => filter(row)));
    return this.limitCount === null ? rows : rows.slice(0, this.limitCount);
  }
}

function dispatchRow(id: string) {
  return {
    id,
    organization_id: '40000000-0000-4000-8000-000000000001',
    user_id: '50000000-0000-4000-8000-000000000001',
    draft_id: `20000000-0000-4000-8000-00000000000${id}`,
    version_id: `30000000-0000-4000-8000-00000000000${id}`,
    idempotency_key: `test:${id}`,
    content_hash: 'a'.repeat(64),
    channel: 'email',
    provider: 'gmail',
    status: 'sent',
    metadata: {
      schemaVersion: 1,
      organizationId: '40000000-0000-4000-8000-000000000001',
      userId: '50000000-0000-4000-8000-000000000001',
      draftId: `20000000-0000-4000-8000-00000000000${id}`,
      versionId: `30000000-0000-4000-8000-00000000000${id}`,
      revision: 1,
      channel: 'email',
      recipient: { leadRef: null, displayName: null, email: `${id}@example.com`, linkedinUrl: null },
      contentHash: 'a'.repeat(64),
      idempotencyKey: `test:${id}`,
      provider: 'gmail',
      requestedAt: '2026-08-13T09:00:00.000Z',
    },
    provider_message_id: `message-${id}`,
    provider_response: { id: `message-${id}` },
    error_code: null,
    error_message: null,
    created_at: '2026-08-13T09:00:00.000Z',
    updated_at: '2026-08-13T09:05:00.000Z',
    started_at: '2026-08-13T09:00:00.000Z',
    completed_at: '2026-08-13T09:05:00.000Z',
    reconciliation_attempt_count: 1,
    reconciliation_claimed_at: null,
    reconciled_at: '2026-08-13T09:06:00.000Z',
    reconciliation_details: {},
    history_repair_status: 'pending',
    history_repair_attempt_count: 0,
    last_history_repair_at: null,
    history_repair_error: null,
  };
}

test('history repair records row failures and continues repairing later dispatches', async () => {
  const dispatches = [dispatchRow('1'), dispatchRow('2')];
  const versions = dispatches.map((dispatch) => ({
    organization_id: dispatch.organization_id,
    user_id: dispatch.user_id,
    draft_id: dispatch.draft_id,
    id: dispatch.version_id,
    recipient: dispatch.metadata.recipient,
    content: { subject: 'Hello', text: 'Body', html: null },
  }));
  const admin = {
    from(table: string) {
      return new Query(table === 'outbound_dispatches' ? dispatches : versions);
    },
  };
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    const result = await repairReconciledOutboundDispatchHistories({
      client: admin,
      now: () => '2026-08-13T10:00:00.000Z',
      repair: async ({ dispatch }) => {
        if (dispatch.id === '1') throw new Error('contacted history unavailable');
        const persisted = dispatches.find((item) => item.id === dispatch.id)!;
        persisted.history_repair_status = 'complete';
        persisted.history_repair_attempt_count += 1;
        persisted.history_repair_error = null;
        return { repaired: true, finalized: true, contactedId: 'contacted-2' };
      },
    });

    assert.equal(result.processed, 2);
    assert.equal(result.repaired, 1);
    assert.equal(result.failed, 1);
    assert.equal(dispatches[0].status, 'sent');
    assert.equal(dispatches[0].history_repair_status, 'failed');
    assert.equal(dispatches[0].history_repair_attempt_count, 1);
    assert.equal(dispatches[0].history_repair_error, 'contacted history unavailable');
    assert.equal(dispatches[1].status, 'sent');
    assert.equal(dispatches[1].history_repair_status, 'complete');
    assert.equal(dispatches[1].history_repair_attempt_count, 1);

    const retry = await repairReconciledOutboundDispatchHistories({
      client: admin,
      now: () => '2026-08-13T10:05:00.000Z',
      repair: async ({ dispatch }) => {
        const persisted = dispatches.find((item) => item.id === dispatch.id)!;
        persisted.history_repair_status = 'complete';
        persisted.history_repair_attempt_count += 1;
        persisted.history_repair_error = null;
        return { repaired: true, finalized: true, contactedId: 'contacted-1' };
      },
    });
    assert.equal(retry.processed, 1);
    assert.equal(retry.repaired, 1);
    assert.equal(dispatches[0].history_repair_status, 'complete');
    assert.equal(dispatches[0].history_repair_attempt_count, 2);
    assert.equal(dispatches[0].history_repair_error, null);
  } finally {
    console.error = originalConsoleError;
  }
});

test('completed repairs are not selected on the next cron retry', async () => {
  const dispatches = [dispatchRow('1')];
  const versions = [{
    organization_id: dispatches[0].organization_id,
    user_id: dispatches[0].user_id,
    draft_id: dispatches[0].draft_id,
    id: dispatches[0].version_id,
    recipient: dispatches[0].metadata.recipient,
    content: { subject: 'Hello', text: 'Body', html: null },
  }];
  const admin = { from: (table: string) => new Query(table === 'outbound_dispatches' ? dispatches : versions) };
  let repairs = 0;
  const repair = async ({ dispatch }: { dispatch: { id: string } }) => {
    repairs += 1;
    const persisted = dispatches.find((item) => item.id === dispatch.id)!;
    persisted.history_repair_status = 'complete';
    persisted.history_repair_attempt_count += 1;
    persisted.history_repair_error = null;
    return { repaired: true, finalized: true };
  };

  await repairReconciledOutboundDispatchHistories({ client: admin, repair });
  const replay = await repairReconciledOutboundDispatchHistories({ client: admin, repair });

  assert.equal(repairs, 1);
  assert.equal(replay.processed, 0);
});

test('direct provider-confirmed sent dispatches are selected for fallback history projection', async () => {
  const dispatch = { ...dispatchRow('3'), reconciled_at: null };
  const admin = { from: () => new Query([dispatch]) };
  let repairs = 0;

  const result = await repairReconciledOutboundDispatchHistories({
    client: admin,
    repair: async () => {
      repairs += 1;
      return { repaired: true, finalized: true };
    },
  });

  assert.equal(repairs, 1);
  assert.equal(result.processed, 1);
  assert.equal(result.repaired, 1);
});

test('a finalized privacy skip is not treated as a failure or retried', async () => {
  const dispatches = [dispatchRow('1')];
  const admin = { from: () => new Query(dispatches) };

  const result = await repairReconciledOutboundDispatchHistories({
    client: admin,
    repair: async () => ({ repaired: false, finalized: true, reason: 'globally_suppressed' }),
  });

  assert.equal(result.repaired, 0);
  assert.equal(result.skipped, 1);
  assert.equal(result.failed, 0);
  assert.equal(result.results[0].reason, 'globally_suppressed');
});

test('an unfinalized history result stays repairable instead of being marked complete', async () => {
  const dispatches = [dispatchRow('1')];
  const admin = { from: () => new Query(dispatches) };
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    const result = await repairReconciledOutboundDispatchHistories({
      client: admin,
      repair: async () => ({ repaired: true, finalized: false }),
    });

    assert.equal(result.failed, 1);
    assert.equal(dispatches[0].history_repair_status, 'failed');
    assert.notEqual(dispatches[0].history_repair_status, 'complete');
  } finally {
    console.error = originalConsoleError;
  }
});

test('bookkeeping compare-and-set misses are surfaced', async () => {
  const dispatches = [dispatchRow('1')];
  const admin = {
    from(table: string) {
      if (table !== 'outbound_dispatches') return new Query([]);
      const query = new Query(dispatches);
      const originalUpdate = query.update.bind(query);
      query.update = (payload: Row) => {
        originalUpdate(payload);
        dispatches[0].history_repair_attempt_count += 1;
        return query;
      };
      return query;
    },
  };
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    await assert.rejects(
      repairReconciledOutboundDispatchHistories({
        client: admin,
          repair: async () => { throw new Error('history RPC unavailable'); },
      }),
      /History repair bookkeeping CAS failed/,
    );
  } finally {
    console.error = originalConsoleError;
  }
});

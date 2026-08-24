import assert from 'node:assert/strict';
import test from 'node:test';

import { finalizeSentOutboundDispatchHistory } from './outbound-history-projection';

test('sent history projection delegates to the service-role finalizer RPC', async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = {
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      return {
        data: {
          repaired: true,
          finalized: true,
          contactedId: 'contacted-1',
          eventId: 'event-1',
        },
        error: null,
      };
    },
  };

  const result = await finalizeSentOutboundDispatchHistory('dispatch-1', client);

  assert.deepEqual(calls, [{
    name: 'finalize_sent_outbound_dispatch_history_v1',
    args: { p_dispatch_id: 'dispatch-1' },
  }]);
  assert.deepEqual(result, {
    repaired: true,
    finalized: true,
    reason: undefined,
    contactedId: 'contacted-1',
    eventId: 'event-1',
  });
});

test('sent history projection rejects incomplete finalizer results', async () => {
  await assert.rejects(
    finalizeSentOutboundDispatchHistory('dispatch-1', {
      async rpc() {
        return { data: { repaired: false, finalized: false }, error: null };
      },
    }),
    /finalizer returned an invalid result/,
  );
});

test('sent history projection accepts an idempotent already-complete replay', async () => {
  const calls: string[] = [];
  const client = {
    async rpc(name: string) {
      calls.push(name);
      return { data: { repaired: false, finalized: true, reason: 'already_complete' }, error: null };
    },
  };

  const replay = await finalizeSentOutboundDispatchHistory('dispatch-1', client);

  assert.deepEqual(calls, ['finalize_sent_outbound_dispatch_history_v1']);
  assert.deepEqual(replay, {
    repaired: false,
    finalized: true,
    reason: 'already_complete',
    contactedId: undefined,
    eventId: undefined,
  });
});

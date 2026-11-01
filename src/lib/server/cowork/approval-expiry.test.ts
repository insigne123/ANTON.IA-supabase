import assert from 'node:assert/strict';
import test from 'node:test';
import { expireStaleCoworkApprovals } from './approval-expiry';
import { coworkExpiredApprovalText, COWORK_APPROVAL_EXPIRY_DAYS } from '@/lib/cowork/approval-expiry-copy';

test('a proposal waiting more than 7 days is stopped with the «Detener» RPC and keeps why (audit C1)', async () => {
  const filters: Array<[string, unknown]> = [];
  const rpcs: unknown[] = [];
  const events: unknown[] = [];
  const client = {
    from: (table: string) => {
      if (table === 'cowork_run_events') return { insert: async (row: unknown) => { events.push(row); return { error: null }; } };
      const chain: any = {
        select: () => chain,
        eq: (column: string, value: unknown) => { filters.push([column, value]); return chain; },
        lt: (column: string, value: unknown) => { filters.push([column, value]); return chain; },
        order: () => chain,
        limit: async () => ({ data: [{ id: 'r1', user_id: 'u1', organization_id: 'o1' }, { id: 'r2', user_id: 'u2', organization_id: 'o1' }], error: null }),
      };
      return chain;
    },
    rpc: async (name: string, args: { p_run_id: string }) => { rpcs.push([name, args]); return { data: args.p_run_id === 'r1', error: null }; },
  };
  const now = new Date('2026-11-10T12:00:00Z');
  const result = await expireStaleCoworkApprovals(client as any, now);
  assert.deepEqual(filters, [['status', 'waiting_approval'], ['updated_at', '2026-11-03T12:00:00.000Z']]);
  assert.equal(rpcs.length, 2);
  assert.equal((rpcs[0] as any)[0], 'cowork_cancel_run');
  assert.equal(result.expired, 1, 'a run the RPC did not stop (it moved meanwhile) is not counted');
  assert.deepEqual(events, [{ run_id: 'r1', user_id: 'u1', organization_id: 'o1', kind: 'approval.expired', payload: { days: COWORK_APPROVAL_EXPIRY_DAYS } }]);
  assert.match(coworkExpiredApprovalText(), /^Venció: pasaron 7 días sin aprobación\./);
});

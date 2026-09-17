import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadCoworkThreadStats } from './thread-stats';

function mockClient(runs: Record<string, { id: string; parent_run_id: string | null; depth: number }>,
    counts: Record<string, number>) {
  return {
    from: (table: string) => {
      if (table === 'cowork_runs') {
        let id = '';
        const chain = {
          select: () => chain,
          eq: (key: string, value: unknown) => {
            if (key === 'id') id = value as string;
            return chain;
          },
          maybeSingle: async () => ({ data: runs[id] || null, error: null }),
        };
        return chain;
      }
      return {
        select: () => ({
          in: () => ({ in: async () => ({ data: Array.from({ length: counts[table] || 0 }, () => ({})), error: null }) }),
        }),
      };
    },
  } as never;
}

const scope = { userId: 'user', organizationId: 'org' };

test('chain stops at the user run and counts durable work', async () => {
  const client = mockClient({
    child: { id: 'child', parent_run_id: 'mid', depth: 2 },
    mid: { id: 'mid', parent_run_id: 'root', depth: 1 },
    root: { id: 'root', parent_run_id: null, depth: 0 },
  }, { cowork_effect_proposals: 2, cowork_search_proposals: 1, cowork_draft_requests: 0 });
  const stats = await loadCoworkThreadStats(client, scope, 'child');
  assert.deepEqual(stats.runIds, ['child', 'mid', 'root']);
  assert.equal(stats.depth, 2);
  assert.equal(stats.effects, 2);
  assert.equal(stats.searches, 1);
  assert.equal(stats.drafts, 0);
});

test('user run alone forms a single-run chain', async () => {
  const client = mockClient({
    root: { id: 'root', parent_run_id: null, depth: 0 },
  }, {});
  const stats = await loadCoworkThreadStats(client, scope, 'root');
  assert.deepEqual(stats.runIds, ['root']);
  assert.equal(stats.depth, 0);
});

test('cycles fail closed', async () => {
  const client = mockClient({
    a: { id: 'a', parent_run_id: 'b', depth: 1 },
    b: { id: 'b', parent_run_id: 'a', depth: 2 },
  }, {});
  await assert.rejects(loadCoworkThreadStats(client, scope, 'a'), /ancestry/);
});

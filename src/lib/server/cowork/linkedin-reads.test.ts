import test from 'node:test';
import assert from 'node:assert/strict';
import { readCoworkLinkedinFollowups, readCoworkLinkedinInbox, readCoworkLinkedinJobs, readCoworkLinkedinNetwork, readCoworkLinkedinQuota } from './linkedin-reads';

const scope = { userId: 'owner', organizationId: 'org' };

function mockClient(rows: Record<string, unknown[]>) {
  return { from(table: string) {
    const chain: Record<string, (...args: any[]) => any> = {
      select() { return chain; },
      eq(key: unknown, value: unknown) { if (key === 'organization_id') assert.equal(value, 'org'); return chain; },
      in() { return chain; },
      gte() { return chain; },
      order() { return chain; },
      limit() { return chain; },
      async maybeSingle() { return { data: (rows[table] || [])[0] || null, error: null }; },
      then(resolve: (value: unknown) => void) { resolve({ data: rows[table] || [], error: null }); },
    };
    return chain;
  } };
}

test('network declares coverage instead of asserting new contacts', async () => {
  const empty = await readCoworkLinkedinNetwork(mockClient({}) as never, scope) as any;
  assert.equal(empty.peers.length, 0);
  assert.equal(empty.coverage.complete, false);
  const full = await readCoworkLinkedinNetwork(mockClient({
    cowork_linkedin_peers: [{ canonical_url: 'https://www.linkedin.com/in/ana', display_name: 'Ana', first_seen: '2026-09-20T12:00:00Z', last_seen: '2026-09-21T12:00:00Z' }],
    cowork_linkedin_sweep_state: [{ last_completed_at: '2026-09-21T12:00:00Z', cursor: null, has_more: false, observed_count: 1, updated_at: '2026-09-21T12:00:00Z' }],
  }) as never, scope) as any;
  assert.equal(full.peers.length, 1);
  assert.equal(full.coverage.complete, true);
});

test('inbox withholds pending counts until the sweep completes', async () => {
  const partial = await readCoworkLinkedinInbox(mockClient({
    cowork_linkedin_threads: [{ thread_key: 't1', display_name: 'Ana', last_direction: 'in', last_at: '2026-09-21T12:00:00Z', reply_needed: true, resolved_at: null }],
    cowork_linkedin_sweep_state: [{ last_completed_at: null, cursor: 'p2', has_more: true, observed_count: 1, updated_at: '2026-09-21T12:00:00Z' }],
  }) as never, scope, '') as any;
  assert.equal(partial.sweepComplete, false);
  assert.equal(partial.pendingCounts, null);
  const done = await readCoworkLinkedinInbox(mockClient({
    cowork_linkedin_threads: [{ thread_key: 't1', display_name: 'Ana', last_direction: 'in', last_at: '2026-09-21T12:00:00Z', reply_needed: true, resolved_at: null }],
    cowork_linkedin_sweep_state: [{ last_completed_at: '2026-09-21T12:00:00Z', cursor: null, has_more: false, observed_count: 1, updated_at: '2026-09-21T12:00:00Z' }],
  }) as never, scope, '') as any;
  assert.equal(done.sweepComplete, true);
  assert.deepEqual(done.pendingCounts, { replyNeeded: 1 });
});

test('quota counts pending invitations against the weekly window', async () => {
  const quota = await readCoworkLinkedinQuota({ from() {
    const chain: Record<string, (...args: any[]) => any> = {
      select(_columns: string, options?: { count?: string; head?: boolean }) {
        (chain as any).counted = options?.count === 'exact';
        return chain;
      },
      eq() { return chain; }, in() { return chain; }, gte() { return chain; },
      order() { return chain; }, limit() { return chain; },
      async maybeSingle() { return { data: null, error: null }; },
      then(resolve: (value: unknown) => void) { resolve({ data: [], error: null, count: 99 }); },
    };
    return chain;
  } } as never, scope) as any;
  assert.equal(quota.limit, 100);
  assert.equal(quota.windowDays, 7);
});

test('jobs separate queued work from confirmed results with expiry', async () => {
  const jobs = await readCoworkLinkedinJobs(mockClient({
    cowork_linkedin_jobs: [
      { id: 'a', kind: 'invite', canonical_url: 'https://www.linkedin.com/in/ana', display_name: 'Ana', status: 'queued', created_at: '2026-09-10T12:00:00Z' },
      { id: 'b', kind: 'message', canonical_url: 'https://www.linkedin.com/in/luis', display_name: 'Luis', status: 'confirmed', created_at: '2026-09-20T12:00:00Z', updated_at: '2026-09-20T12:00:00Z', error: null },
    ],
  }) as never, scope) as any;
  assert.equal(jobs.pending.length, 2);
  assert.equal(jobs.pending[0].expired, true);
  assert.match(jobs.executionNote, /nunca se reintenta solo/);
});

test('followups require cooldown, silence, open stage and new content', async () => {
  const followups = await readCoworkLinkedinFollowups(mockClient({
    cowork_linkedin_jobs: [
      { canonical_url: 'https://www.linkedin.com/in/ana', display_name: 'Ana', status: 'confirmed', created_at: '2026-09-01T12:00:00Z', message: 'Hola Ana' },
      { canonical_url: 'https://www.linkedin.com/in/luis', display_name: 'Luis', status: 'uncertain', created_at: '2026-09-01T12:00:00Z', message: 'Hola Luis' },
      { canonical_url: 'https://www.linkedin.com/in/mia', display_name: 'Mia', status: 'confirmed', created_at: new Date().toISOString(), message: 'Hola Mia' },
    ],
    cowork_linkedin_threads: [
      { canonical_url: 'https://www.linkedin.com/in/mia', last_direction: 'in', last_at: '2026-09-21T12:00:00Z' },
    ],
    unified_crm_data: [{ id: 'x', stage: 'contacted' }],
  }) as never, scope) as any;
  const ana = followups.items.find((item: any) => item.canonicalUrl === 'https://www.linkedin.com/in/ana');
  assert.equal(ana.eligible, true);
  assert.equal(ana.requiresNewInformation, true);
  assert.ok(!followups.items.some((item: any) => item.canonicalUrl === 'https://www.linkedin.com/in/luis'));
  const mia = followups.items.find((item: any) => item.canonicalUrl === 'https://www.linkedin.com/in/mia');
  assert.equal(mia.eligible, false);
  assert.ok(mia.blockedBy.includes('inbound_reply_observed'));
});

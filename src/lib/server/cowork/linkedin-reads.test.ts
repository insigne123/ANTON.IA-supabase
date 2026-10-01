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
      or() { return chain; },
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

/** A client where each table answers its own rows, and head counts answer `count`. */
function tablesClient(rows: Record<string, unknown[]>, count = 0) {
  return { from(table: string) {
    let head = false;
    const chain: Record<string, (...args: any[]) => any> = {
      select(_columns: string, options?: { head?: boolean }) { head = Boolean(options?.head); return chain; },
      eq() { return chain; }, in() { return chain; }, gte() { return chain; }, order() { return chain; }, limit() { return chain; }, or() { return chain; },
      async maybeSingle() { return { data: (rows[table] || [])[0] || null, error: null }; },
      then(resolve: (value: unknown) => void) { resolve(head ? { data: null, error: null, count } : { data: rows[table] || [], error: null }); },
    };
    return chain;
  } };
}

test('quota also says how many invitations sent from the app still wait for an answer, and what it cannot see', async () => {
  const jobs = [{ canonical_url: 'https://www.linkedin.com/in/ana' }, { canonical_url: 'https://www.linkedin.com/in/luis' }, { canonical_url: 'https://www.linkedin.com/in/mia' },
    { canonical_url: 'https://www.linkedin.com/in/ana' }];
  const synced = await readCoworkLinkedinQuota(tablesClient({
    cowork_linkedin_jobs: jobs, cowork_linkedin_peers: [{ canonical_url: 'https://www.linkedin.com/in/mia' }],
    cowork_linkedin_sweep_state: [{ last_completed_at: '2026-09-21T12:00:00Z', cursor: null, has_more: false, observed_count: 1, updated_at: '2026-09-21T12:00:00Z' }],
  }, 5) as never, scope) as any;
  assert.equal(synced.awaitingAcceptance.sentFromApp, 3, 'the same person invited twice counts once');
  assert.equal(synced.awaitingAcceptance.count, 2, 'Mia already accepted');
  assert.equal(synced.awaitingAcceptance.networkSynced, true);
  assert.match(synced.limitation, /directo en LinkedIn/);
  const unsynced = await readCoworkLinkedinQuota(tablesClient({ cowork_linkedin_jobs: jobs }, 5) as never, scope) as any;
  assert.equal(unsynced.awaitingAcceptance.networkSynced, false);
  assert.match(unsynced.awaitingAcceptance.basis, /falta sincronizar/);
  assert.equal(unsynced.pending, 5, 'the queue count is unchanged');
});

test('follow-up candidates carry the company of the saved contact with that profile, or null', async () => {
  const followups = await readCoworkLinkedinFollowups(mockClient({
    cowork_linkedin_jobs: [
      { canonical_url: 'https://www.linkedin.com/in/ana-rojas', display_name: 'Ana', status: 'confirmed', created_at: '2026-09-01T12:00:00Z', message: 'Hola Ana' },
      { canonical_url: 'https://www.linkedin.com/in/luis-paz', display_name: 'Luis', status: 'confirmed', created_at: '2026-09-01T12:00:00Z', message: 'Hola Luis' },
    ],
    leads: [{ company: ' Adecco ', linkedin_url: 'http://linkedin.com/in/Ana-Rojas/' }, { company: null, linkedin_url: 'https://www.linkedin.com/in/otra-persona' }],
    unified_crm_data: [{ id: 'x', stage: 'contacted' }],
  }) as never, scope) as any;
  const byUrl = (url: string) => followups.items.find((item: any) => item.canonicalUrl === url);
  assert.equal(byUrl('https://www.linkedin.com/in/ana-rojas').company, 'Adecco');
  assert.equal(byUrl('https://www.linkedin.com/in/luis-paz').company, null, 'no saved contact, no company: never a guess');
});

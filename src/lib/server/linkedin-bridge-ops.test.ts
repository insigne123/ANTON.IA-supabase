import test from 'node:test';
import assert from 'node:assert/strict';
import { claimLinkedinJob, finishLinkedinJob, listPendingLinkedinJobs, reportLinkedinInbox, reportLinkedinNetwork } from './linkedin-bridge-ops';

const scope = { organizationId: 'org', userId: 'owner' };

type State = {
  jobs: Array<{ id: string; kind?: string; canonical_url?: string; status: string; claim_token?: string | null; created_at: string }>;
  updateResult?: { data: unknown; error: unknown } | null;
  upserts: Array<{ table: string; values: unknown }>;
};

function fakeDb(state: State) {
  const chainFor = (table: string): Record<string, (...args: any[]) => any> => {
    const filters: Array<[string, unknown]> = [];
    const chain: Record<string, (...args: any[]) => any> = {
      select() { return chain; },
      eq(column: string, value: unknown) { filters.push([column, value]); return chain; },
      in() { return chain; },
      order() { return chain; },
      limit() { return chain; },
      update(values: unknown) {
        const apply = () => {
          const rows = state.jobs.filter(row => filters.every(([column, value]) => (row as any)[column] === value));
          rows.forEach(row => Object.assign(row, values));
          return { data: rows[0] ? { ...rows[0] } : null, error: null };
        };
        const tail: Record<string, (...args: any[]) => any> = {
          eq(column: string, value: unknown) { filters.push([column, value]); return tail; },
          select() { return { maybeSingle: async () => apply() }; },
          then(resolve: (value: unknown) => void) { apply(); resolve({ error: null }); },
        };
        return tail;
      },
      upsert(values: unknown) {
        state.upserts.push({ table, values });
        return { error: null,
          select: () => ({ maybeSingle: async () => ({ data: { kind: 'network' }, error: null }) }),
          then(resolve: (value: unknown) => void) { resolve({ error: null }); } };
      },
      async maybeSingle() {
        if (table === 'cowork_linkedin_jobs') {
          const rows = state.jobs.filter(row => filters.every(([column, value]) => (row as any)[column] === value));
          return { data: rows[0] ? { ...rows[0] } : null, error: null };
        }
        return { data: null, error: null };
      },
      then(resolve: (value: unknown) => void) {
        if (table === 'cowork_linkedin_jobs') resolve({ data: state.jobs.map(row => ({ ...row })), error: null });
        else resolve({ data: [], error: null });
      },
    };
    return chain;
  };
  return { from: (table: string) => chainFor(table) };
}

const JOB_A = '11111111-1111-4111-8111-111111111111';
const JOB_B = '22222222-2222-4222-8222-222222222222';
const JOB_C = '33333333-3333-4333-8333-333333333333';

function owned<T extends object>(row: T) {
  return { organization_id: 'org', user_id: 'owner', ...row };
}

test('pending list flags expired jobs without claiming them', async () => {
  const state: State = { jobs: [
    owned({ id: JOB_A, kind: 'message', canonical_url: 'https://www.linkedin.com/in/ana', status: 'queued', created_at: '2026-09-10T12:00:00Z' }),
    owned({ id: JOB_B, kind: 'invite', canonical_url: 'https://www.linkedin.com/in/luis', status: 'queued', created_at: new Date().toISOString() }),
  ], upserts: [] };
  const jobs = await listPendingLinkedinJobs(scope, null, fakeDb(state) as never);
  assert.equal(jobs.length, 2);
  assert.equal(jobs[0].expired, true);
  assert.equal(jobs[1].expired, false);
  assert.equal(state.jobs[0].status, 'queued');
});

test('claim refuses expired, taken and missing jobs', async () => {
  const state: State = { jobs: [
    owned({ id: JOB_A, status: 'queued', created_at: '2026-09-10T12:00:00Z' }),
    owned({ id: JOB_B, status: 'claimed', created_at: new Date().toISOString() }),
  ], upserts: [] };
  const client = fakeDb(state) as never;
  await assert.rejects(claimLinkedinJob(scope, JOB_A, client), /venció/);
  assert.equal(state.jobs[0].status, 'expired');
  await assert.rejects(claimLinkedinJob(scope, JOB_B, client), /ya está/);
  await assert.rejects(claimLinkedinJob(scope, JOB_C, client), /ya no está/);
});

test('claim assigns a token to a fresh queued job', async () => {
  const state: State = { jobs: [owned({ id: JOB_C, status: 'queued', created_at: new Date().toISOString() })], upserts: [] };
  const job = await claimLinkedinJob(scope, JOB_C, fakeDb(state) as never) as { status: string; claim_token: string };
  assert.equal(job.status, 'claimed');
  assert.match(job.claim_token, /^[0-9a-f-]{36}$/);
});

test('finish validates claim and requires event id for confirmed messages', async () => {
  const state: State = { jobs: [
    owned({ id: JOB_A, kind: 'message', status: 'claimed', claim_token: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', created_at: new Date().toISOString() }),
    owned({ id: JOB_B, kind: 'invite', status: 'claimed', claim_token: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', created_at: new Date().toISOString() }),
  ], upserts: [] };
  const client = fakeDb(state) as never;
  await assert.rejects(finishLinkedinJob(scope, { jobId: JOB_A, claimToken: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', status: 'confirmed' }, client), /identificador/);
  await assert.rejects(finishLinkedinJob(scope, { jobId: JOB_A, claimToken: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', status: 'uncertain' }, client), /reclamo/);
  await assert.rejects(finishLinkedinJob(scope, { jobId: JOB_A, claimToken: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', status: 'confirmed', threadUrl: 'https://evil.com/x' }, client), /hilo inválida/);
  const done = await finishLinkedinJob(scope,
    { jobId: JOB_A, claimToken: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', status: 'confirmed', eventId: 'urn:1', threadUrl: 'https://www.linkedin.com/messaging/thread/2-x/' }, client) as { status: string };
  assert.equal(done.status, 'confirmed');
  const invite = await finishLinkedinJob(scope, { jobId: JOB_B, claimToken: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', status: 'confirmed' }, client) as { status: string };
  assert.equal(invite.status, 'confirmed');
});

test('network and inbox reports bound their inputs and persist sweep state', async () => {
  const state: State = { jobs: [], upserts: [] };
  const client = fakeDb(state) as never;
  await assert.rejects(reportLinkedinNetwork(scope, { entries: Array.from({ length: 201 }, () => ({ url: 'https://www.linkedin.com/in/a', name: '' })) }, client));
  const network = await reportLinkedinNetwork(scope,
    { entries: [{ url: 'https://www.linkedin.com/in/ana/', name: 'Ana' }, { url: 'no-url', name: 'X' }], hasMore: false }, client);
  assert.equal(network.observed, 1);
  assert.equal(network.hasMore, false);
  const inbox = await reportLinkedinInbox(scope, { threads: [{ key: 't1', url: '', name: 'Ana', direction: 'in', at: null, snippet: 'Hola', replyNeeded: true }], hasMore: true, cursor: 'p2' }, client);
  assert.equal(inbox.observed, 1);
  assert.ok(state.upserts.some(item => item.table === 'cowork_linkedin_sweep_state'));
});

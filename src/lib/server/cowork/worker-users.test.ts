import assert from 'node:assert/strict';
import test from 'node:test';
import { claimForCoworkUsers, coworkWorkerUserIds, forgetCoworkWorkerUsers } from './worker-users';

const OWNER = '00000000-0000-4000-8000-000000000001';
const QA = '00000000-0000-4000-8000-0000000000aa';

function withEnv<T>(values: Record<string, string | undefined>, run: () => Promise<T>) {
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  for (const [key, value] of Object.entries(values)) if (value === undefined) delete process.env[key];
  return run().finally(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
}

test('the workers take each allowed person\'s work, starting with a different one each minute', () => withEnv({ COWORK_OWNER_USER_ID: OWNER, COWORK_ALLOWED_USER_IDS: QA }, async () => {
  assert.deepEqual(await coworkWorkerUserIds(), [OWNER, QA]);
  const asked: string[] = [];
  const job = await claimForCoworkUsers(async (userId) => { asked.push(userId); return userId === QA ? { id: 'run-qa' } : null; }, 0);
  assert.deepEqual(job, { id: 'run-qa' });
  assert.deepEqual(asked, [OWNER, QA], 'the owner first in an even minute, then the QA account');
  const nextMinute: string[] = [];
  await claimForCoworkUsers(async (userId) => { nextMinute.push(userId); return { id: userId }; }, 60_000);
  assert.deepEqual(nextMinute, [QA], 'the next minute starts with the QA account and stops at the first job');
  assert.equal(await claimForCoworkUsers(async () => null, 0), null);
}));

test('with only the owner configured, the workers behave as before', () => withEnv({ COWORK_OWNER_USER_ID: OWNER, COWORK_ALLOWED_USER_IDS: undefined }, async () => {
  const asked: string[] = [];
  await claimForCoworkUsers(async (userId) => { asked.push(userId); return null; }, 123_456_789);
  assert.deepEqual(asked, [OWNER]);
}));

test('without a valid id nothing is claimed', () => withEnv({ COWORK_OWNER_USER_ID: '*', COWORK_ALLOWED_USER_IDS: 'x' }, async () => {
  let asked = 0;
  assert.equal(await claimForCoworkUsers(async () => { asked++; return { id: 'x' }; }), null);
  assert.equal(asked, 0);
}));

function runsClient(rows: Array<{ user_id: string }>, calls: string[] = []) {
  return { from(table: string) {
    calls.push(table);
    const builder: any = { select: () => builder, gte: (_: string, since: string) => { calls.push(`since:${since.slice(0, 10)}`); return builder; },
      order: () => builder, limit: async () => ({ data: rows, error: null }) };
    return builder;
  } } as any;
}

test('open to everyone, the workers also take whoever used Cowork in the last 30 days, read once a minute', () => withEnv({ COWORK_OWNER_USER_ID: OWNER, COWORK_ALLOWED_USER_IDS: undefined, COWORK_OPEN_TO_ALL: 'true' }, async () => {
  forgetCoworkWorkerUsers();
  const SELLER = '00000000-0000-4000-8000-0000000000cc';
  const calls: string[] = [];
  const client = runsClient([{ user_id: SELLER }, { user_id: OWNER }, { user_id: SELLER }], calls);
  const now = Date.parse('2026-10-19T12:00:00Z');
  assert.deepEqual(await coworkWorkerUserIds(client, now), [OWNER, SELLER]);
  assert.deepEqual(calls, ['cowork_runs', 'since:2026-09-19']);
  await coworkWorkerUserIds(client, now + 30_000);
  assert.equal(calls.length, 2, 'within the minute it is not read again');
  const asked: string[] = [];
  await claimForCoworkUsers(async (userId) => { asked.push(userId); return null; }, now + 30_000, client);
  assert.deepEqual(asked.sort(), [OWNER, SELLER].sort());
  forgetCoworkWorkerUsers();
}));

test('open to everyone, a failed read keeps the configured people', () => withEnv({ COWORK_OWNER_USER_ID: OWNER, COWORK_OPEN_TO_ALL: 'true' }, async () => {
  forgetCoworkWorkerUsers();
  const broken = { from: () => { const b: any = { select: () => b, gte: () => b, order: () => b, limit: async () => ({ data: null, error: { message: 'down' } }) }; return b; } } as any;
  assert.deepEqual(await coworkWorkerUserIds(broken, Date.now()), [OWNER]);
  forgetCoworkWorkerUsers();
}));

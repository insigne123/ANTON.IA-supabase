import assert from 'node:assert/strict';
import test from 'node:test';
import { claimForCoworkUsers, coworkWorkerUserIds } from './worker-users';

const OWNER = '00000000-0000-4000-8000-000000000001';
const QA = '00000000-0000-4000-8000-0000000000aa';

function withEnv<T>(values: Record<string, string | undefined>, run: () => Promise<T>) {
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  for (const [key, value] of Object.entries(values)) if (value === undefined) delete process.env[key];
  return run().finally(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
}

test('the workers take each allowed person\'s work, starting with a different one each minute', () => withEnv({ COWORK_OWNER_USER_ID: OWNER, COWORK_ALLOWED_USER_IDS: QA }, async () => {
  assert.deepEqual(coworkWorkerUserIds(), [OWNER, QA]);
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

import assert from 'node:assert/strict';
import test from 'node:test';

import { nativeResearchInternals } from './native-research';

const { processJobsAtOnce } = nativeResearchInternals;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test('a tick works on three research jobs at once and counts the ones it completed', async () => {
  let running = 0;
  let mostAtOnce = 0;
  const done: number[] = [];
  const completed = await processJobsAtOnce([1, 2, 3, 4, 5, 6, 7], 3, async (job) => {
    running += 1;
    mostAtOnce = Math.max(mostAtOnce, running);
    await pause(5);
    running -= 1;
    done.push(job);
    return job !== 4;
  });
  assert.equal(mostAtOnce, 3, 'three together, not one after the other');
  assert.deepEqual(done.sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7], 'every job is worked on once');
  assert.equal(completed, 6, 'a job that did not complete is not counted');
});

test('after a job throws no other starts, the ones running finish, and then the error is raised', async () => {
  const started: number[] = [];
  const finished: number[] = [];
  await assert.rejects(processJobsAtOnce([1, 2, 3, 4, 5], 3, async (job) => {
    started.push(job);
    if (job === 1) { await pause(1); throw new Error('claim failed'); }
    await pause(20);
    finished.push(job);
    return true;
  }), /claim failed/);
  assert.deepEqual(started, [1, 2, 3], 'the rest stay queued for the next tick');
  assert.deepEqual(finished.sort(), [2, 3], 'the tick waited for the research it had started');
});

test('no jobs, no work', async () => {
  assert.equal(await processJobsAtOnce([], 3, async () => { throw new Error('unexpected'); }), 0);
});

const { nextResearchQuotaDay, takeMoreResearchRounds, takeResearchTurns } = nativeResearchInternals;

test('a round takes one job per person in turn, so a batch does not make someone else wait behind all of it', () => {
  const batch = Array.from({ length: 40 }, (_, index) => ({ id: `batch-${index}`, userId: 'ana' }));
  const waiting = [...batch.slice(0, 30), { id: 'single', userId: 'berta' }, ...batch.slice(30), { id: 'late', userId: 'carla' }];
  assert.deepEqual(
    takeResearchTurns(waiting, 5).map((job) => job.id),
    ['batch-0', 'single', 'late', 'batch-1', 'batch-2'],
    'the single requests go in the first round; the rest of it is the batch, oldest first',
  );
  assert.deepEqual(takeResearchTurns(batch, 5).map((job) => job.id), ['batch-0', 'batch-1', 'batch-2', 'batch-3', 'batch-4']);
  assert.deepEqual(takeResearchTurns(waiting.slice(0, 2), 5).map((job) => job.id), ['batch-0', 'batch-1'], 'fewer waiting than the round holds');
  assert.deepEqual(takeResearchTurns([], 5), []);
});

test('a job refused for today\'s quota is due again when the next UTC day begins', () => {
  assert.equal(nextResearchQuotaDay(new Date('2026-11-23T15:16:00.000Z')), '2026-11-24T00:00:30.000Z');
  assert.equal(nextResearchQuotaDay(new Date('2026-12-31T23:59:59.000Z')), '2027-01-01T00:00:30.000Z');
});

test('a pass takes more rounds while they come back full and the time allows', async () => {
  const rounds = [{ claimed: 5, completed: 5 }, { claimed: 5, completed: 4 }, { claimed: 2, completed: 2 }, { claimed: 5, completed: 5 }];
  let asked = 0;
  const added = await takeMoreResearchRounds({
    first: { claimed: 5, completed: 5 }, limit: 5, until: 1_000, now: () => 0,
    round: async () => rounds[asked++],
  });
  assert.equal(asked, 3, 'the round that came back short was the last one');
  assert.deepEqual(added, { claimed: 12, completed: 11 });

  let clock = 0;
  asked = 0;
  await takeMoreResearchRounds({
    first: { claimed: 5, completed: 5 }, limit: 5, until: 60_000, now: () => clock,
    round: async () => { asked += 1; clock += 25_000; return { claimed: 5, completed: 5 }; },
  });
  assert.equal(asked, 3, 'no round starts once the time is over');

  asked = 0;
  await takeMoreResearchRounds({ first: { claimed: 3, completed: 3 }, limit: 5, until: 60_000, now: () => 0, round: async () => { asked += 1; return { claimed: 0, completed: 0 }; } });
  await takeMoreResearchRounds({ first: { claimed: 5, completed: 5 }, limit: 5, until: 0, now: () => 0, round: async () => { asked += 1; return { claimed: 0, completed: 0 }; } });
  assert.equal(asked, 0, 'a first round that was not full, or no time asked for: one round, as before');
});

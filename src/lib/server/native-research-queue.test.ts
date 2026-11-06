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

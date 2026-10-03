import assert from 'node:assert/strict';
import test from 'node:test';

import { createCoalescedRunner } from './coalesced-runner';

/** Manual clock: timers fire only when the test advances time. */
function manualTimers() {
  let now = 0;
  let nextId = 1;
  const pending = new Map<number, { at: number; callback: () => void }>();
  return {
    timers: {
      setTimer: (callback: () => void, ms: number) => { const id = nextId++; pending.set(id, { at: now + ms, callback }); return id; },
      clearTimer: (handle: unknown) => { pending.delete(handle as number); },
    },
    async advance(ms: number) {
      now += ms;
      for (const [id, entry] of [...pending.entries()].sort((a, b) => a[1].at - b[1].at)) {
        if (entry.at > now) continue;
        pending.delete(id);
        entry.callback();
      }
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

test('a burst of realtime events becomes one reload', async () => {
  const clock = manualTimers();
  let runs = 0;
  const runner = createCoalescedRunner(() => { runs += 1; }, { delayMs: 600, timers: clock.timers });
  for (let i = 0; i < 20; i++) {
    runner.schedule();
    await clock.advance(100);
  }
  assert.equal(runs, 0, 'nothing runs while the events keep coming');
  await clock.advance(600);
  assert.equal(runs, 1);
});

test('an event during a reload queues exactly one more, never two at once', async () => {
  const clock = manualTimers();
  let active = 0;
  let maxActive = 0;
  let runs = 0;
  let release: () => void = () => {};
  const runner = createCoalescedRunner(async () => {
    runs += 1;
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise<void>((resolve) => { release = resolve; });
    active -= 1;
  }, { delayMs: 10, timers: clock.timers });

  runner.schedule();
  await clock.advance(10);
  assert.equal(runs, 1);
  runner.schedule();
  await clock.advance(10);
  runner.schedule();
  await clock.advance(10);
  assert.equal(runs, 1, 'the second and third requests wait for the first run');
  release();
  await clock.advance(0);
  await clock.advance(10);
  assert.equal(runs, 2, 'one more run covers both requests');
  release();
  await clock.advance(10);
  assert.equal(runs, 2);
  assert.equal(maxActive, 1);
});

test('a failed reload does not stop the next one, and cancel drops what is pending', async () => {
  const clock = manualTimers();
  let runs = 0;
  const runner = createCoalescedRunner(() => { runs += 1; if (runs === 1) throw new Error('offline'); }, { delayMs: 5, timers: clock.timers });
  runner.schedule();
  await clock.advance(5);
  runner.schedule();
  await clock.advance(5);
  assert.equal(runs, 2);
  runner.schedule();
  runner.cancel();
  await clock.advance(50);
  runner.schedule();
  await clock.advance(50);
  assert.equal(runs, 2, 'after cancel nothing else runs');
});

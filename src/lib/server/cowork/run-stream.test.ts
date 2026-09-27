import assert from 'node:assert/strict';
import test from 'node:test';
import { coworkStreamFrames, type CoworkRunCursor } from './run-stream';

async function collect(frames: AsyncGenerator<string>) {
  const out: string[] = [];
  for await (const frame of frames) out.push(frame);
  return out;
}

const fast = { tickMs: 1, lifetimeMs: 10_000, heartbeatMs: 10_000, retryMs: 3000 };

test('rings once per change and ends when the run stops being active', async () => {
  const reads: Array<CoworkRunCursor | null> = [
    { status: 'running', sequence: 3 },
    { status: 'running', sequence: 3 },
    { status: 'running', sequence: 4 },
    { status: 'completed', sequence: 5 },
  ];
  const frames = await collect(coworkStreamFrames({
    first: { status: 'queued', sequence: 1 }, read: async () => reads.shift() ?? null,
    signal: new AbortController().signal, options: fast,
  }));
  assert.deepEqual(frames, [
    'retry: 3000\n\n',
    'event: change\ndata: {"status":"queued","sequence":1}\n\n',
    'event: change\ndata: {"status":"running","sequence":3}\n\n',
    'event: change\ndata: {"status":"running","sequence":4}\n\n',
    'event: change\ndata: {"status":"completed","sequence":5}\n\n',
    'event: end\ndata: {"status":"completed","sequence":5}\n\n',
  ]);
});

test('a run that is gone or unreadable closes the stream without a frame of its own', async () => {
  const gone = await collect(coworkStreamFrames({
    first: { status: 'running', sequence: 1 }, read: async () => null, signal: new AbortController().signal, options: fast,
  }));
  assert.equal(gone.length, 2);
  const failing = await collect(coworkStreamFrames({
    first: { status: 'running', sequence: 1 }, read: async () => { throw new Error('rls'); }, signal: new AbortController().signal, options: fast,
  }));
  assert.equal(failing.length, 2);
});

test('a quiet run gets heartbeats and the connection closes at its lifetime; leaving stops it at once', async () => {
  let clock = 0;
  const quiet = await collect(coworkStreamFrames({
    first: { status: 'running', sequence: 1 }, read: async () => { clock += 5000; return { status: 'running', sequence: 1 }; },
    signal: new AbortController().signal, now: () => clock, options: { ...fast, lifetimeMs: 40_000, heartbeatMs: 15_000 },
  }));
  assert.deepEqual(quiet.filter(frame => frame.startsWith(':')), [': ping\n\n', ': ping\n\n']);

  const controller = new AbortController();
  let reads = 0;
  const left = collect(coworkStreamFrames({
    first: { status: 'running', sequence: 1 }, read: async () => { reads++; return { status: 'running', sequence: 1 }; },
    signal: controller.signal, options: { ...fast, tickMs: 60_000 },
  }));
  controller.abort();
  assert.deepEqual(await left, ['retry: 3000\n\n']);
  assert.equal(reads, 0);
});

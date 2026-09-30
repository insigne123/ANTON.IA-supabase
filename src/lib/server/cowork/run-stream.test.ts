import assert from 'node:assert/strict';
import test from 'node:test';
import { coworkDraftDelta, coworkStreamFrames, type CoworkRunCursor } from './run-stream';
import type { CoworkRunDraft } from './live-draft';

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

test('a growing draft is sent as what it added, a rewrite from where it changed', () => {
  assert.deepEqual(coworkDraftDelta('', 'Hola'), { from: 0, text: 'Hola' });
  assert.deepEqual(coworkDraftDelta('Hola', 'Hola Felipe'), { from: 4, text: ' Felipe' });
  assert.deepEqual(coworkDraftDelta('Hola Felipe', 'Hola Camila'), { from: 5, text: 'Camila' });
  assert.deepEqual(coworkDraftDelta('Hola Felipe', 'Hola'), { from: 4, text: '' });
  // Two emoji that share their first half: the pair is never split.
  assert.deepEqual(coworkDraftDelta('ok 😀', 'ok 😃'), { from: 3, text: '😃' });
});

test('while the run works, the draft goes out once per change, and a missing draft table leaves only the doorbell', async () => {
  let clock = 0;
  const drafts: Array<CoworkRunDraft | null> = [
    null,
    { text: 'Tus 3 contactos', cards: [], reviewing: false, phase: null, updatedAt: 't1' },
    { text: 'Tus 3 contactos', cards: [], reviewing: false, phase: null, updatedAt: 't1' },
    { text: 'Tus 3 contactos de RR. HH.', cards: [{ type: 'sequence', title: 'Secuencia', parts: 1 }], reviewing: false, phase: null, updatedAt: 't2' },
    // The closing correction: same text, now being reviewed.
    { text: 'Tus 3 contactos de RR. HH.', cards: [{ type: 'sequence', title: 'Secuencia', parts: 1 }], reviewing: true, phase: null, updatedAt: 't3' },
  ];
  const frames = await collect(coworkStreamFrames({
    first: { status: 'running', sequence: 1 },
    // The run keeps working until every draft was read, then completes.
    read: async () => (drafts.length ? { status: 'running', sequence: 2 } : { status: 'completed', sequence: 3 }),
    readDraft: async () => (drafts.length ? drafts.shift() ?? null : null),
    signal: new AbortController().signal, now: () => (clock += 1),
    options: { ...fast, tickMs: 3, draftTickMs: 1 },
  }));
  assert.deepEqual(frames.filter(item => item.startsWith('event: draft')), [
    'event: draft\ndata: {"from":0,"text":"Tus 3 contactos","cards":[],"reviewing":false}\n\n',
    'event: draft\ndata: {"from":15,"text":" de RR. HH.","cards":[{"type":"sequence","title":"Secuencia","parts":1}],"reviewing":false}\n\n',
    'event: draft\ndata: {"from":26,"text":"","cards":[{"type":"sequence","title":"Secuencia","parts":1}],"reviewing":true}\n\n',
  ]);
  assert.equal(frames.at(-1), 'event: end\ndata: {"status":"completed","sequence":3}\n\n');

  let draftReads = 0;
  const doorbell = await collect(coworkStreamFrames({
    first: { status: 'running', sequence: 1 },
    read: async () => ({ status: 'completed', sequence: 2 }),
    readDraft: async () => { draftReads++; throw new Error('relation "cowork_run_drafts" does not exist'); },
    signal: new AbortController().signal, options: fast,
  }));
  assert.equal(draftReads, 1);
  assert.equal(doorbell.some(item => item.startsWith('event: draft')), false);
  assert.equal(doorbell.at(-1), 'event: end\ndata: {"status":"completed","sequence":2}\n\n');
});

test('a held answer sends its phase and never text: a new phase or card is a new frame', async () => {
  let clock = 0;
  const card = (parts: number) => [{ type: 'sequence', title: null, parts }];
  const drafts: Array<CoworkRunDraft | null> = [
    { text: '', cards: [], reviewing: false, phase: 'writing', updatedAt: 't1' },
    { text: '', cards: card(1), reviewing: false, phase: 'writing', updatedAt: 't2' },
    { text: '', cards: card(1), reviewing: false, phase: 'writing', updatedAt: 't3' },
    { text: '', cards: card(3), reviewing: false, phase: 'reviewing', updatedAt: 't4' },
    { text: '', cards: card(3), reviewing: false, phase: 'adjusting', updatedAt: 't5' },
  ];
  const frames = await collect(coworkStreamFrames({
    first: { status: 'running', sequence: 1 },
    read: async () => (drafts.length ? { status: 'running', sequence: 2 } : { status: 'completed', sequence: 3 }),
    readDraft: async () => (drafts.length ? drafts.shift() ?? null : null),
    signal: new AbortController().signal, now: () => (clock += 1),
    options: { ...fast, tickMs: 3, draftTickMs: 1 },
  }));
  assert.deepEqual(frames.filter(item => item.startsWith('event: draft')).map(item => JSON.parse(item.split('data: ')[1])), [
    { from: 0, text: '', cards: [], reviewing: false, phase: 'writing' },
    { from: 0, text: '', cards: card(1), reviewing: false, phase: 'writing' },
    { from: 0, text: '', cards: card(3), reviewing: false, phase: 'reviewing' },
    { from: 0, text: '', cards: card(3), reviewing: false, phase: 'adjusting' },
  ]);
});

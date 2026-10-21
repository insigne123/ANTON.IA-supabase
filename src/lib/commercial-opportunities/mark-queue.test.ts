import assert from 'node:assert/strict';
import test from 'node:test';
import { MarkQueue, applyMarkChange, type MarkInput } from './mark-queue';
import { emptyMark, type ReportMark } from './report-marks';

const KEY = 'step:aaaaaaaaaaaaaaaa';
const OTHER = 'step:bbbbbbbbbbbbbbbb';
const mark = (key: string, done: boolean): ReportMark => ({ ...emptyMark(key), done });
const gate = () => { let open!: () => void; const wait = new Promise<void>(resolve => { open = resolve; }); return { wait, open }; };

function harness(send: (input: MarkInput) => Promise<ReportMark | null>, confirmed = {}) {
  const settled: Array<[string, boolean | undefined, boolean]> = []; const pending: string[][] = [];
  const queue = new MarkQueue({ send, settled: (key, value, failed) => settled.push([key, value?.done, failed]), pending: keys => pending.push([...keys].sort()) }, confirmed);
  return { queue, settled, pending };
}

test('a change shows at once on top of what is on screen', () => {
  const marks = applyMarkChange({}, { key: KEY, label: 'Enviar consultas', done: true });
  assert.equal(marks[KEY].done, true);
  assert.equal(applyMarkChange(marks, { key: KEY, label: 'Enviar consultas', note: '  lo ve Ana ' })[KEY].note, 'lo ve Ana');
  assert.equal(applyMarkChange(marks, { key: KEY, label: 'Enviar consultas', done: false })[KEY].done, false, 'and it can be taken back');
  assert.equal(marks[KEY].highlight, false);
});

test('a second click on the same item is not lost while the first is still saving: both reach the server, in order, and the last one decides', async () => {
  const first = gate(); const sent: boolean[] = [];
  const { queue, settled, pending } = harness(async input => { sent.push(Boolean(input.done)); if (sent.length === 1) await first.wait; return mark(input.key, Boolean(input.done)); });
  const a = queue.push({ key: KEY, label: 'x', done: true });
  const b = queue.push({ key: KEY, label: 'x', done: false });
  await Promise.resolve();
  assert.deepEqual(sent, [true], 'the second waits behind the first');
  assert.equal(queue.isPending(KEY), true);
  first.open();
  await Promise.all([a, b]);
  assert.deepEqual(sent, [true, false]);
  assert.deepEqual(settled, [[KEY, false, false]], 'only the last change says how the item ends: the check does not flicker');
  assert.deepEqual(pending.at(-1), []);
  assert.equal(queue.isPending(KEY), false);
});

test('another item never waits for this one', async () => {
  const slow = gate(); const order: string[] = [];
  const { queue } = harness(async input => { order.push(`start ${input.key}`); if (input.key === KEY) await slow.wait; order.push(`end ${input.key}`); return mark(input.key, true); });
  const a = queue.push({ key: KEY, label: 'a', done: true });
  const b = queue.push({ key: OTHER, label: 'b', done: true });
  await b;
  assert.deepEqual(order, [`start ${KEY}`, `start ${OTHER}`, `end ${OTHER}`]);
  assert.deepEqual([...queue.pendingKeys()], [KEY]);
  slow.open(); await a;
});

test('if the last save fails the item goes back to what the server last confirmed; if an earlier one fails and the last works, the server decides', async () => {
  const failing = harness(async () => null, { [KEY]: mark(KEY, true) });
  await failing.queue.push({ key: KEY, label: 'x', done: false });
  assert.deepEqual(failing.settled, [[KEY, true, true]], 'back to «listo», which the server still has');
  const empty = harness(async () => null);
  await empty.queue.push({ key: KEY, label: 'x', done: true });
  assert.deepEqual(empty.settled, [[KEY, undefined, true]], 'an item the server never had goes back to nothing');

  let calls = 0;
  const recovering = harness(async input => (++calls === 1 ? null : mark(input.key, Boolean(input.done))));
  const first = recovering.queue.push({ key: KEY, label: 'x', done: true });
  const second = recovering.queue.push({ key: KEY, label: 'x', done: false });
  await Promise.all([first, second]);
  assert.deepEqual(recovering.settled, [[KEY, false, false]]);

  const thrown = harness(async () => { throw new Error('offline'); }, { [KEY]: mark(KEY, false) });
  await thrown.queue.push({ key: KEY, label: 'x', done: true });
  assert.deepEqual(thrown.settled, [[KEY, false, true]], 'a request that breaks is a failure, never an unhandled error');
});

test('a reading of the expediente updates what the server confirmed, so a failure later goes back to the newest state', async () => {
  const { queue, settled } = harness(async () => null, { [KEY]: mark(KEY, false) });
  queue.confirm({ [KEY]: mark(KEY, true) });
  await queue.push({ key: KEY, label: 'x', done: false });
  assert.deepEqual(settled, [[KEY, true, true]]);
});

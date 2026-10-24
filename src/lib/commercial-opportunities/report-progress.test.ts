import assert from 'node:assert/strict';
import test from 'node:test';
import { nextReportProgress, reportJobProgress, reportMinutes, reportMinutesLeft } from './report-progress';

const blank = { read: 0, total: null, document: null, since: null, readSince: null, minutes: null };

test('the office only shows what the job recorded: queued, then gathering until the job says otherwise', () => {
  assert.deepEqual(reportJobProgress('queued', { progress: { stage: 'read', read: 3, total: 9 } }), { ...blank, stage: 'queued', read: 3, total: 9 });
  assert.deepEqual(reportJobProgress('running', {}), { ...blank, stage: 'gather' });
  assert.deepEqual(reportJobProgress('waiting', null), { ...blank, stage: 'gather' });
  // A stage it does not know, or junk, is not shown as progress.
  assert.deepEqual(reportJobProgress('running', { progress: { stage: 'publish', read: 'x', total: -2, document: 4, since: 'ayer' } }), { ...blank, stage: 'gather' });
  assert.deepEqual(reportJobProgress('running', { progress: { stage: 'read', read: 12, total: 40, document: '  Bases.pdf ' } }),
    { ...blank, stage: 'read', read: 12, total: 40, document: 'Bases.pdf' });
  // Never more parts read than there are.
  assert.equal(reportJobProgress('running', { progress: { stage: 'read', read: 50, total: 40 } }).read, 40);
  assert.equal(reportJobProgress('running', { progress: { stage: 'read', document: 'x'.repeat(400) } }).document?.length, 160);
});

test('reading never goes back when a job resumes, and writing keeps the moment it started', () => {
  const now = new Date('2026-10-16T12:00:00.000Z');
  let note = nextReportProgress(undefined, { stage: 'buyer' }, now);
  assert.deepEqual(note, { stage: 'buyer' });
  note = nextReportProgress(note, { stage: 'read', read: 30, total: 40, document: 'Bases.pdf' }, now);
  // The next tick reads its first parts again, from results already paid for; the pace still counts from the first part.
  note = nextReportProgress(note, { stage: 'read', read: 1, total: 40, document: 'Anexo 1.docx' }, new Date('2026-10-16T12:03:00.000Z'));
  assert.deepEqual(note, { stage: 'read', read: 30, total: 40, document: 'Anexo 1.docx', readSince: '2026-10-16T12:00:00.000Z' });
  // A different set of documents starts over.
  const other = nextReportProgress(note, { stage: 'read', read: 2, total: 12, document: null }, new Date('2026-10-16T12:05:00.000Z'));
  assert.deepEqual([other.read, other.readSince], [2, '2026-10-16T12:05:00.000Z']);
  const writing = nextReportProgress(note, { stage: 'write', total: 40 }, now);
  assert.deepEqual(writing, { stage: 'write', read: 40, total: 40, since: '2026-10-16T12:00:00.000Z' });
  assert.equal(nextReportProgress(writing, { stage: 'write', total: 40 }, new Date('2026-10-16T12:02:00.000Z')).since, '2026-10-16T12:00:00.000Z');
  assert.deepEqual(reportJobProgress('running', { progress: writing }), { ...blank, stage: 'write', read: 40, total: 40, since: '2026-10-16T12:00:00.000Z' });
});

test('the minutes a report takes grow with its size, read four parts at a time (OPP-19)', () => {
  assert.deepEqual([1, 5, 14, 26, 50].map(reportMinutes), [4, 4, 6, 9, 13]);
  // The estimate made when it was asked for travels in the job's payload; junk is no estimate.
  assert.equal(reportJobProgress('queued', { estimate: { minutes: 6 } }).minutes, 6);
  assert.equal(reportJobProgress('queued', { estimate: { minutes: 'pronto' } }).minutes, null);
});

test('the time left: the size before reading, then the pace of this report with its pauses, and nothing while writing', () => {
  const start = Date.parse('2026-10-16T12:00:00.000Z');
  const queued = reportJobProgress('queued', { estimate: { minutes: 9 } });
  assert.equal(reportMinutesLeft(queued, start), 9, 'nothing read yet: what the size suggests');
  const reading = reportJobProgress('running', { estimate: { minutes: 9 }, progress: { stage: 'read', read: 8, total: 26, readSince: '2026-10-16T12:00:00.000Z' } });
  // 8 parts in 2 minutes: 18 parts more at that pace (4.5 min) and about 3 to write.
  assert.equal(reportMinutesLeft(reading, start + 2 * 60_000), 8);
  // A pause between turns slows the pace (8 parts in 4 minutes: 9 more), and the time left says so.
  assert.equal(reportMinutesLeft(reading, start + 4 * 60_000), 12);
  assert.equal(reportMinutesLeft(reportJobProgress('running', { progress: { stage: 'write', total: 26, since: '2026-10-16T12:09:00.000Z' } }), start), null);
  assert.equal(reportMinutesLeft(reportJobProgress('running', {}), start), null, 'an old job without an estimate promises nothing');
});

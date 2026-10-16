import assert from 'node:assert/strict';
import test from 'node:test';
import { nextReportProgress, reportJobProgress } from './report-progress';

const blank = { read: 0, total: null, document: null, since: null };

test('the office only shows what the job recorded: queued, then gathering until the job says otherwise', () => {
  assert.deepEqual(reportJobProgress('queued', { progress: { stage: 'read', read: 3, total: 9 } }), { ...blank, stage: 'queued', read: 3, total: 9 });
  assert.deepEqual(reportJobProgress('running', {}), { ...blank, stage: 'gather' });
  assert.deepEqual(reportJobProgress('waiting', null), { ...blank, stage: 'gather' });
  // A stage it does not know, or junk, is not shown as progress.
  assert.deepEqual(reportJobProgress('running', { progress: { stage: 'publish', read: 'x', total: -2, document: 4, since: 'ayer' } }), { ...blank, stage: 'gather' });
  assert.deepEqual(reportJobProgress('running', { progress: { stage: 'read', read: 12, total: 40, document: '  Bases.pdf ' } }),
    { stage: 'read', read: 12, total: 40, document: 'Bases.pdf', since: null });
  // Never more parts read than there are.
  assert.equal(reportJobProgress('running', { progress: { stage: 'read', read: 50, total: 40 } }).read, 40);
  assert.equal(reportJobProgress('running', { progress: { stage: 'read', document: 'x'.repeat(400) } }).document?.length, 160);
});

test('reading never goes back when a job resumes, and writing keeps the moment it started', () => {
  const now = new Date('2026-10-16T12:00:00.000Z');
  let note = nextReportProgress(undefined, { stage: 'buyer' }, now);
  assert.deepEqual(note, { stage: 'buyer' });
  note = nextReportProgress(note, { stage: 'read', read: 30, total: 40, document: 'Bases.pdf' }, now);
  // The next tick reads its first parts again, from results already paid for.
  note = nextReportProgress(note, { stage: 'read', read: 1, total: 40, document: 'Anexo 1.docx' }, now);
  assert.deepEqual(note, { stage: 'read', read: 30, total: 40, document: 'Anexo 1.docx' });
  // A different set of documents starts over.
  assert.equal(nextReportProgress(note, { stage: 'read', read: 2, total: 12, document: null }, now).read, 2);
  const writing = nextReportProgress(note, { stage: 'write', total: 40 }, now);
  assert.deepEqual(writing, { stage: 'write', read: 40, total: 40, since: '2026-10-16T12:00:00.000Z' });
  assert.equal(nextReportProgress(writing, { stage: 'write', total: 40 }, new Date('2026-10-16T12:02:00.000Z')).since, '2026-10-16T12:00:00.000Z');
  assert.deepEqual(reportJobProgress('running', { progress: writing }), { stage: 'write', read: 40, total: 40, document: null, since: '2026-10-16T12:00:00.000Z' });
});

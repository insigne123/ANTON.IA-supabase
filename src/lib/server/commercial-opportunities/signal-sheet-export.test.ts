import assert from 'node:assert/strict';
import test from 'node:test';
import { marksFromRows, reportItemKey } from '@/lib/commercial-opportunities/report-marks';
import { NOW, hiringItem, postItem, report } from '@/lib/commercial-opportunities/signal-sheet-fixtures';
import { signalSheetDownload, signalSheetOptions } from './signal-sheet-export';

const marks = (rows: Parameters<typeof marksFromRows>[0]) => ({ items: marksFromRows(rows), names: { u1: 'Ana Soto' } });

test('the PDF draws what the team ticked and the notes with who wrote them', () => {
  const written = report();
  const saved = marks([
    { item_key: reportItemKey('step', 'Reunir casos y capacidad por comuna para la primera reunión'), done: true, highlight: false, note: '', updated_by: 'u1', updated_at: '2026-10-22T14:00:00Z' },
    { item_key: reportItemKey('question', written.questions[0]), done: false, highlight: true, note: 'Preguntarlo primero', updated_by: 'u1', updated_at: '2026-10-22T15:00:00Z' },
  ]);
  const options = signalSheetOptions(written, saved, '22 oct 2026');
  assert.equal(options.done!('step', 'Reunir casos y capacidad por comuna para la primera reunión'), true);
  assert.equal(options.done!('step', 'Otro paso'), false);
  assert.deepEqual(options.notes!.map(note => [note.label, note.note, note.by.split(' · ')[0]]), [[written.questions[0], 'Preguntarlo primero', 'Ana Soto']]);
  assert.equal(options.radarDate, '22 oct 2026');
});

test('without marks nothing is ticked and there are no notes; without a report there is nothing to note', () => {
  assert.equal(signalSheetOptions(report(), undefined).done!('step', 'x'), false);
  assert.deepEqual(signalSheetOptions(report(), undefined).notes, []);
  assert.deepEqual(signalSheetOptions(null, marks([])).notes, []);
});

test('a signal downloads as a PDF with or without its written plan, and what is not a signal has no sheet', async () => {
  for (const input of [{ item: hiringItem(), report: report() }, { item: hiringItem(), report: null }, { item: postItem(), report: null }]) {
    const bytes = await signalSheetDownload({ ...input, now: NOW });
    assert.ok(bytes && new TextDecoder().decode(bytes.slice(0, 5)) === '%PDF-');
    assert.ok(bytes.length > 4000);
  }
  assert.equal(await signalSheetDownload({ item: { ...hiringItem(), kind: 'tender' }, report: null, now: NOW }), null);
});

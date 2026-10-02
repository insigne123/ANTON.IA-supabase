import assert from 'node:assert/strict';
import test from 'node:test';
import { coworkDraftWriter, readCoworkRunDraft } from './live-draft';

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const answer = (reply: string, blocks = '') => `{"action":"answer","answer":{"reply":"${reply}"${blocks}`;

test('only an answer is written, at most once per interval with its latest text, the last one on flush', async () => {
  const writes: Array<{ text: string; cards: unknown }> = [];
  const writer = coworkDraftWriter(async (text, progress) => { writes.push({ text, cards: progress.cards }); return true; }, { intervalMs: 40 });
  // A read or a proposal writes nothing.
  writer.push('{"action":"leads.search","query":"RRHH');
  writer.push('{"action":"answer","answer":{"reply":"');
  await pause(60);
  assert.equal(writes.length, 0);
  // Chunks that land within one interval become one write, with the latest text.
  writer.push(answer('Tus 3'));
  writer.push(answer('Tus 3 contactos'));
  writer.push(answer('Tus 3 contactos de RR. HH.'));
  await pause(60);
  // The first answer may be written immediately; subsequent chunks must
  // converge on the latest text rather than assuming the scheduler waits.
  assert.equal(writes.at(-1)?.text, 'Tus 3 contactos de RR. HH.');
  assert.ok(writes.length <= 2);
  writer.push(answer('Listo.', ',"blocks":[{"type":"sequence","title":"Secuencia","steps":[{"day":1'));
  await writer.flush();
  assert.deepEqual(writes.at(-1), { text: 'Listo.', cards: [{ type: 'sequence', title: 'Secuencia', parts: 1 }] });
  // The same state is never written twice.
  const count = writes.length;
  await writer.flush();
  assert.equal(writes.length, count);
});

test('a correction keeps the text shown and marks it as reviewed, also when a write is in flight', async () => {
  const writes: Array<{ text: string; progress: unknown }> = [];
  let release = () => {};
  const writer = coworkDraftWriter(async (text, progress) => {
    writes.push({ text, progress });
    if (writes.length === 1) await new Promise<void>(resolve => { release = resolve; });
    return true;
  }, { intervalMs: 20 });
  // Nothing shown yet: nothing to mark.
  writer.review();
  await pause(40);
  assert.equal(writes.length, 0);
  writer.push(answer('Tus 3 contactos', ',"blocks":[{"type":"table","title":"A quién","rows":[["Felipe"]'));
  await pause(5);
  writer.review();
  await pause(40);
  assert.equal(writes.length, 1);
  release();
  await pause(60);
  assert.deepEqual(writes, [
    { text: 'Tus 3 contactos', progress: { cards: [{ type: 'table', title: 'A quién', parts: 1 }] } },
    { text: 'Tus 3 contactos', progress: { cards: [{ type: 'table', title: 'A quién', parts: 1 }], reviewing: true } },
  ]);
  await writer.flush();
  assert.equal(writes.length, 2);
});

test('a refused or failed write turns the drafts off for the rest of the run', async () => {
  for (const sink of [async () => false, async () => { throw new Error('relation "cowork_run_drafts" does not exist'); }]) {
    let calls = 0;
    const reasons: unknown[] = [];
    const writer = coworkDraftWriter(async () => { calls++; return sink(); }, { intervalMs: 1, onDisabled: reason => reasons.push(reason) });
    writer.push(answer('Hola'));
    await writer.flush();
    writer.push(answer('Hola Felipe'));
    await writer.flush();
    assert.equal(calls, 1);
    assert.equal(writer.disabled, true);
    assert.equal(reasons.length, 1);
  }
});

test('the page reads its own draft; odd progress reads as no cards', async () => {
  const filters: Array<[string, unknown]> = [];
  const row = { text: 'Tus 3 contactos', progress: { cards: [{ type: 'sequence', title: null, parts: 2 }] }, updated_at: '2026-09-28T01:00:00Z' };
  const client = (data: unknown) => ({
    from: (table: string) => {
      filters.push(['table', table]);
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => { filters.push([column, value]); return query; },
        maybeSingle: async () => ({ data, error: null }),
      };
      return query;
    },
  });
  const auth = (data: unknown) => ({ supabase: client(data), user: { id: 'u1' }, organizationId: 'o1' }) as unknown as Parameters<typeof readCoworkRunDraft>[0];
  assert.deepEqual(await readCoworkRunDraft(auth(row), 'r1'), { text: 'Tus 3 contactos', cards: [{ type: 'sequence', title: null, parts: 2 }], reviewing: false, phase: null, updatedAt: '2026-09-28T01:00:00Z' });
  assert.equal((await readCoworkRunDraft(auth({ ...row, progress: { ...row.progress, reviewing: true } }), 'r1'))?.reviewing, true);
  assert.deepEqual(filters.slice(0, 4), [['table', 'cowork_run_drafts'], ['run_id', 'r1'], ['user_id', 'u1'], ['organization_id', 'o1']]);
  assert.deepEqual((await readCoworkRunDraft(auth({ ...row, progress: { cards: 'x' } }), 'r1'))?.cards, []);
  assert.equal(await readCoworkRunDraft(auth(null), 'r1'), null);
  assert.equal(await readCoworkRunDraft(auth({ ...row, text: '' }), 'r1'), null);
  // A held answer has no text, only its phase; a phase the page does not know reads as no draft.
  assert.deepEqual(await readCoworkRunDraft(auth({ ...row, text: '', progress: { cards: [], phase: 'reviewing' } }), 'r1'),
    { text: '', cards: [], reviewing: false, phase: 'reviewing', updatedAt: '2026-09-28T01:00:00Z' });
  assert.equal(await readCoworkRunDraft(auth({ ...row, text: '', progress: { cards: [], phase: 'thinking' } }), 'r1'), null);
});

test('held, no text or card title travels: only the phase and how far each card got, and a phase never goes back', async () => {
  // A frozen clock: after the first write every change waits for the interval, so what is written depends on the calls,
  // never on how busy the machine is (with the real clock, a slow millisecond between review() and adjust() wrote both).
  const frozen = () => 0;
  const writes: Array<{ text: string; progress: unknown }> = [];
  const writer = coworkDraftWriter(async (text, progress) => { writes.push({ text, progress }); return true; }, { intervalMs: 1, hold: true, now: frozen });
  assert.equal(writer.held, true);
  // Nothing written yet: nothing to review or adjust.
  writer.review();
  writer.adjust();
  await pause(10);
  assert.equal(writes.length, 0);
  writer.push(answer('Tus 3'));
  await writer.flush();
  // The text grew, but nobody sees it: nothing new to write.
  writer.push(answer('Tus 3 contactos de RR. HH.'));
  await writer.flush();
  assert.deepEqual(writes, [{ text: '', progress: { cards: [], phase: 'writing' } }]);
  writer.push(answer('Listo.', ',"blocks":[{"type":"sequence","title":"Secuencia RR. HH.","steps":[{"day":1'));
  await writer.flush();
  writer.review();
  await writer.flush();
  writer.adjust();
  await writer.flush();
  writer.review();
  await writer.flush();
  const card = [{ type: 'sequence', title: null, parts: 1 }];
  assert.deepEqual(writes, [
    { text: '', progress: { cards: [], phase: 'writing' } },
    { text: '', progress: { cards: card, phase: 'writing' } },
    { text: '', progress: { cards: card, phase: 'reviewing' } },
    { text: '', progress: { cards: card, phase: 'adjusting' } },
  ]);

  // A correction starts its cards over: the counts the reader saw only grow, so nothing new is written while it catches up.
  const written: Array<{ cards: unknown; phase?: string }> = [];
  const steps = (count: number) => Array.from({ length: count }, (_, index) => `{"day":${index + 1}`).join('},');
  const again = coworkDraftWriter(async (_text, progress) => { written.push({ cards: progress.cards, phase: progress.phase }); return true; }, { intervalMs: 1, hold: true, now: frozen });
  again.push(answer('Listo.', `,"blocks":[{"type":"sequence","title":"Secuencia","steps":[${steps(3)}`));
  await again.flush();
  again.review();
  again.adjust();
  await again.flush();
  again.push(answer('Listo, ajustado.', `,"blocks":[{"type":"sequence","title":"Secuencia","steps":[${steps(1)}`));
  await again.flush();
  // A card of another kind at the same place is what the correction now says.
  again.push(answer('Listo, ajustado.', ',"blocks":[{"type":"table","title":"Tabla","rows":[["a"]'));
  await again.flush();
  const sequence = [{ type: 'sequence', title: null, parts: 3 }];
  assert.deepEqual(written, [
    { cards: sequence, phase: 'writing' },
    { cards: sequence, phase: 'adjusting' },
    { cards: [{ type: 'table', title: null, parts: 1 }], phase: 'adjusting' },
  ]);

  // Not held, adjust() does nothing: a correction is announced by review() and never streamed.
  const shown: string[] = [];
  const live = coworkDraftWriter(async text => { shown.push(text); return true; }, { intervalMs: 1, now: frozen });
  assert.equal(live.held, false);
  live.push(answer('Hola'));
  await live.flush();
  live.adjust();
  await live.flush();
  assert.deepEqual(shown, ['Hola']);
});

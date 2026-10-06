import test from 'node:test';
import assert from 'node:assert/strict';
import type { CoworkRun } from './contracts';
import { coworkEditableText, coworkEditedMessage, coworkFeedbackSchema, coworkTurnFeedback, coworkTurnVersions, coworkVersionLeaf } from './turn-actions';

const MARCELA = '11111111-1111-4111-8111-111111111111';
const CONTACT = '22222222-2222-4222-8222-222222222222';
const run = (id: string, parent: string | null, minute: number, extra: Partial<CoworkRun> = {}): CoworkRun => ({
  id, message: id, mode: 'approval', status: 'completed', created_at: `2026-10-06T12:${String(minute).padStart(2, '0')}:00Z`, parent_run_id: parent, ...extra,
});

test('editing shows the words you wrote and sends them with the references and files the message carried', () => {
  const original = `Escríbele a @Marcela Rojas sobre AXIS\n\n(ID de Marcela Rojas: ${MARCELA})\n(ID del contacto: ${CONTACT})\n\nAdjuntos:\n- lista.csv`;
  assert.equal(coworkEditableText(original), 'Escríbele a @Marcela Rojas sobre AXIS');
  assert.equal(coworkEditedMessage(original, 'Escríbele a @Marcela Rojas, más corto'),
    `Escríbele a @Marcela Rojas, más corto\n\n(ID de Marcela Rojas: ${MARCELA})\n(ID del contacto: ${CONTACT})\n\nAdjuntos:\n- lista.csv`);
  // Who you no longer name does not travel; the contact the message was about does.
  assert.equal(coworkEditedMessage(original, 'Mejor escríbele a su jefe'), `Mejor escríbele a su jefe\n\n(ID del contacto: ${CONTACT})\n\nAdjuntos:\n- lista.csv`);
  assert.equal(coworkEditedMessage('hola', '  hola, ¿qué haces?  '), 'hola, ¿qué haces?');
});

test('versions are the finished answers to the same message, oldest first; the first turn has none', () => {
  const runs = [run('root', null, 0), run('a', 'root', 1), run('b', 'root', 2), run('failed', 'root', 3, { status: 'failed' }),
    run('auto', 'root', 4, { automatic: true }), run('b-next', 'b', 5)];
  assert.deepEqual(coworkTurnVersions(runs, runs[2]), { index: 1, total: 2, ids: ['a', 'b'] });
  assert.deepEqual(coworkTurnVersions(runs, runs[3]), { index: 2, total: 3, ids: ['a', 'b', 'failed'] }, 'the attempt on screen counts while you look at it');
  assert.equal(coworkTurnVersions(runs, runs[0]), null);
  assert.equal(coworkTurnVersions(runs, runs[5]), null);
  assert.equal(coworkTurnVersions(runs, runs[4]), null);
});

test('a version opens where its conversation went on', () => {
  const runs = [run('root', null, 0), run('a', 'root', 1), run('a-next', 'a', 2), run('a-last', 'a-next', 6), run('b', 'root', 3)];
  assert.equal(coworkVersionLeaf(runs, 'a'), 'a-last');
  assert.equal(coworkVersionLeaf(runs, 'b'), 'b');
  assert.equal(coworkVersionLeaf(runs, 'missing'), 'missing');
});

test('feedback: a reason and a comment with 👎, the latest one counts and null takes it back', () => {
  assert.deepEqual(coworkFeedbackSchema.parse({ rating: 'down', reason: 'too_long', comment: '  muy largo  ' }), { rating: 'down', reason: 'too_long', comment: 'muy largo' });
  assert.deepEqual(coworkFeedbackSchema.parse({ rating: 'up' }), { rating: 'up', reason: null, comment: null });
  assert.throws(() => coworkFeedbackSchema.parse({ rating: 'meh' }));
  assert.throws(() => coworkFeedbackSchema.parse({ rating: 'down', comment: 'x'.repeat(501) }));
  assert.throws(() => coworkFeedbackSchema.parse({ rating: 'up', extra: 1 }));
  const event = (sequence: number, payload: Record<string, unknown>) => ({ sequence, kind: 'answer.feedback', payload, created_at: '2026-10-06T12:00:00Z' });
  assert.deepEqual(coworkTurnFeedback([event(1, { rating: 'up' }), event(2, { rating: 'down', reason: 'wrong_data' })]), { rating: 'down', reason: 'wrong_data', comment: null });
  assert.equal(coworkTurnFeedback([event(1, { rating: 'up' }), event(2, { rating: null })]), null);
  assert.equal(coworkTurnFeedback([]), null);
});

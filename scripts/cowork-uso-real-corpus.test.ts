// The «uso real» corpus (scripts/fixtures/cowork-uso-real-corpus.ts) played through the real loop with a scripted model, offline:
// the cases are well formed, and every case catches a turn that answers at once without doing what was asked. The live
// numbers are in docs/cowork-plan12-linea-base.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { coworkDecisionSchema } from '../src/lib/cowork/agent-loop';
import { USO_REAL_CORPUS } from './fixtures/cowork-uso-real-corpus';
import { runCorpusCase, type CorpusDecider } from './fixtures/cowork-conversation-runner';

const lazy: CorpusDecider = async () => coworkDecisionSchema.parse({ action: 'answer', query: null, leadId: null,
  answer: { reply: 'Listo, cuéntame más.', document: null, suggestions: null, question: '¿Algo más?' } });

test('uso real: twenty cases, ids unique and prefixed, each with an origin and its own checks', () => {
  assert.equal(USO_REAL_CORPUS.length, 20);
  const ids = USO_REAL_CORPUS.map(item => item.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const item of USO_REAL_CORPUS) {
    assert.match(item.id, /^ur-[a-z-]+$/);
    assert.ok(item.request.trim(), item.id);
    assert.ok(item.origin, `${item.id} says where it comes from`);
    assert.ok(item.checks.length >= 3, `${item.id} has checks of its own`);
  }
});

for (const item of USO_REAL_CORPUS.filter(entry => entry.id !== 'ur-hola')) {
  test(`${item.id}: a turn that answers at once without doing anything fails at least one check`, async () => {
    const outcome = await runCorpusCase(item, lazy);
    const missed = outcome.checks.filter(check => !check.passed).map(check => check.label);
    assert.ok(missed.length >= 1, `nothing failed: ${outcome.result.reply}`);
  });
}

test('ur-hola: a short greeting with no reads passes, six reads do not', async () => {
  const entry = USO_REAL_CORPUS.find(item => item.id === 'ur-hola')!;
  const greet: CorpusDecider = async () => coworkDecisionSchema.parse({ action: 'answer', query: null, leadId: null,
    answer: { reply: 'Hola, Nicolás. Te ayudo a conseguir reuniones para AXIS con correos y LinkedIn.', document: null, suggestions: null, question: '¿Busco prospectos o reviso tus contactos?' } });
  assert.deepEqual((await runCorpusCase(entry, greet)).checks.filter(check => !check.passed).map(check => check.label), []);
});

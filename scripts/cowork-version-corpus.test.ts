// The «Otra versión» corpus (scripts/fixtures/cowork-version-corpus.ts) played through the real loop with a scripted model,
// offline: the cases are well formed, the earlier versions and the feedback reach the decision, and a turn that answers at
// once without doing what was asked fails each case.
import test from 'node:test';
import assert from 'node:assert/strict';
import { coworkDecisionSchema } from '../src/lib/cowork/agent-loop';
import { VERSION_CORPUS } from './fixtures/cowork-version-corpus';
import { runCorpusCase, type CorpusDecider } from './fixtures/cowork-conversation-runner';

const lazy: CorpusDecider = async () => coworkDecisionSchema.parse({ action: 'answer', query: null, leadId: null,
  answer: { reply: 'Listo, cuéntame más. ¿Algo más?', document: null, suggestions: [{ label: 'Seguir', message: 'Sigue con lo anterior' }], question: null } });

test('versions: ids unique and prefixed, each with an origin, earlier versions or a rated turn, and its own checks', () => {
  const ids = VERSION_CORPUS.map(item => item.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const item of VERSION_CORPUS) {
    assert.match(item.id, /^ver-[a-z-]+$/);
    assert.ok(item.origin, item.id);
    assert.ok(item.previousVersions?.length || item.history?.some(turn => turn.feedback), `${item.id} brings what the person said`);
    assert.ok(item.checks.length >= 3, item.id);
  }
});

test('the earlier versions and the feedback reach the decision', async () => {
  const seen: unknown[] = [];
  const spy: CorpusDecider = async context => { seen.push(context); return lazy(context, { caseId: '', turn: 0 }); };
  await runCorpusCase(VERSION_CORPUS.find(item => item.id === 'ver-mas-corto')!, spy);
  assert.match(JSON.stringify(seen[0]), /previousVersionsInstruction/);
  assert.match(JSON.stringify(seen[0]), /Demasiado largo/);
  seen.length = 0;
  await runCorpusCase(VERSION_CORPUS.find(item => item.id === 'ver-hilo-breve')!, spy);
  assert.match(JSON.stringify(seen[0]), /historyFeedbackInstruction/);
});

for (const item of VERSION_CORPUS) {
  test(`${item.id}: a turn that answers at once without doing anything fails at least one check`, async () => {
    const outcome = await runCorpusCase(item, lazy);
    assert.ok(outcome.checks.some(check => !check.passed), `nothing failed: ${outcome.result.reply}`);
  });
}

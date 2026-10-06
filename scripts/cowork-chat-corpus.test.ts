// The chat corpus (scripts/fixtures/cowork-chat-corpus.ts) played through the real loop with a scripted model, offline: the cases
// are well formed, a turn that answers at once without doing what was asked fails each, and the heads-up cases tell a good
// answer from one that forgets the meeting or says it twice.
import test from 'node:test';
import assert from 'node:assert/strict';
import { coworkDecisionSchema } from '../src/lib/cowork/agent-loop';
import { CHAT_CORPUS } from './fixtures/cowork-chat-corpus';
import { corpusWorkspace, runCorpusCase, type CorpusDecider } from './fixtures/cowork-conversation-runner';

const answer = (reply: string): CorpusDecider => async () => coworkDecisionSchema.parse({ action: 'answer', query: null, leadId: null,
  answer: { reply, document: null, suggestions: [{ label: 'Armar una campaña', message: 'Arma una campaña para mis contactos con correo' }], question: null } });

test('chat: seven cases, ids unique and prefixed, each with an origin and its own checks', () => {
  assert.equal(CHAT_CORPUS.length, 7);
  const ids = CHAT_CORPUS.map(item => item.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const item of CHAT_CORPUS) {
    assert.match(item.id, /^chat-[a-z-]+$/);
    assert.ok(item.origin, `${item.id} says where it comes from`);
    assert.ok(item.checks.length >= 3, `${item.id} has checks of its own`);
  }
});

for (const item of CHAT_CORPUS) {
  test(`${item.id}: a turn that answers at once without doing anything fails at least one check`, async () => {
    const outcome = await runCorpusCase(item, answer('Listo, cuéntame más. ¿Algo más?'));
    assert.ok(outcome.checks.some(check => !check.passed), `nothing failed: ${outcome.result.reply}`);
  });
}

test('chat-aviso-dado: the figure without repeating the heads-up passes; repeating it does not', async () => {
  const entry = CHAT_CORPUS.find(item => item.id === 'chat-aviso-dado')!;
  const good = await runCorpusCase(entry, answer('De tus 256 contactos, 21 tienen correo. ¿Te preparo una campaña para esos 21?'));
  assert.deepEqual(good.checks.filter(check => !check.passed).map(check => check.label), []);
  const again = await runCorpusCase(entry, answer('De tus 256 contactos, 21 tienen correo. Por cierto, Marcela Rojas pidió una reunión. ¿Le respondo?'));
  assert.deepEqual(again.checks.filter(check => !check.passed).map(check => check.label), ['no repite el aviso de Marcela']);
});

test('the workspace a case carries is the one its world reads: the meeting is first of the day', () => {
  const entry = CHAT_CORPUS.find(item => item.id === 'chat-aviso-reunion')!;
  const workspace = corpusWorkspace(entry.world!.read);
  assert.deepEqual({ contacts: workspace?.contacts, withEmail: workspace?.withEmail, campaigns: workspace?.campaigns },
    { contacts: 256, withEmail: 21, campaigns: 19 });
  assert.deepEqual(workspace?.today?.first[0], { who: 'Marcela Rojas · Servicios Norte', what: 'pidió una reunión hace 4 días' });
});

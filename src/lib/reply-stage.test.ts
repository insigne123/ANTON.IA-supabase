import assert from 'node:assert/strict';
import test from 'node:test';
import type { JevAnswer } from '@/lib/server/jev';
import { JEV_DEAL_MIN_CONFIDENCE, REPLY_JEV_DEAL_QUESTION, jevReplyDeal } from './reply-jev';
import { readReplyDeal } from './reply-classifier';
import { replyStageSuggestion } from './reply-stage';
import { stageSuggestionReason } from './crm-stage-suggestions';

test('each kind of reply proposes its stage, and Jev only moves interested replies to «Negociación» or «Ganado»', () => {
  assert.deepEqual(replyStageSuggestion('meeting_request'), { stage: 'meeting', event: 'meeting_request' });
  assert.deepEqual(replyStageSuggestion('positive'), { stage: 'engaged', event: 'positive' });
  assert.deepEqual(replyStageSuggestion('negative'), { stage: 'closed_lost', event: 'not_interested' });
  assert.deepEqual(replyStageSuggestion('unsubscribe'), { stage: 'closed_lost', event: 'unsubscribe' });
  for (const intent of ['auto_reply', 'neutral', 'unknown', 'delivery_failure'] as const) assert.equal(replyStageSuggestion(intent), null, intent);
  assert.deepEqual(replyStageSuggestion('positive', 'negotiation'), { stage: 'negotiation', event: 'reply_negotiation' });
  assert.deepEqual(replyStageSuggestion('meeting_request', 'won'), { stage: 'closed_won', event: 'reply_won' });
  assert.deepEqual(replyStageSuggestion('negative', 'won'), { stage: 'closed_lost', event: 'not_interested' }, 'a refusal is never a sale');
  // The pipeline shows why in plain words.
  assert.equal(stageSuggestionReason('reply_negotiation'), 'Pidió una propuesta, un precio o un contrato.');
  assert.equal(stageSuggestionReason('reply_won'), 'Confirmó que quiere comprar.');
  assert.equal(stageSuggestionReason('not_interested'), 'Respondió que no le interesa.');
});

const choice = (value: string, confidence: number): JevAnswer => ({ type: 'choice', choice: value, confidence, probabilities: { [value]: confidence } });

test('Jev\'s word on the deal is taken only for a known option and from the calibrated floor', () => {
  assert.equal(JEV_DEAL_MIN_CONFIDENCE, 0.8);
  assert.deepEqual(Object.keys((REPLY_JEV_DEAL_QUESTION as { criteria: Record<string, string> }).criteria), ['negotiation', 'won', 'none']);
  assert.equal(jevReplyDeal(choice('negotiation', 0.93)), 'negotiation');
  assert.equal(jevReplyDeal(choice('won', 0.8)), 'won');
  assert.equal(jevReplyDeal(choice('won', 0.79)), null);
  assert.equal(jevReplyDeal(choice('none', 0.99)), null);
  assert.equal(jevReplyDeal(choice('meeting', 0.99)), null);
  assert.equal(jevReplyDeal({ type: 'noul', noul: 0.9 }), null);
  assert.equal(jevReplyDeal(undefined), null);
});

test('reading the deal fails open: without a key, on an error or with nothing to read, the reply keeps the stage of its intent', async () => {
  const asked: unknown[] = [];
  const answer = async (input: unknown) => { asked.push(input); return { status: 'ok', answers: { deal: choice('negotiation', 0.95) }, model: 'jev-latest', durationMs: 120, inputTokens: 40, costUsd: 0 }; };
  assert.equal(await readReplyDeal('¿Nos mandan la propuesta con precios?', { askJev: answer as never }), 'negotiation');
  assert.deepEqual(Object.keys((asked[0] as { questions: object }).questions), ['deal'], 'one question about the reply alone');
  const disabled = async () => ({ status: 'disabled', answers: null, model: null, durationMs: 0, inputTokens: 0, costUsd: 0 });
  assert.equal(await readReplyDeal('¿Nos mandan la propuesta?', { askJev: disabled as never }), null);
  assert.equal(await readReplyDeal('¿Nos mandan la propuesta?', { askJev: (async () => { throw new Error('timeout'); }) as never }), null);
  assert.equal(await readReplyDeal('   ', { askJev: answer as never }), null);
  assert.equal(asked.length, 1, 'an empty reply never reaches Jev');
});

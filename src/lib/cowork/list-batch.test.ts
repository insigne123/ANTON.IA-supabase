import test from 'node:test';
import assert from 'node:assert/strict';
import { coworkDecisionSchema, runCoworkReadLoop } from './agent-loop';
const leadId = '00000000-0000-4000-8000-000000000001';
test('list review batch consumes the read budget without proposing enrichment or send', async () => {
  let calls = 0;
  const result = await runCoworkReadLoop({ message: 'Revisa esta lista', signal: new AbortController().signal,
    authorize: async () => {}, record: async () => {},
    execute: async (action, input) => { calls++; assert.equal(action, 'lists.review_batch'); assert.deepEqual(JSON.parse(input), [leadId]); return { items: [], sendAuthorized: false }; },
    decide: async (observations, mustAnswer) => {
      if (observations.length) { assert.equal(mustAnswer, true); return coworkDecisionSchema.parse({ action: 'answer', query: null, leadId: null, answer: { reply: 'Lista revisada, sin envíos.', document: null } }); }
      return coworkDecisionSchema.parse({ action: 'lists.review_batch', leadIds: [leadId], query: null, leadId: null, answer: null });
    },
  });
  assert.equal(calls, 1); assert.match(result.reply, /sin envíos/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { coworkApolloPayload, coworkSearchCriteriaSchema } from './search-proposal';
import { runCoworkReadLoop } from './agent-loop';

const criteria = { titles: ['Gerente'], industries: [], locations: ['Chile'], limit: 10 };
test('criteria cap provider work and reject ownership or reveal overrides', () => {
  assert.equal(coworkSearchCriteriaSchema.safeParse({ ...criteria, user_id: 'other' }).success, false);
  assert.equal(coworkSearchCriteriaSchema.safeParse({ ...criteria, reveal_email: true }).success, false);
  assert.equal(coworkSearchCriteriaSchema.safeParse({ ...criteria, limit: 26 }).success, false);
  assert.equal(coworkSearchCriteriaSchema.safeParse({ titles: [], industries: [], locations: [], limit: 5 }).success, false);
  assert.equal(coworkApolloPayload(criteria, 'owner').reveal_email, false);
});
test('agent prepares external search without invoking provider tools', async () => {
  let proposed = false;
  const result = await runCoworkReadLoop({
    message: 'Busca contactos nuevos', signal: new AbortController().signal,
    authorize: async () => {},
    decide: async () => ({ action: 'prospecting.propose_search', query: null, leadId: null, answer: null, searchCriteria: criteria }),
    execute: async () => { throw new Error('Unexpected immediate execution'); }, record: async () => {},
    proposeSearch: async input => { assert.deepEqual(input, criteria); proposed = true; },
  });
  assert.equal(proposed, true); assert.match(result.reply, /Revisa/);
});

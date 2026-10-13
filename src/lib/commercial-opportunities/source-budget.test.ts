import assert from 'node:assert/strict';
import test from 'node:test';
import { opportunitySourceItemLimit } from './source-budget';

test('the secondary hiring channel can fetch ten items at the exact USD0.06 cap', () => {
  assert.equal(opportunitySourceItemLimit({ cap: .06, price: .005, start: .01, max: 100 }), 10);
  assert.equal(opportunitySourceItemLimit({ cap: .14, price: .005, start: .01, max: 100 }), 26);
});
test('post allocation includes start and every zero-result query before allocating items per query', () => {
  const input = { cap: .06, price: .002, start: .00005, queries: 3, emptyQuery: .001, max: 30 };
  const limit = opportunitySourceItemLimit(input);
  assert.equal(limit, 9);
  assert.ok(input.start + input.queries * (input.emptyQuery + limit * input.price) <= input.cap);
  assert.ok(input.start + input.queries * (input.emptyQuery + (limit + 1) * input.price) > input.cap);
});
test('caps, missing price and invalid rates cannot admit paid items', () => {
  const input = { cap: .06, price: .002, start: .00005, max: 30 };
  for (const patch of [{ price: NaN }, { price: 0 }, { start: -1 }, { emptyQuery: -1 }, { cap: Infinity }, { queries: 0 }, { queries: 1.5 }, { max: 0 }]) {
    assert.equal(opportunitySourceItemLimit({ ...input, ...patch }), 0);
  }
  assert.equal(opportunitySourceItemLimit({ ...input, cap: .00001 }), 0);
  assert.equal(opportunitySourceItemLimit({ ...input, cap: .75 }), 30);
});

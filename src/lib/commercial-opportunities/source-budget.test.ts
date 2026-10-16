import assert from 'node:assert/strict';
import test from 'node:test';
import { linkedinRunCap, linkedinWindow, opportunitySourceItemLimit } from './source-budget';

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

test('a LinkedIn search spends the most on the source the workspace put first, and still a useful amount on the other', () => {
  assert.equal(linkedinRunCap('hiring', 'hiring'), .4);
  assert.equal(linkedinRunCap('hiring', 'posts'), .15);
  assert.equal(linkedinRunCap('posts', 'posts'), .4);
  assert.equal(linkedinRunCap('balanced', 'hiring'), .3);
  assert.equal(opportunitySourceItemLimit({ cap: linkedinRunCap('hiring', 'hiring'), price: .005, start: .01, max: 100 }), 78);
  assert.equal(opportunitySourceItemLimit({ cap: linkedinRunCap('hiring', 'posts'), price: .002, start: .00005, queries: 5, emptyQuery: .001, max: 30 }), 14);
  assert.equal(opportunitySourceItemLimit({ cap: linkedinRunCap('hiring', 'posts'), price: .005, start: .01, max: 100 }), 28, 'ads as the second source: no longer just ten');
});

test('after a pause the search looks back far enough to leave no gap; run daily, it reads only what is new', () => {
  const now = Date.parse('2026-10-16T12:00:00Z');
  assert.equal(linkedinWindow('hiring', null, now), '7d');
  assert.equal(linkedinWindow('hiring', '2026-10-16T02:00:00Z', now), '24h');
  assert.equal(linkedinWindow('hiring', '2026-10-15T11:00:00Z', now), '7d');
  assert.equal(linkedinWindow('posts', null, now), 'month');
  assert.equal(linkedinWindow('posts', '2026-10-14T12:00:00Z', now), 'week');
  assert.equal(linkedinWindow('posts', '2026-10-01T12:00:00Z', now), 'month');
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { coworkThreadBudgets } from './thread-budget';

test('approval chains allow bounded automatic work', () => {
  assert.deepEqual(coworkThreadBudgets('approval', false),
    { maxDepth: 5, maxEffects: 6, maxSearches: 2, maxDrafts: 3 });
});

test('autonomous chains are tighter and never expand without the flag', () => {
  assert.deepEqual(coworkThreadBudgets('autonomous', true),
    { maxDepth: 3, maxEffects: 3, maxSearches: 1, maxDrafts: 2 });
  assert.deepEqual(coworkThreadBudgets('autonomous', false),
    { maxDepth: 5, maxEffects: 6, maxSearches: 2, maxDrafts: 3 });
});

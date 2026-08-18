import test from 'node:test';
import assert from 'node:assert/strict';

import { haveSameSelection, retainVisibleSelection } from '@/lib/leads-workspace/selection';

test('removes hidden rows from a bulk selection', () => {
  const selected = new Set(['lead-a', 'lead-b', 'lead-c']);
  const visible = ['lead-a', 'lead-c', 'lead-d'];

  assert.deepEqual(Array.from(retainVisibleSelection(selected, visible)), ['lead-a', 'lead-c']);
});

test('compares selections without depending on insertion order', () => {
  assert.equal(haveSameSelection(new Set(['a', 'b']), new Set(['b', 'a'])), true);
  assert.equal(haveSameSelection(new Set(['a']), new Set(['a', 'b'])), false);
});

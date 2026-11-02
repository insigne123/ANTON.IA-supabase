import assert from 'node:assert/strict';
import test from 'node:test';

import { DRAFT_QUEUE_MAX, DRAFT_QUEUE_MAX_AGE_MS, cleanQueueIds, composeDraftHref, parseDraftQueue, queueLabel, queuePlace } from './draft-queue';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('the queue keeps valid ids once each, in order, up to the limit', () => {
  assert.deepEqual(cleanQueueIds([id(2), 'nope', id(1), id(2), '']), [id(2), id(1)]);
  assert.equal(cleanQueueIds(Array.from({ length: DRAFT_QUEUE_MAX + 5 }, (_, n) => id(n + 1))).length, DRAFT_QUEUE_MAX);
});

test('a stored queue is read back only while it is fresh and well formed', () => {
  const now = Date.parse('2026-11-02T12:00:00Z');
  const stored = JSON.stringify({ ids: [id(1), id(2), id(3)], savedAt: now - 60_000 });
  assert.deepEqual(parseDraftQueue(stored, now), { ids: [id(1), id(2), id(3)], savedAt: now - 60_000 });
  assert.equal(parseDraftQueue(JSON.stringify({ ids: [id(1)], savedAt: now - DRAFT_QUEUE_MAX_AGE_MS - 1 }), now), null, 'left behind');
  assert.equal(parseDraftQueue('{not json', now), null);
  assert.equal(parseDraftQueue(JSON.stringify({ ids: ['x'], savedAt: now }), now), null, 'no valid id');
  assert.equal(parseDraftQueue(null, now), null);
});

test('where a draft is in the series, and which one comes next', () => {
  const queue = { ids: [id(1), id(2), id(3)], savedAt: 0 };
  assert.deepEqual(queuePlace(queue, id(2)), { position: 2, total: 3, nextId: id(3) });
  assert.deepEqual(queuePlace(queue, id(3)), { position: 3, total: 3, nextId: null }, 'the last one has no next');
  assert.equal(queuePlace(queue, id(9)), null, 'a draft opened from elsewhere is not in the series');
  assert.equal(queuePlace(null, id(1)), null);
  assert.equal(queueLabel({ position: 2, total: 5, nextId: null }), 'Borrador 2 de 5');
  assert.equal(composeDraftHref(id(1)), `/contact/compose?draftId=${id(1)}`);
});

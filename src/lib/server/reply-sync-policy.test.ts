import assert from 'node:assert/strict';
import test from 'node:test';
import { replySyncDueFilter } from './reply-sync-policy';

test('due filter cools down failed threads without starving healthy ones', () => {
  const filter = replySyncDueFilter(Date.parse('2026-09-23T00:00:00.000Z'));
  assert.match(filter, /reply_sync_attempted_at\.is\.null/);
  assert.ok(filter.includes('reply_sync_attempted_at.lt.2026-09-22T23:55:00.000Z'));
  assert.ok(filter.includes('reply_sync_attempted_at.lt.2026-09-22T00:00:00.000Z'));
  assert.ok(filter.includes('reply_sync_attempted_at.lt.2026-09-22T18:00:00.000Z'));
  assert.ok(filter.includes('reply_sync_attempted_at.lt.2026-09-22T23:00:00.000Z'));
  assert.match(filter, /incomplete_thread/);
  assert.match(filter, /connection_required/);
});

test('due filter is server-generated grammar with no client input', () => {
  const filter = replySyncDueFilter();
  assert.doesNotMatch(filter, /[;'"\\]/);
  assert.match(filter, /^[\w.,():=-]+$/);
});

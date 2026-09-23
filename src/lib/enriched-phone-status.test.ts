import assert from 'node:assert/strict';
import test from 'node:test';
import { hasActivePhoneLookup } from './enriched-phone-status';

const now = Date.parse('2026-09-23T12:00:00Z');

test('generic pending enrichments and old phone searches are not shown as endlessly active', () => {
  assert.equal(hasActivePhoneLookup({ enrichmentStatus: 'pending', updatedAt: '2026-09-23T11:00:00Z' }, now), false);
  assert.equal(hasActivePhoneLookup({ enrichmentStatus: 'pending_phone', updatedAt: '2026-09-13T11:00:00Z' }, now), false);
  assert.equal(hasActivePhoneLookup({ enrichmentStatus: 'pending_phone' }, now), false);
  assert.equal(hasActivePhoneLookup({ enrichmentStatus: 'pending_phone', updatedAt: '2026-09-23T11:00:00Z' }, now), true);
});

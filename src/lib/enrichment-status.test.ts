import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isPendingEnrichmentStatus,
  pendingEnrichmentKind,
  pendingEnrichmentStatus,
} from '@/lib/enrichment-status';

test('records which contact data is pending', () => {
  assert.equal(pendingEnrichmentStatus({ revealEmail: true, revealPhone: false }), 'pending_email');
  assert.equal(pendingEnrichmentStatus({ revealEmail: false, revealPhone: true }), 'pending_phone');
  assert.equal(pendingEnrichmentStatus({ revealEmail: true, revealPhone: true }), 'pending_contact');
});

test('keeps legacy pending records refreshable without guessing their requested field', () => {
  assert.equal(pendingEnrichmentKind('pending_email'), 'email');
  assert.equal(pendingEnrichmentKind('pending_phone'), 'phone');
  assert.equal(pendingEnrichmentKind('pending_contact'), 'contact');
  assert.equal(pendingEnrichmentKind('pending'), 'unknown');
  assert.equal(isPendingEnrichmentStatus('pending'), true);
  assert.equal(isPendingEnrichmentStatus('completed'), false);
});

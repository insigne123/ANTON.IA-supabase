import test from 'node:test';
import assert from 'node:assert/strict';

import {
  hasUsableLinkedInProfileData,
  partitionLinkedInProfileLeads,
} from '@/lib/linkedin-profile-result';
import type { Lead } from '@/lib/schemas/leads';

test('rejects a LinkedIn profile tracking row without profile data', () => {
  const trackingRow: Lead = {
    id: 'tracking-1',
    linkedin_url: 'https://www.linkedin.com/in/example',
    enrichment_status: 'pending',
  };

  assert.equal(hasUsableLinkedInProfileData(trackingRow), false);
  assert.deepEqual(partitionLinkedInProfileLeads([trackingRow]), {
    profileLeads: [],
    trackingIds: ['tracking-1'],
  });
});

test('accepts identity or direct contact data as a usable profile', () => {
  assert.equal(hasUsableLinkedInProfileData({ id: 'person-1', name: 'Jane Doe' }), true);
  assert.equal(hasUsableLinkedInProfileData({ id: 'person-2', primary_phone: '+56912345678' }), true);
  assert.equal(hasUsableLinkedInProfileData({ id: 'person-3', email: 'email_not_unlocked@domain.com' }), false);
});

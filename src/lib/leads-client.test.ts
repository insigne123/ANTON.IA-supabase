import assert from 'node:assert/strict';
import test from 'node:test';

import { searchLinkedInProfileLead } from '@/lib/leads-client';

function mockEnrichmentResponse(payload: Record<string, unknown>) {
  return async () => Response.json({
    queued: false,
    operationId: 'profile-match:test',
    operationStatus: 'completed',
    enriched: [payload],
  });
}

test('LinkedIn profile search surfaces exhausted Apollo credits', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockEnrichmentResponse({
    id: 'tracking-1',
    enrichmentStatus: 'failed',
    errorCode: 'APOLLO_CREDITS_EXHAUSTED',
  });
  try {
    await assert.rejects(
      () => searchLinkedInProfileLead({
        search_mode: 'linkedin_profile',
        linkedin_url: 'https://www.linkedin.com/in/example',
      }),
      /Apollo no tiene créditos disponibles/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('LinkedIn profile search does not render a not-found tracking row', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockEnrichmentResponse({
    id: 'tracking-1',
    enrichmentStatus: 'not_found',
    linkedinUrl: 'https://www.linkedin.com/in/example',
  });
  try {
    const result = await searchLinkedInProfileLead({
      search_mode: 'linkedin_profile',
      linkedin_url: 'https://www.linkedin.com/in/example',
    });
    assert.equal(result.count, 0);
    assert.deepEqual(result.leads, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('LinkedIn profile search returns professional profile fields', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockEnrichmentResponse({
    id: 'person-1',
    fullName: 'Ana Perez',
    firstName: 'Ana',
    lastName: 'Perez',
    title: 'HR Director',
    companyName: 'People Co',
    industry: 'Human Resources',
    city: 'Santiago',
    country: 'Chile',
    enrichmentStatus: 'completed',
  });
  try {
    const result = await searchLinkedInProfileLead({
      search_mode: 'linkedin_profile',
      linkedin_url: 'https://www.linkedin.com/in/example',
    });
    assert.equal(result.count, 1);
    assert.equal(result.leads[0]?.name, 'Ana Perez');
    assert.equal(result.leads[0]?.last_name, 'Perez');
    assert.equal(result.leads[0]?.title, 'HR Director');
    assert.equal(result.leads[0]?.organization_industry, 'Human Resources');
    assert.equal(result.leads[0]?.city, 'Santiago');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

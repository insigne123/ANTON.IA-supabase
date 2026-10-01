import assert from 'node:assert/strict';
import test from 'node:test';

import { searchLinkedInProfileLead } from '@/lib/leads-client';
import { ProfileSearchProblemError } from '@/lib/search/profile-search-outcome';

function mockEnrichmentResponse(
  payload: Record<string, unknown>,
  metadata: Record<string, unknown> = {},
) {
  return async () => Response.json({
    queued: false,
    operationId: 'profile-match:test',
    operationStatus: 'completed',
    ...metadata,
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

test('LinkedIn profile search reports a not-found profile as its own problem, not as an empty row', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockEnrichmentResponse({
    id: 'tracking-1',
    enrichmentStatus: 'not_found',
    linkedinUrl: 'https://www.linkedin.com/in/example',
  });
  try {
    await assert.rejects(
      () => searchLinkedInProfileLead({ search_mode: 'linkedin_profile', linkedin_url: 'https://www.linkedin.com/in/example' }),
      (error: unknown) => error instanceof ProfileSearchProblemError && error.problem === 'not_found',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a provider outage is reported as such and is not retried into a false «no data»', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return Response.json({ queued: false, operationId: 'profile-match:down', operationStatus: 'completed',
      enriched: [{ id: 'tracking-1', enrichmentStatus: 'failed', errorCode: 'APOLLO_UPSTREAM_ERROR' }] });
  };
  try {
    await assert.rejects(
      () => searchLinkedInProfileLead({ search_mode: 'linkedin_profile', linkedin_url: 'https://www.linkedin.com/in/example', reveal_email: true }),
      (error: unknown) => error instanceof ProfileSearchProblemError && error.problem === 'provider_unavailable',
    );
    assert.equal(calls, 1);
    globalThis.fetch = async () => Response.json({ error: 'APOLLO_UPSTREAM_ERROR' }, { status: 503 });
    await assert.rejects(
      () => searchLinkedInProfileLead({ search_mode: 'linkedin_profile', linkedin_url: 'https://www.linkedin.com/in/example' }),
      (error: unknown) => error instanceof ProfileSearchProblemError && error.problem === 'provider_unavailable',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a Sales Navigator link is refused before any request, with its own problem', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return Response.json({}); };
  try {
    await assert.rejects(
      () => searchLinkedInProfileLead({ search_mode: 'linkedin_profile', linkedin_url: 'https://www.linkedin.com/sales/lead/ACwAAA123' }),
      (error: unknown) => error instanceof ProfileSearchProblemError && error.problem === 'sales_navigator_url',
    );
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('the returned profile matches the requested one ignoring accents', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockEnrichmentResponse({
    id: 'person-1', fullName: 'Laura Sofía Sotelo Torres', title: 'Jefa de Selección', companyName: 'Retail Sur',
    linkedinUrl: 'http://www.linkedin.com/in/laura-sofia-sotelo-torres-47423735', enrichmentStatus: 'completed',
  });
  try {
    const result = await searchLinkedInProfileLead({ search_mode: 'linkedin_profile',
      linkedin_url: 'https://cl.linkedin.com/in/laura-sof%C3%ADa-sotelo-torres-47423735/' });
    assert.equal(result.count, 1);
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

test('LinkedIn profile search preserves accented profile identity for Apollo matching', async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: any = null;
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body || '{}'));
    return Response.json({
      queued: false,
      operationId: 'profile-match:accented',
      operationStatus: 'completed',
      enriched: [{ id: 'person-1', fullName: 'Laura Sofía Sotelo Torres', enrichmentStatus: 'completed' }],
    });
  };
  try {
    await searchLinkedInProfileLead({
      search_mode: 'linkedin_profile',
      linkedin_url: 'https://cl.linkedin.com/in/laura-sof%C3%ADa-sotelo-torres-47423735/?trk=public_profile',
      reveal_email: true,
    });
    assert.equal(
      requestBody?.leads?.[0]?.linkedinUrl,
      'https://www.linkedin.com/in/laura-sof%C3%ADa-sotelo-torres-47423735',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('LinkedIn profile search forwards queued phone enrichment metadata for polling', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockEnrichmentResponse(
    {
      id: 'profile-target-1',
      fullName: 'Ana Perez',
      title: 'HR Director',
      linkedinUrl: 'https://www.linkedin.com/in/example',
      enrichmentStatus: 'pending_phone',
    },
    {
      queued: true,
      operationStatus: 'submitted',
      phone_enrichment: {
        requested: true,
        queued: true,
        status: 'queued',
        message: 'El telefono se esta preparando y se actualizara automaticamente.',
        webhook_url: null,
        provider_status: null,
        provider_details: null,
      },
    },
  );
  try {
    const result = await searchLinkedInProfileLead({
      search_mode: 'linkedin_profile',
      linkedin_url: 'https://www.linkedin.com/in/example',
      reveal_email: true,
      reveal_phone: true,
    });
    assert.equal(result.phone_enrichment?.status, 'queued');
    assert.deepEqual(result.profile_tracking_ids, ['profile-target-1']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('LinkedIn profile search recovers an occupied target and keeps it pollable', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({
    error: 'APOLLO_ENRICHMENT_TARGET_BUSY',
    operationId: 'profile-match:retry',
    operationStatus: 'submitted',
    providerState: 'processing',
    queued: true,
    enriched: [{ id: 'profile-target-1', enrichmentStatus: 'pending_phone' }],
    phone_enrichment: {
      requested: true,
      queued: true,
      status: 'queued',
      message: 'El telefono se esta preparando y se actualizara automaticamente.',
      webhook_url: null,
      provider_status: null,
      provider_details: null,
    },
  }, { status: 409 });
  try {
    const result = await searchLinkedInProfileLead({
      search_mode: 'linkedin_profile',
      linkedin_url: 'https://www.linkedin.com/in/example',
      reveal_email: true,
      reveal_phone: true,
    });
    assert.equal(result.count, 0);
    assert.deepEqual(result.leads, []);
    assert.equal(result.phone_enrichment?.status, 'queued');
    assert.deepEqual(result.profile_tracking_ids, ['profile-target-1']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('LinkedIn profile search fails loudly instead of rendering an empty failed row', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({
    queued: true,
    operationId: 'profile-match:failed',
    operationStatus: 'submitted',
    providerRequested: 'apollo',
    providerUsed: 'apollo',
    requestedData: { email: true, phone: true },
    enriched: [{ id: 'profile-target-1', enrichmentStatus: 'failed' }],
    phone_enrichment: {
      requested: true,
      queued: false,
      status: 'failed',
      message: 'El proveedor no pudo completar la busqueda del telefono.',
      webhook_url: null,
      provider_status: null,
      provider_details: null,
    },
  });
  try {
    await assert.rejects(
      () => searchLinkedInProfileLead({
        search_mode: 'linkedin_profile',
        linkedin_url: 'https://www.linkedin.com/in/example',
        reveal_email: true,
        reveal_phone: true,
      }),
      /APOLLO_PROFILE_NO_USABLE_DATA/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test('a terminal no-phone result without profile data retries professional-only before rejecting', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_input, init) => {
    calls += 1;
    const requested = JSON.parse(String(init?.body || '{}'));
    if (calls === 1) {
      assert.equal(requested.revealPhone, true);
      return Response.json({
        queued: false,
        operationId: 'profile-match:no-phone',
        operationStatus: 'completed',
        enriched: [{ id: 'profile-target-1', enrichmentStatus: 'no_phone' }],
        phone_enrichment: { requested: true, queued: false, status: 'failed' },
      });
    }
    assert.equal(requested.revealEmail, false);
    assert.equal(requested.revealPhone, false);
    return Response.json({
      queued: false,
      operationId: 'profile-match:professional-only',
      operationStatus: 'completed',
      enriched: [{ id: 'profile-target-1', enrichmentStatus: 'no_phone' }],
      phone_enrichment: { requested: false, queued: false, status: 'not_requested' },
    });
  };
  try {
    await assert.rejects(
      () => searchLinkedInProfileLead({
        search_mode: 'linkedin_profile',
        linkedin_url: 'https://www.linkedin.com/in/example',
        reveal_email: true,
        reveal_phone: true,
      }),
      /APOLLO_PROFILE_NO_USABLE_DATA/,
    );
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test('professional-only retry shows the profile when Apollo has identity but no contact', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return calls === 1 ? Response.json({
      queued: false,
      operationId: 'profile-match:no-contact',
      operationStatus: 'completed',
      enriched: [{ id: 'profile-target-1', enrichmentStatus: 'no_phone' }],
      phone_enrichment: { requested: true, queued: false, status: 'failed' },
    }) : Response.json({
      queued: false,
      operationId: 'profile-match:professional-only',
      operationStatus: 'completed',
      enriched: [{ id: 'person-1', fullName: 'Ana Perez', title: 'HR Director', companyName: 'People Co',
        linkedinUrl: 'https://www.linkedin.com/in/example', enrichmentStatus: 'completed' }],
      phone_enrichment: { requested: false, queued: false, status: 'not_requested' },
    });
  };
  try {
    const result = await searchLinkedInProfileLead({
      search_mode: 'linkedin_profile',
      linkedin_url: 'https://www.linkedin.com/in/example',
      reveal_email: true,
      reveal_phone: true,
    });
    assert.equal(calls, 2);
    assert.equal(result.count, 1);
    assert.equal(result.leads[0]?.name, 'Ana Perez');
    assert.deepEqual(result.provider_warnings, ['APOLLO_PROFESSIONAL_ONLY']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test('profile URL search never displays a different LinkedIn person returned by the API', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockEnrichmentResponse({ id:'wrong-profile',fullName:'Marco Psenda',
    linkedinUrl:'https://www.linkedin.com/in/marco-psenda',email:'other@example.com',enrichmentStatus:'completed' });
  try {
    await assert.rejects(() => searchLinkedInProfileLead({search_mode:'linkedin_profile',
      linkedin_url:'https://www.linkedin.com/in/it-recruiter-janet-montero/'}), /perfil distinto/);
  } finally { globalThis.fetch = originalFetch; }
});
test('profile identity refusal is shown explicitly instead of an unrelated or empty profile', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockEnrichmentResponse({ id: 'tracking', enrichmentStatus: 'failed', errorCode: 'APOLLO_PERSON_IDENTITY_MISMATCH' });
  try {
    await assert.rejects(() => searchLinkedInProfileLead({search_mode: 'linkedin_profile',
      linkedin_url: 'https://www.linkedin.com/in/it-recruiter-janet-montero/'}), /No pudimos confirmar/);
  } finally { globalThis.fetch = originalFetch; }
});

test('an ambiguous provider outcome without phone reveal remains trackable without inventing a lead', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return Response.json({
      error: 'ENRICHMENT_PROVIDER_OUTCOME_UNKNOWN',
      operationStatus: 'submitted', providerState: 'unknown', queued: true,
      enriched: [{ id: 'profile-pending' }],
    }, { status: 409 });
  };
  try {
    const result = await searchLinkedInProfileLead({ search_mode: 'linkedin_profile',
      linkedin_url: 'https://www.linkedin.com/in/example', reveal_email: true, reveal_phone: false });
    assert.equal(calls, 1, 'an ambiguous charge must not be submitted again');
    assert.equal(result.profile_pending, true);
    assert.equal(result.count, 0);
    assert.deepEqual(result.leads, []);
    assert.deepEqual(result.profile_tracking_ids, ['profile-pending']);
  } finally { globalThis.fetch = originalFetch; }
});

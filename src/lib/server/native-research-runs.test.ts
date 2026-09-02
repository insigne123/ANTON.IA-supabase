import assert from 'node:assert/strict';
import test from 'node:test';

import { nativeResearchRunInternals } from './native-research-runs';

test('reprocess selects the latest usable lead payload once and preserves enriched identity', () => {
  const leads = nativeResearchRunInternals.latestReprocessableLeads([
    {
      lead_id: 'lead-ana',
      lead_ref: 'lead-ana',
      request_payload: {
        lead: {
          id: 'lead-ana',
          fullName: 'Ana Silva',
          email: 'ana@acme.com',
          headline: 'Operaciones en Acme',
          departments: ['operations'],
          companyName: 'Acme',
          companyDomain: 'acme.com',
          organizationIndustry: 'Software',
          organizationSize: 120,
        },
      },
    },
    {
      lead_id: 'lead-ana',
      lead_ref: 'lead-ana',
      request_payload: { lead: { id: 'lead-ana', email: 'old@acme.com', companyName: 'Acme' } },
    },
    {
      lead_ref: 'lead-bruno',
      email: 'bruno@beta.com',
      company_name: 'Beta',
      company_domain: 'beta.com',
      result_payload: { lead: { id: 'lead-bruno', fullName: 'Bruno Díaz', email: 'bruno@beta.com', companyName: 'Beta', companyDomain: 'beta.com' } },
    },
    { lead_ref: 'invalid', request_payload: { lead: {} } },
  ], 50);

  assert.equal(leads.length, 2);
  assert.equal(leads[0].id, 'lead-ana');
  assert.equal(leads[0].headline, 'Operaciones en Acme');
  assert.deepEqual(leads[0].departments, ['operations']);
  assert.equal(leads[1].id, 'lead-bruno');
});

test('run request keys dedupe equivalent selections without preventing a later refresh', () => {
  const access = { organizationId: 'org-1', userId: 'user-1' };
  const leads = [
    { id: 'lead-ana', companyName: 'Acme' },
    { id: 'lead-bruno', companyName: 'Beta' },
    { id: 'lead-ana', companyName: 'Acme' },
  ];
  const unique = nativeResearchRunInternals.uniqueLeads(leads);
  const options = { depth: 'deep' as const, language: 'es', refresh: true };
  const first = nativeResearchRunInternals.nativeResearchRunRequestKey({ access, leads: unique, options, now: 120_000 });
  const reordered = nativeResearchRunInternals.nativeResearchRunRequestKey({ access, leads: [...unique].reverse(), options, now: 120_000 });
  const later = nativeResearchRunInternals.nativeResearchRunRequestKey({ access, leads: unique, options, now: 240_000 });

  assert.deepEqual(unique.map((lead) => lead.id), ['lead-ana', 'lead-bruno']);
  assert.equal(first, reordered);
  assert.notEqual(first, later);
});

test('explicit refresh identities do not reuse a terminal job in the same freshness window', () => {
  const access = { organizationId: 'org-1', userId: 'user-1' };
  const leads = [{ id: 'lead-ana', companyName: 'Acme' }];
  const options = { depth: 'deep' as const, language: 'es', refresh: true };

  const firstRetry = nativeResearchRunInternals.nativeResearchRunRequestKey({
    access,
    leads,
    options,
    now: 120_000,
    refreshIdentity: 'retry-one',
  });
  const secondRetry = nativeResearchRunInternals.nativeResearchRunRequestKey({
    access,
    leads,
    options,
    now: 120_000,
    refreshIdentity: 'retry-two',
  });

  assert.notEqual(firstRetry, secondRetry);
});

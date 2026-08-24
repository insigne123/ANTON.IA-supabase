import assert from 'node:assert/strict';
import test from 'node:test';
import { getGatewayConfig } from './gateway';
import { validateEnrichmentInput, validateLeadSearchInput } from './validation';

test('lead search validation requires filters and caps requested provider results', () => {
  const config = getGatewayConfig({ APOLLO_BACKEND_MAX_SEARCH_RESULTS: '100' });
  const empty = validateLeadSearchInput({ search_mode: 'batch' }, config);
  assert.equal(empty.ok, false);

  const capped = validateLeadSearchInput({
    search_mode: 'batch',
    titles: ['Founder'],
    max_results: 500,
  }, config);
  assert.equal(capped.ok, true);
  if (capped.ok) assert.equal(capped.value.maxResults, 100);

  const valid = validateLeadSearchInput({
    search_mode: 'batch',
    titles: ['Founder'],
    industry_keywords: ['software'],
    max_results: 5_001,
  }, config);
  assert.equal(valid.ok, false);
});

test('company searches accept the root BFF selected-organization payload and retain its domain', () => {
  const config = getGatewayConfig({ APOLLO_BACKEND_MAX_SEARCH_RESULTS: '100' });
  const company = validateLeadSearchInput({
    search_mode: 'company_name',
    company_name: 'Example Company',
    selected_organization_id: 'apollo-organization-id',
    selected_organization_name: 'Example Company',
    selected_organization_domain: 'example.com',
    selected_organization_website: 'https://example.com',
    selected_organization_industry: 'Software',
    selected_organization_size: 100,
  }, config);

  assert.equal(company.ok, true);
  if (company.ok) assert.deepEqual(company.value.organizationDomains, ['example.com']);
});

test('enrichment validation rejects conflicting aliases and broad provider matches', () => {
  const conflictingFlags = validateEnrichmentInput({
    lead: { id: 'apollo-person-id' },
    reveal_email: true,
    revealEmail: false,
  });
  assert.equal(conflictingFlags.ok, false);

  const broadMatch = validateEnrichmentInput({
    lead: {},
    reveal_email: true,
  });
  assert.equal(broadMatch.ok, false);

  const valid = validateEnrichmentInput({
    lead: { id: 'apollo-person-id' },
    reveal_email: true,
    reveal_phone: false,
    enrichment_level: 'basic',
    requested_data: { email: true, phone: false },
    requested_fields: ['email'],
  });
  assert.equal(valid.ok, true);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { getGatewayConfig } from './gateway';
import {
  normalizeEmployeeRange,
  validateEnrichmentInput,
  validateLeadSearchInput,
  validateOrganizationEnrichmentInput,
} from './validation';

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

test('lead search validation only accepts Apollo', () => {
  const apolloConfig = getGatewayConfig({ LEADS_PROVIDER_DEFAULT: 'apollo' });
  const defaulted = validateLeadSearchInput({
    search_mode: 'batch',
    titles: ['Founder'],
  }, apolloConfig);
  assert.equal(defaulted.ok, true);
  if (defaulted.ok) assert.equal(defaulted.value.provider, 'apollo');

  const rejectedFullEnrich = validateLeadSearchInput({
    provider: 'fullenrich',
    search_mode: 'batch',
    titles: ['Founder'],
  }, apolloConfig);
  assert.equal(rejectedFullEnrich.ok, false);

  const unsupported = validateLeadSearchInput({
    provider: 'unknown',
    search_mode: 'batch',
    titles: ['Founder'],
  }, apolloConfig);
  assert.equal(unsupported.ok, false);
});

test('company searches accept selected-organization metadata but use its id as the provider filter', () => {
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
  if (company.ok) {
    assert.deepEqual(company.value.organizationDomains, []);
    assert.equal(company.value.selectedOrganizationId, 'apollo-organization-id');
  }
});

test('lead search normalizes employee ranges and keeps firmographic filters separate', () => {
  const config = getGatewayConfig({ APOLLO_BACKEND_MAX_SEARCH_RESULTS: '100' });
  const result = validateLeadSearchInput({
    search_mode: 'batch',
    industry_keywords: ['Human Resources'],
    company_keywords: ['payroll'],
    company_location: ['Chile'],
    person_locations: ['Santiago'],
    employee_ranges: ['51-200', '5001+'],
    include_similar_titles: false,
  }, config);

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.value.employeeRanges, ['51,200', '5001,10000000']);
    assert.deepEqual(result.value.industryKeywords, ['Human Resources']);
    assert.deepEqual(result.value.companyKeywords, ['payroll']);
    assert.deepEqual(result.value.personLocations, ['Santiago']);
    assert.equal(result.value.includeSimilarTitles, false);
  }
  assert.equal(normalizeEmployeeRange('1,10'), '1,10');
  assert.equal(normalizeEmployeeRange('10-200 empleados'), '10,200');
  assert.equal(normalizeEmployeeRange('10000001+'), null);
  assert.equal(normalizeEmployeeRange('1-10000001'), null);
  assert.equal(normalizeEmployeeRange('invalid'), null);
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
    lead: { source_provider_id: 'apollo-person-id' },
    reveal_email: true,
    reveal_phone: false,
    enrichment_level: 'basic',
    requested_data: { email: true, phone: false },
    requested_fields: ['email'],
  });
  assert.equal(valid.ok, true);

  const phoneWithoutWebhook = validateEnrichmentInput({
    lead: { source_provider_id: 'apollo-person-id' },
    reveal_email: false,
    reveal_phone: true,
    enrichment_level: 'deep',
  });
  assert.equal(phoneWithoutWebhook.ok, false);

  const phoneWithWebhook = validateEnrichmentInput({
    lead: { source_provider_id: 'apollo-person-id' },
    reveal_email: false,
    reveal_phone: true,
    enrichment_level: 'deep',
    webhook_url: 'https://studio.example.com/api/apollo-webhook/token',
  });
  assert.equal(phoneWithWebhook.ok, true);
});

test('organization enrichment accepts one normalized domain and no extra selectors', () => {
  const valid = validateOrganizationEnrichmentInput({ domain: 'https://www.people.co/about' });
  assert.equal(valid.ok, true);
  if (valid.ok) assert.equal(valid.value.domain, 'people.co');
  assert.equal(validateOrganizationEnrichmentInput({ domain: 'People Co' }).ok, false);
  assert.equal(validateOrganizationEnrichmentInput({ domain: 'people.co', organization_id: 'org-1' }).ok, false);
});

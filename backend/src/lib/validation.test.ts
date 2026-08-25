import assert from 'node:assert/strict';
import test from 'node:test';
import { getGatewayConfig } from './gateway';
import { normalizeApolloEmployeeRange, validateEnrichmentInput, validateLeadSearchInput } from './validation';

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
  assert.equal(normalizeApolloEmployeeRange('1,10'), '1,10');
  assert.equal(normalizeApolloEmployeeRange('10-200 empleados'), '10,200');
  assert.equal(normalizeApolloEmployeeRange('10000001+'), null);
  assert.equal(normalizeApolloEmployeeRange('1-10000001'), null);
  assert.equal(normalizeApolloEmployeeRange('invalid'), null);
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

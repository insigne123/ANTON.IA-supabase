import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./route.ts', import.meta.url), 'utf8');

test('lead-search BFF supplies the backend secret only from server runtime configuration', () => {
  assert.match(source, /process\.env\.ENRICHMENT_SERVICE_SECRET/);
  assert.match(source, /"x-api-secret-key": backendSecret/);
  assert.match(source, /BACKEND_AUTH_NOT_CONFIGURED/);
  assert.doesNotMatch(source, /NEXT_PUBLIC_ENRICHMENT_SERVICE_SECRET/);
});

test('lead-search BFF keeps firmographic filters distinct and disables batch enrichment', () => {
  assert.match(source, /industry_keywords: currentParams\.industry_keywords/);
  assert.match(source, /company_keywords: currentParams\.company_keywords/);
  assert.match(source, /company_location: currentParams\.company_location/);
  assert.match(source, /person_locations: currentParams\.person_locations/);
  assert.match(source, /employee_ranges: currentParams\.employee_ranges/);
  assert.doesNotMatch(source, /enrich:\s*true/);
});

test('company search BFF forwards selection identity without untrusted metadata', () => {
  assert.match(source, /selected_organization_id:/);
  assert.doesNotMatch(source, /selected_organization_domain:\s*normalizeDomainList/);
  assert.doesNotMatch(source, /selected_organization_website:\s*String/);
  assert.doesNotMatch(source, /selected_organization_industry:\s*String/);
  assert.doesNotMatch(source, /selected_organization_size:\s*companyReq/);
});

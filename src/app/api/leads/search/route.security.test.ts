import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./route.ts', import.meta.url), 'utf8');
const clientSource = readFileSync(new URL('../../../../lib/leads-client.ts', import.meta.url), 'utf8');
const searchPageSource = readFileSync(new URL('../../../(app)/search/page.tsx', import.meta.url), 'utf8');

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

test('profile search queues requested contact data and polls the persisted profile', () => {
  assert.match(clientSource, /tableName: 'people_search_leads'/);
  assert.match(clientSource, /'Idempotency-Key': input\.operationId/);
  assert.match(clientSource, /linkedinUrl: input\.linkedinUrl/);
  assert.match(clientSource, /json\?\.error === 'ENRICHMENT_PROVIDER_OUTCOME_UNKNOWN'/);
  assert.match(searchPageSource, /await enrichLinkedInProfileLead\(/);
  assert.match(searchPageSource, /const profile: Lead = result\.leads\[0\]\s+\?/);
  assert.match(searchPageSource, /getLinkedinProfileDisplayName\(filters\.linkedinUrl\)/);
  assert.match(searchPageSource, /count: 1,[\s\S]*leads_count: 1,[\s\S]*leads: \[profile\]/);
  assert.match(searchPageSource, /reveal_email: false,[\s\S]*reveal_phone: false/);
  assert.match(searchPageSource, /profile_tracking_ids: \[trackingId\]/);
  assert.match(searchPageSource, /result\.leads\.length > 0[\s\S]*\[queuedLead\]/);
  assert.match(searchPageSource, /await getLinkedInProfileStatuses\(profilePhonePollingIds/);
  assert.match(searchPageSource, /emailSatisfied && phoneSatisfied && !isPendingEnrichmentStatus\(status\)/);
  assert.doesNotMatch(searchPageSource, /getLinkedInProfileLead\(/);
});

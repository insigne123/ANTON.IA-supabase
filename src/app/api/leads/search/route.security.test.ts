import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./route.ts', import.meta.url), 'utf8');
const batchPayloadSource = readFileSync(new URL('../../../../lib/server/lead-search-payload.ts', import.meta.url), 'utf8');
const clientSource = readFileSync(new URL('../../../../lib/leads-client.ts', import.meta.url), 'utf8');
const searchPageSource = readFileSync(new URL('../../../(app)/search/page.tsx', import.meta.url), 'utf8');
const profileStatusSource = readFileSync(new URL('../profile-status/route.ts', import.meta.url), 'utf8');
const enrichmentSource = readFileSync(new URL('../../opportunities/enrich-apollo/route.ts', import.meta.url), 'utf8');
const organizationEnrichmentSource = readFileSync(new URL('../../organizations/enrich-apollo/route.ts', import.meta.url), 'utf8');
const workerSource = readFileSync(new URL('../../cron/antonia/route.ts', import.meta.url), 'utf8');

test('lead-search BFF supplies the backend secret only from server runtime configuration', () => {
  assert.match(source, /process\.env\.ENRICHMENT_SERVICE_SECRET/);
  assert.match(source, /"x-api-secret-key": backendSecret/);
  assert.match(source, /BACKEND_AUTH_NOT_CONFIGURED/);
  assert.doesNotMatch(source, /NEXT_PUBLIC_ENRICHMENT_SERVICE_SECRET/);
});

test('lead-search BFF keeps firmographic filters distinct and disables batch enrichment', () => {
  assert.match(source, /buildBatchLeadSearchPayload\(currentParams/);
  assert.match(batchPayloadSource, /industry_keywords: currentParams\.industry_keywords/);
  assert.match(batchPayloadSource, /company_keywords: currentParams\.company_keywords/);
  assert.match(batchPayloadSource, /company_location: currentParams\.company_location/);
  assert.match(batchPayloadSource, /person_locations: currentParams\.person_locations/);
  assert.match(batchPayloadSource, /employee_ranges: currentParams\.employee_ranges/);
  assert.doesNotMatch(batchPayloadSource, /employee_range:/);
  assert.doesNotMatch(source, /enrich:\s*true/);
  assert.doesNotMatch(source, /\(body as any\)\?\.provider|body\?\.\[0\].*provider/);
  assert.doesNotMatch(source, /enrichmentSearchCreditsUnavailablePayload/);
  assert.match(source, /organization_search_credits/);
});

test('company search BFF forwards selection identity without untrusted metadata', () => {
  assert.match(source, /selected_organization_id:/);
  assert.doesNotMatch(source, /selected_organization_domain:\s*normalizeDomainList/);
  assert.doesNotMatch(source, /selected_organization_website:\s*String/);
  assert.doesNotMatch(source, /selected_organization_industry:\s*String/);
  assert.doesNotMatch(source, /selected_organization_size:\s*companyReq/);
});

test('profile search uses one idempotent enrichment request and polls the persisted profile', () => {
  assert.match(clientSource, /tableName: 'people_search_leads'/);
  assert.match(clientSource, /'Idempotency-Key': input\.operationId/);
  assert.match(clientSource, /linkedinUrl: input\.linkedinUrl/);
  assert.match(clientSource, /json\?\.error === 'ENRICHMENT_PROVIDER_OUTCOME_UNKNOWN'/);
  assert.match(clientSource, /const result = await enrichLinkedInProfileLead\(/);
  assert.match(clientSource, /profile-match:\$\{crypto\.randomUUID\(\)\}/);
  assert.match(searchPageSource, /reveal_email: filters\.revealEmail,[\s\S]*reveal_phone: filters\.revealPhone/);
  assert.doesNotMatch(searchPageSource, /await enrichLinkedInProfileLead\(/);
  assert.match(source, /LINKEDIN_PROFILE_REQUIRES_ENRICHMENT/);
  assert.match(searchPageSource, /await getLinkedInProfileStatuses\(profilePhonePollingIds/);
  assert.match(searchPageSource, /emailSatisfied && phoneSatisfied && !isPendingEnrichmentStatus\(status\)/);
  assert.doesNotMatch(searchPageSource, /getLinkedInProfileLead\(/);
  assert.match(enrichmentSource, /phone_enrichment: phoneEnrichmentResponse\(/);
  assert.match(clientSource, /phone_enrichment: result\.phone_enrichment/);
});

test('Apollo search, enrichment, and polling stay inside the active tenant and actor', () => {
  assert.match(source, /requireSessionOrTrustedInternalRequest\(req\)/);
  assert.doesNotMatch(source, /resolveOrganizationIdForUser/);
  assert.match(enrichmentSource, /requireSessionOrTrustedInternalRequest\(request\)/);
  assert.doesNotMatch(enrichmentSource, /from\('organization_members'\)/);
  assert.match(organizationEnrichmentSource, /const \{ user, organizationId \} = auth/);
  assert.doesNotMatch(organizationEnrichmentSource, /resolveOrganizationIdForUser/);
  assert.match(profileStatusSource, /\.eq\('organization_id', ctx\.organizationId\)[\s\S]*\.eq\('user_id', ctx\.user\.id\)/);
  assert.match(workerSource, /'x-user-id': String\(task\.payload\.userId \|\| ''\),[\s\S]*'x-organization-id': String\(task\.organization_id \|\| ''\)/);
});

test('immediate Apollo data is rejected when provider identity binding disagrees', () => {
  assert.match(enrichmentSource, /target\.sourceProviderId !== resultPersonId/);
  assert.match(enrichmentSource, /APOLLO_PERSON_IDENTITY_MISMATCH/);
  assert.match(enrichmentSource, /const bindOutcome = await bindApolloEnrichmentCallback/);
  assert.match(enrichmentSource, /if \(bindOutcome !== 'bound'\)/);
});

test('immediate Apollo responses expose only the canonical persisted target', () => {
  assert.match(enrichmentSource, /\.select\(persistedTargetColumns\(input\.tableName\)\)/);
  assert.match(enrichmentSource, /enrichmentStatus === 'suppressed'/);
  assert.match(enrichmentSource, /enriched\.push\(canonicalTargetResponse\(\{/);
  assert.doesNotMatch(enrichmentSource, /enriched\.push\(\{[\s\S]{0,1200}result\.extractedData/);
  const commonStart = enrichmentSource.indexOf('const common = {');
  const valuesStart = enrichmentSource.indexOf('const values =', commonStart);
  const immediateCommon = enrichmentSource.slice(commonStart, valuesStart);
  assert.doesNotMatch(immediateCommon, /\bemail:|\bemail_status:|\bphone_numbers:|\bprimary_phone:/);
});

test('Apollo enrichment enforces suppression at replay and provider boundaries', () => {
  assert.match(enrichmentSource, /assertLeadEmailsNotSuppressed\(\{ leads, userId, organizationId \}\)/);
  assert.match(enrichmentSource, /has_apollo_enrichment_email_suppression_v1/);
  assert.match(enrichmentSource, /if \(!matchOnly\) \{[\s\S]*createApolloEnrichmentCallback/);
  assert.match(enrichmentSource, /const replayPayload = \{[\s\S]*enriched: enriched\.map/);
  assert.doesNotMatch(enrichmentSource, /const replayPayload = \{[\s\S]{0,500}email:/);
});

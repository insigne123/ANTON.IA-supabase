import test from 'node:test';
import assert from 'node:assert/strict';
import { coworkApolloPayload } from '@/lib/cowork/search-proposal';
import { validateLeadSearchInput } from '../apollo-provider/validation';
import { getGatewayConfig } from '../apollo-provider/gateway';

test('company search uses company keywords and location and excludes person filters', () => {
  const payload = coworkApolloPayload({ target: 'companies', titles: [], industries: ['staffing'], locations: [],
    companyLocations: ['Chile'], employeeRanges: ['51-200'], limit: 5 }, 'owner');
  const result = validateLeadSearchInput(payload, getGatewayConfig({}));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.searchMode, 'organization_search');
  assert.deepEqual(result.value.companyKeywords, ['staffing']);
  assert.deepEqual(result.value.companyLocations, ['Chile']);
  assert.deepEqual(result.value.personLocations, []);
});

test('Cowork audience survives actual Apollo validator without losing company or person filters', () => {
  const payload = coworkApolloPayload({ titles: ['Gerente de RRHH', 'HR Manager'], industries: ['staffing'],
    locations: ['Chile'], companyLocations: ['United States'], employeeRanges: ['51-200'],
    companyDomains: ['example.com'], seniorities: ['manager'], limit: 10 }, 'owner');
  const result = validateLeadSearchInput(payload, getGatewayConfig({}));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.personLocations, ['Chile']);
  assert.deepEqual(result.value.companyLocations, ['United States']);
  assert.deepEqual(result.value.employeeRanges, ['51,200']);
  assert.deepEqual(result.value.organizationDomains, ['example.com']);
  assert.deepEqual(result.value.seniorities, ['manager']);
  assert.equal(result.value.maxResults, 10);
});

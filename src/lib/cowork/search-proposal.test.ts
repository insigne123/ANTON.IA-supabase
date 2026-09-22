import test from 'node:test';
import assert from 'node:assert/strict';
import { coworkApolloPayload, coworkSearchCriteriaSchema } from './search-proposal';
import { runCoworkReadLoop } from './agent-loop';

const criteria = { titles: ['Gerente'], industries: [], locations: ['Chile'], limit: 10 };
test('company mode refuses person criteria instead of silently ignoring them', () => {
  assert.equal(coworkSearchCriteriaSchema.safeParse({ ...criteria, target: 'companies' }).success, false);
  assert.equal(coworkSearchCriteriaSchema.safeParse({ target: 'companies', titles: [], industries: [], locations: [],
    companyDomains: ['example.com'], limit: 5 }).success, true);
});
test('structured model null optional filters preserve explicit company target', () => {
  const input = { target: 'companies' as const, titles: [], industries: ['outsourcing'], locations: [],
    seniorities: null, companyLocations: ['Chile'], employeeRanges: ['51-200'], companyDomains: null, limit: 5 };
  assert.equal(coworkSearchCriteriaSchema.safeParse(input).success, true);
  assert.equal(coworkApolloPayload(input, 'owner').search_mode, 'organization_search');
});
test('audience preserves person location independently from company filters', () => {
  const input = { ...criteria, seniorities: ['director' as const], companyLocations: ['Estados Unidos'],
    employeeRanges: ['51-200'], companyDomains: ['example.com'] };
  const payload = coworkApolloPayload(input, 'owner');
  assert.deepEqual(payload.person_locations, ['Chile']);
  assert.deepEqual(payload.company_location, ['Estados Unidos']);
  assert.deepEqual(payload.employee_ranges, ['51-200']);
  assert.deepEqual(payload.organization_domains, ['example.com']);
  assert.deepEqual(payload.seniorities, ['director']);
  assert.equal(payload.reveal_phone, false);
  assert.equal('company_location' in coworkApolloPayload(criteria, 'owner'), false);
});
test('invalid or unsupported audience filters fail instead of silently broadening search', () => {
  for (const extra of [{ employeeRanges: ['200-51'] }, { employeeRanges: ['1-99999999'] },
    { companyDomains: ['https://example.com/path'] }, { seniorities: ['executive'] }, { excludedDomains: ['example.com'] }]) {
    assert.equal(coworkSearchCriteriaSchema.safeParse({ ...criteria, ...extra }).success, false);
  }
});
test('criteria cap provider work and reject ownership or reveal overrides', () => {
  assert.equal(coworkSearchCriteriaSchema.safeParse({ ...criteria, user_id: 'other' }).success, false);
  assert.equal(coworkSearchCriteriaSchema.safeParse({ ...criteria, reveal_email: true }).success, false);
  assert.equal(coworkSearchCriteriaSchema.safeParse({ ...criteria, limit: 26 }).success, false);
  assert.equal(coworkSearchCriteriaSchema.safeParse({ titles: [], industries: [], locations: [], limit: 5 }).success, false);
  assert.equal(coworkApolloPayload(criteria, 'owner').reveal_email, false);
});
test('agent prepares external search without invoking provider tools', async () => {
  let proposed = false;
  const result = await runCoworkReadLoop({
    message: 'Busca contactos nuevos', signal: new AbortController().signal,
    authorize: async () => {},
    decide: async () => ({ action: 'prospecting.propose_search', query: null, leadId: null, answer: null, searchCriteria: criteria }),
    execute: async () => { throw new Error('Unexpected immediate execution'); }, record: async () => {},
    proposeSearch: async input => { assert.deepEqual(input, criteria); proposed = true; },
  });
  assert.equal(proposed, true); assert.match(result.reply, /Revisa/);
});

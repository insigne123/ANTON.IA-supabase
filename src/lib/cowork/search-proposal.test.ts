import test from 'node:test';
import assert from 'node:assert/strict';
import {
  coworkApolloPayload, coworkCompanyStepPayload, coworkPeopleStepPayload, coworkSearchCriteriaSchema, coworkSearchStrategy,
} from './search-proposal';
import { runCoworkReadLoop } from './agent-loop';

const criteria = { titles: ['Gerente'], industries: [], locations: ['Chile'], limit: 10 };

test('an exact personal profile needs no company or title and cannot turn into a broad search', () => {
  const profile = { linkedinUrl: 'https://cl.linkedin.com/in/contacto-de-prueba-23825746/?trk=test', titles: [], industries: [], locations: [], limit: 1 };
  const parsed = coworkSearchCriteriaSchema.parse(profile);
  assert.equal(parsed.linkedinUrl, 'https://www.linkedin.com/in/contacto-de-prueba-23825746');
  assert.equal(coworkSearchStrategy(parsed), 'profile');
  const payload = coworkApolloPayload(parsed, 'owner');
  assert.equal(payload.search_mode, 'profile');
  assert.equal(payload.linkedin_url, parsed.linkedinUrl);
  assert.equal(payload.max_results, 1);
  assert.equal(payload.reveal_email, false);
  assert.equal(payload.reveal_phone, false);
  for (const extra of [{ limit: 25 }, { page: 2 }, { target: 'companies' }, { strategy: 'companies_first' },
    { titles: ['Gerente'] }, { companyDomains: ['example.com'] }, { locations: ['Chile'] },
    { linkedinUrl: 'https://www.linkedin.com/company/example' }, { linkedinUrl: 'https://example.com/in/persona' }]) {
    assert.equal(coworkSearchCriteriaSchema.safeParse({ ...profile, ...extra }).success, false, JSON.stringify(extra));
  }
});
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
  assert.equal(coworkSearchCriteriaSchema.safeParse({ ...criteria, limit: 100 }).success, true, '«todos los que puedas» is 100');
  assert.equal(coworkSearchCriteriaSchema.safeParse({ ...criteria, limit: 101 }).success, false);
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

test('a supplied profile stages a lookup for approval, without saving or inviting before approval', async () => {
  const profile = { linkedinUrl: 'https://www.linkedin.com/in/contacto-de-prueba-23825746', titles: [], industries: [], locations: [], limit: 1 };
  let proposals = 0;
  const result = await runCoworkReadLoop({
    message: `Invita por LinkedIn a la persona de ${profile.linkedinUrl}`,
    signal: new AbortController().signal, authorize: async () => {},
    decide: async () => ({ action: 'prospecting.propose_search', query: null, leadId: null, answer: null, searchCriteria: profile }),
    execute: async () => { throw new Error('No provider or send before approval'); }, record: async () => {},
    proposeSearch: async input => { proposals++; assert.deepEqual(input, profile); },
  });
  assert.equal(proposals, 1);
  assert.match(result.reply, /perfil exacto/);
  assert.match(result.reply, /1 crédito/);
});

// The 1 Oct test: «revisión de antecedentes» for companies of services brought 2 people out of 25 in one people search.
const offer = { titles: ['Gerente de Recursos Humanos', 'Jefe de Reclutamiento'], industries: ['servicios', 'outsourcing'],
  locations: ['Santiago, Chile'], limit: 25, rolePolicy: { decisionTerms: ['gerente', 'jefe'], userTerms: ['reclutamiento'], referralTerms: [], excludeTerms: ['práctica'] } };
test('people with industries go companies first unless the proposal asks for one people search', () => {
  assert.equal(coworkSearchStrategy(coworkSearchCriteriaSchema.parse(offer)), 'companies_first');
  assert.equal(coworkSearchStrategy(coworkSearchCriteriaSchema.parse({ ...offer, strategy: 'people' })), 'people');
  assert.equal(coworkSearchStrategy(coworkSearchCriteriaSchema.parse(criteria)), 'people', 'without industries there are no companies to start from');
  assert.equal(coworkSearchStrategy(coworkSearchCriteriaSchema.parse({ target: 'companies', titles: [], industries: ['outsourcing'], locations: [], limit: 5 })), 'companies');
  // Companies first needs something about the companies and someone to look for in them.
  assert.equal(coworkSearchCriteriaSchema.safeParse({ ...criteria, strategy: 'companies_first' }).success, false);
  assert.equal(coworkSearchCriteriaSchema.safeParse({ ...offer, titles: [], strategy: 'companies_first' }).success, false);
  assert.equal(coworkSearchCriteriaSchema.safeParse({ ...offer, target: 'companies', titles: [], locations: [], strategy: 'companies_first' }).success, false);
  // «Traer más» pages through the same criteria; offset only moves through the people of companies first.
  assert.equal(coworkSearchCriteriaSchema.safeParse({ ...offer, page: 2, offset: 25 }).success, true);
  assert.equal(coworkSearchCriteriaSchema.safeParse({ ...criteria, offset: 25 }).success, false);
  assert.equal(coworkSearchCriteriaSchema.safeParse({ ...offer, page: 21 }).success, false);
});
test('companies first finds the companies by industry and country, then the people inside them with similar titles', () => {
  const companies = coworkCompanyStepPayload(coworkSearchCriteriaSchema.parse({ ...offer, employeeRanges: ['51-500'], page: 2 }), 'owner');
  assert.equal(companies.search_mode, 'organization_search');
  assert.deepEqual(companies.company_keywords, ['servicios', 'outsourcing']);
  assert.deepEqual(companies.company_location, ['Chile'], 'a company run from Santiago still counts when the person is elsewhere in Chile');
  assert.deepEqual(companies.employee_ranges, ['51-500']);
  assert.equal(companies.per_page, 100); assert.equal(companies.page, 2);
  assert.equal('titles' in companies || 'person_locations' in companies, false, 'no person filter narrows the companies');
  assert.deepEqual(coworkCompanyStepPayload(coworkSearchCriteriaSchema.parse({ ...offer, companyLocations: ['Perú'] }), 'owner').company_location, ['Perú']);
  const ids = Array.from({ length: 50 }, (_, index) => `org-${index}`);
  const people = coworkPeopleStepPayload(coworkSearchCriteriaSchema.parse(offer), 'owner', ids);
  assert.equal(people.search_mode, 'batch');
  assert.deepEqual(people.organization_ids, ids);
  assert.deepEqual(people.titles, offer.titles);
  assert.deepEqual(people.person_locations, ['Santiago, Chile']);
  assert.equal(people.include_similar_titles, true);
  assert.equal(people.max_results, 100);
  assert.equal(people.reveal_email, false); assert.equal(people.reveal_phone, false);
  assert.equal('industry_keywords' in people, false, 'the companies already carry the industry');
  assert.throws(() => coworkPeopleStepPayload(coworkSearchCriteriaSchema.parse(offer), 'owner', [...ids, 'org-50']));
  assert.throws(() => coworkPeopleStepPayload(coworkSearchCriteriaSchema.parse(offer), 'owner', []));
  // One people search keeps its own page and turns similar titles on too.
  const single = coworkApolloPayload(coworkSearchCriteriaSchema.parse({ ...criteria, limit: 100, page: 3 }), 'owner');
  assert.equal(single.include_similar_titles, true); assert.equal(single.page, 3); assert.equal(single.per_page, 100);
});

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_LEAD_SEARCH_FILTERS,
  normalizeSavedSearchCriteria,
  savedSearchNamesMatch,
  serializeSavedSearchCriteria,
} from '@/lib/search/saved-search-criteria';

test('saved lead-search criteria round-trip every supported field', () => {
  const filters = {
    ...DEFAULT_LEAD_SEARCH_FILTERS,
    searchMode: 'company_name' as const,
    industry: 'SaaS',
    location: 'Chile, Argentina',
    title: 'VP Marketing, CMO',
    sizeRange: '51-200',
    seniorities: ['vp', 'c_suite'],
    companyName: 'Acme',
    companyDomains: 'acme.com, acme.cl',
    maxResults: 75,
    linkedinUrl: 'https://www.linkedin.com/in/example',
    revealEmail: false,
    revealPhone: true,
  };

  assert.deepEqual(normalizeSavedSearchCriteria(serializeSavedSearchCriteria(filters)), filters);
});

test('normalizes legacy aliases and infers a profile search mode', () => {
  assert.deepEqual(normalizeSavedSearchCriteria({
    linkedin_url: 'https://www.linkedin.com/in/legacy',
    reveal_email: 'false',
    reveal_phone: 1,
    management_levels: 'director, vp, director',
    max_results: '40',
  }), {
    ...DEFAULT_LEAD_SEARCH_FILTERS,
    searchMode: 'linkedin_profile',
    linkedinUrl: 'https://www.linkedin.com/in/legacy',
    revealEmail: false,
    revealPhone: true,
    seniorities: ['director', 'vp'],
    maxResults: 40,
  });
});

test('falls back safely for malformed or newer envelope criteria', () => {
  assert.deepEqual(normalizeSavedSearchCriteria(null), DEFAULT_LEAD_SEARCH_FILTERS);
  assert.deepEqual(normalizeSavedSearchCriteria({ version: 99, filters: { mode: 'company', company_name: 'Northstar' } }), {
    ...DEFAULT_LEAD_SEARCH_FILTERS,
    searchMode: 'company_name',
    companyName: 'Northstar',
  });
});

test('compares duplicate saved-search names clearly across spacing and case', () => {
  assert.equal(savedSearchNamesMatch('  Chile   Marketing ', 'chile marketing'), true);
  assert.equal(savedSearchNamesMatch('Chile Marketing', 'Argentina Marketing'), false);
});

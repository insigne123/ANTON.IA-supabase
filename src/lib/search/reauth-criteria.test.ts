import assert from 'node:assert/strict';
import test from 'node:test';
import { saveSearchReauthCriteria, consumeSearchReauthCriteria } from './reauth-criteria';
import { DEFAULT_LEAD_SEARCH_FILTERS } from './saved-search-criteria';
test('reauth preserves company/profile criteria once for the same user and organization, not private results/tokens', () => {
  const rows = new Map<string, string>();
  const store = { getItem: (key: string) => rows.get(key) ?? null, setItem: (key: string, value: string) => { rows.set(key, value); }, removeItem: (key: string) => { rows.delete(key); } };
  const scope = { userId: 'a', organizationId: 'org' };
  const filters = { ...DEFAULT_LEAD_SEARCH_FILTERS, searchMode: 'company_name' as const, companyName: 'acciona', secret: 'not-kept', leads: [{ email: 'private@example.test' }] };
  saveSearchReauthCriteria(store, scope, filters, 1000);
  assert.doesNotMatch([...rows.values()].join(''), /not-kept|private@example/);
  assert.equal(consumeSearchReauthCriteria(store, { ...scope, userId: 'b' }, 2000), null);
  assert.equal(consumeSearchReauthCriteria(store, { ...scope, organizationId: 'other' }, 2000), null);
  assert.equal(consumeSearchReauthCriteria(store, scope, 2000)?.companyName, 'acciona');
  assert.equal(consumeSearchReauthCriteria(store, scope, 2000), null);
  saveSearchReauthCriteria(store, scope, { ...DEFAULT_LEAD_SEARCH_FILTERS, searchMode: 'linkedin_profile', linkedinUrl: 'https://www.linkedin.com/in/flaviobaronti/?trk=public' }, 1000);
  assert.equal(consumeSearchReauthCriteria(store, scope, 1001)?.linkedinUrl, 'https://www.linkedin.com/in/flaviobaronti/?trk=public');
  saveSearchReauthCriteria(store, scope, filters, 1000);
  assert.equal(consumeSearchReauthCriteria(store, scope, 30 * 60_000), null);
});
test('blocked or damaged storage cannot block sign-in or inject unexpected data', () => {
  const scope = { userId: 'a', organizationId: 'org' };
  const store = { getItem: () => '{bad', setItem: () => { throw new Error('blocked'); }, removeItem: () => {} };
  assert.doesNotThrow(() => saveSearchReauthCriteria(store, scope, DEFAULT_LEAD_SEARCH_FILTERS));
  assert.equal(consumeSearchReauthCriteria(store, scope), null);
});

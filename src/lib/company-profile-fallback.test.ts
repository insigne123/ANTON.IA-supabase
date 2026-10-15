import assert from 'node:assert/strict';
import test from 'node:test';
import { getCompanyProfile } from './data';

test('without a saved profile nobody gets the demo company in their signature or drafts', () => {
  const profile = getCompanyProfile();
  assert.equal(profile.name, '');
  assert.equal(profile.website, '');
  assert.equal(profile.services, '');
  assert.doesNotMatch(JSON.stringify(profile), /Innovatech|innovatech\.com|John Doe/);
});

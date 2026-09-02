import assert from 'node:assert/strict';
import test from 'node:test';

import {
  APOLLO_DISPLAY_TOTAL_CREDITS,
  APOLLO_EMAIL_ENRICHMENT_CREDITS,
  APOLLO_PHONE_ENRICHMENT_CREDITS,
  apolloEnrichmentCreditCost,
} from './apollo-credit-costs';

test('Apollo enrichment costs use the shared account contract', () => {
  assert.equal(APOLLO_EMAIL_ENRICHMENT_CREDITS, 1);
  assert.equal(APOLLO_PHONE_ENRICHMENT_CREDITS, 10);
  assert.equal(APOLLO_DISPLAY_TOTAL_CREDITS, 2_500);
  assert.equal(apolloEnrichmentCreditCost({ revealEmail: true, revealPhone: false }), 1);
  assert.equal(apolloEnrichmentCreditCost({ revealEmail: false, revealPhone: true }), 10);
  assert.equal(apolloEnrichmentCreditCost({ revealEmail: true, revealPhone: true }), 11);
});

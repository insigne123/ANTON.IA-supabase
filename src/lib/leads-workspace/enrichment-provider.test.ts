import assert from 'node:assert/strict';
import test from 'node:test';
import { partitionEnrichmentLeads, enrichmentCreditReceipt, ANTONIA_ENRICHMENT_CREDITS_PER_CONTACT } from './enrichment-provider';

test('mixed saved and enriched contacts keep their provider; a LF id also recovers an absent origin marker', () => {
  const lf = { id: 'saved', sourceProvider: 'leads_finder', sourceProviderId: 'lf_' + 'a'.repeat(24) };
  const recovered = { id: 'enriched', sourceProviderId: 'lf_' + 'b'.repeat(24) };
  const apollo = { id: 'other', sourceProvider: 'apollo', sourceProviderId: 'apollo-person' };
  assert.deepEqual(partitionEnrichmentLeads([lf, apollo, recovered]), { leadsFinder: [lf, recovered], apollo: [apollo] });
  for (const source of [{ id: 'saved', sourceProvider: 'leads_finder' }, { id: 'saved', sourceProviderId: 'lf_invalid' }]) {
    assert.throws(() => partitionEnrichmentLeads([apollo, source]), /origen/, 'no missing LF identity falls through to an Apollo request');
  }
});

test('the displayed app-credit receipt reports actual consumption, not estimated upstream phone costs', () => {
  assert.equal(ANTONIA_ENRICHMENT_CREDITS_PER_CONTACT, 1);
  assert.equal(enrichmentCreditReceipt(0), '');
  assert.equal(enrichmentCreditReceipt(1), 'Se descontó 1 crédito de ANTON.IA.');
  assert.equal(enrichmentCreditReceipt(4), 'Se descontaron 4 créditos de ANTON.IA.');
});

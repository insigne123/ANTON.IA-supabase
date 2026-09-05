import assert from 'node:assert/strict';
import test from 'node:test';

import {
    hasEnrichmentSearchCreditAccess,
    hasUserEnrichmentSearchCreditAccess,
    normalizeEnrichmentSearchEmail,
} from './enrichment-search-access';

test('worker enrichment and search access accepts every authenticated email', () => {
    assert.equal(normalizeEnrichmentSearchEmail(' USER@EXAMPLE.COM '), 'user@example.com');
    assert.equal(hasEnrichmentSearchCreditAccess('user@example.com'), true);
    assert.equal(hasEnrichmentSearchCreditAccess('otro@grupoexpro.com'), true);
    assert.equal(hasEnrichmentSearchCreditAccess(undefined), false);
});

test('worker access accepts every authenticated user id and rejects missing identity', async () => {
    assert.equal(await hasUserEnrichmentSearchCreditAccess({} as any, 'allowed-user'), true);
    assert.equal(await hasUserEnrichmentSearchCreditAccess({} as any, 'another-user'), true);
    assert.equal(await hasUserEnrichmentSearchCreditAccess({} as any, '  '), false);
});

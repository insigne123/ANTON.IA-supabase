import assert from 'node:assert/strict';
import test from 'node:test';

import {
    ENRICHMENT_SEARCH_ALLOWED_EMAIL,
    hasEnrichmentSearchCreditAccess,
    hasUserEnrichmentSearchCreditAccess,
    normalizeEnrichmentSearchEmail,
} from './enrichment-search-access';

test('worker enrichment and search access is restricted to the allowlisted email', () => {
    assert.equal(normalizeEnrichmentSearchEmail(` ${ENRICHMENT_SEARCH_ALLOWED_EMAIL.toUpperCase()} `), ENRICHMENT_SEARCH_ALLOWED_EMAIL);
    assert.equal(hasEnrichmentSearchCreditAccess(` ${ENRICHMENT_SEARCH_ALLOWED_EMAIL.toUpperCase()} `), true);
    assert.equal(hasEnrichmentSearchCreditAccess('otro@grupoexpro.com'), false);
    assert.equal(hasEnrichmentSearchCreditAccess(undefined), false);
});

test('worker auth lookup fails closed for unknown users and lookup errors', async () => {
    const lookup = (email: string | undefined, error: unknown = null) => ({
        auth: {
            admin: {
                getUserById: async () => ({ data: { user: email ? { email } : null }, error }),
            },
        },
    });

    assert.equal(
        await hasUserEnrichmentSearchCreditAccess(lookup(ENRICHMENT_SEARCH_ALLOWED_EMAIL) as any, 'allowed-user'),
        true,
    );
    assert.equal(
        await hasUserEnrichmentSearchCreditAccess(lookup('otro@grupoexpro.com') as any, 'blocked-user'),
        false,
    );
    assert.equal(
        await hasUserEnrichmentSearchCreditAccess(lookup(undefined, { message: 'auth lookup failed' }) as any, 'lookup-error-user'),
        false,
    );
    assert.equal(
        await hasUserEnrichmentSearchCreditAccess({
            auth: {
                admin: {
                    getUserById: async () => { throw new Error('auth lookup failed'); },
                },
            },
        } as any, 'throwing-user'),
        false,
    );
});
